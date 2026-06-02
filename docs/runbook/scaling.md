# Scaling

What to do when traffic doubles, or when a single org's burst threatens to swamp the host.

## Capacity assumptions (v0.2 baseline)

- 1 app VM (Hetzner CCX23: 4 vCPU, 16 GB RAM) handles **~2 k events/sec** sustained based on synthetic load (single thread per connection, P99 ingest < 50 ms).
- 1 PG VM (Hetzner CPX21: 3 vCPU, 8 GB RAM) handles **~3 k inserts/sec** with the partitioned `events` table.
- Free-tier monthly quota = 100 k events / org → comfortably headroom for ~ 5 000 active orgs at the 5% concurrency rule.

If you breach any of these by 1.5×, scale **before** you break SLA, not after.

## Pre-scaling checks

Run through these before adding any iron:

1. **Look at the Grafana overview dashboard.** Is the bottleneck CPU, RAM, PG pool, Valkey, or disk? Don't add the wrong axis.
2. **Check `sentori_ingest_total{status="rejected"}`.** A spike in `rejected` looks like load but is probably a SDK regression sending malformed events. Don't add servers to absorb broken clients.
3. **Check the partition count** (`SELECT count(*) FROM pg_inherits WHERE inhparent = 'events'::regclass;`). If it's growing > 12 per month, retention is broken — fix that before adding compute.

## Horizontal: more app VMs

Cheap and reversible. Use this first.

```sh
# 1. Provision a new VM with the same image as the existing one.
# 2. Install docker + the production compose.
# 3. Bring it up pointing at the same PG and Valkey:
SENTORI_DOMAIN=sentori.golia.jp \
  docker compose -f docker/production-compose.yml --env-file /etc/sentori/.env up -d
```

Then update the Caddy upstream pool on **all** app VMs:

```caddy
import server_upstreams  # add the new VM hostname/IP to server_upstreams snippet
```

Reload Caddy (`docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`).

You can keep going horizontally up to ~ 10 VMs before cross-region latency starts dominating; at that point split into regions, with one PG per region and async replication.

## Vertical: bigger PG

Postgres is the harder axis. Plan ahead.

| Symptom | Action |
|---------|--------|
| `sentori_pg_pool_in_use / max > 0.80` (Phase 16+ alert) for ≥ 5 min | Bump `SQLX_MAX_CONNECTIONS` to 1.5×, redeploy server (no PG change yet) |
| Latency p99 > 100 ms; `pg_stat_activity` shows long-running `INSERT INTO events` | Resize the PG VM one tier up (CPX21 → CPX31 → CPX41). Vertical resize on Hetzner is downtime ~5 min — schedule it and announce. |
| Disk free < 20% (`HostDiskFreeLow` alert) | Audit `events` partitions — retention should already drop the oldest. If a partition is huge (org with bursty traffic), tighten that org's `org_quotas.retention_days`. Resize the disk only after retention is provably correct. |
| WAL build-up because R2 archive is failing | Check `archive_command` log; usually it's an expired Cloudflare token. Fix that first; don't shrink WAL while archive is broken. |

We deliberately stay on a **single primary PG** until traffic justifies streaming replication. That keeps the operational story simple. The trigger to add a replica is the first time vertical resizing runs out of headroom (~CPX51), not earlier.

## Hot orgs

A single org sending 10× their plan's traffic doesn't take down the system (the quota gate drops events at the edge with 429), but they can blow through their monthly budget in hours and degrade signal-to-noise:

1. Pull the org_id from the Grafana dashboard's "top quota drops" panel (Phase 16+).
2. `psql` and bump `org_quotas.event_limit_monthly` to a hand-set ceiling so they're not pinned at 0 for the rest of the period.
3. Email the owner via the existing quota-warning notifier (the bump triggers a fresh threshold check).
4. File a follow-up to discuss a paid plan once you have one.

Don't scale infrastructure to accommodate one runaway client. Quota first; compute later.

## What we don't do (yet)

- **No autoscaler.** v0.2 is small enough that human-in-the-loop horizontal scaling is faster than wiring up an autoscaler that misfires under bursts.
- **No multi-region active-active.** PG is a single primary; cross-region writes would need conflict resolution we haven't designed.
- **No queue between SDK and server.** Quota gates + 429 are the backpressure. Adding Kafka for "Phase 17" lands when we have a billing case for retained-on-overflow.

# Incident response

One operator, no paging system. Nothing wakes you up — you find out because you looked, or because someone tells you. This file is what to do once you know.

> Rewritten 2026-09-08. The previous version had a two-person weekly on-call rotation acking pages in Better Stack, a public status page at `status.sentori.golia.jp` (which no longer resolves), a `#sentori-ops` Slack channel, and a P2 trigger that fired on marketing and docs being down — containers removed in 2026-08. Its one concrete remediation step was `docker compose -f production-compose.yml restart valkey`: a restart of a service deleted in July, through a compose file that does not exist. A runbook is read at 3am by someone who is not thinking clearly. Every step below has been checked against the running system.

## Is it actually broken?

```sh
curl -s https://sentori.golia.jp/healthz
```

`{"status":"ok","db":"ok","version":"...","pool_size":N,"pool_idle":M, ...}`

- No response / connection refused → the server or Caddy is down. Straight to **Stop the bleeding**.
- `"db":"error"` → Postgres. The server is up and answering, which means the dashboard loads and every write fails.
- `200` with an **old** `version` → a deploy silently did not ship. A stale binary answers this endpoint exactly like a fresh one; the version field is the only thing that tells them apart.

Then the edge:

```sh
curl -s https://sentori.golia.jp/metrics | grep sentori_ingest_total
```

`rejected` climbing without `accepted` climbing is an SDK sending malformed events — customer-visible as "my errors aren't showing up", not as an outage. `rate_limited` climbing is the limiter working. `failed` climbing is ours.

## How bad

| | Looks like | Do |
|---|---|---|
| **Ingest down** | `/healthz` unreachable, or `accepted` flat at zero while apps are live | Stop the bleeding now. Every SDK is dropping events, and they do not all buffer forever. |
| **Writes failing** | `"db":"error"`, or `failed` climbing | Same urgency. The dashboard still loads, which makes this easy to under-react to. |
| **Degraded** | `rejected` spiking, one page broken, slow queries | Diagnose properly. Do not roll back on a hunch. |

## Stop the bleeding

Diagnose second. In order of likelihood:

1. **Was there a deploy in the last 30 minutes?** `gh run list --branch master --limit 5`. If yes, roll back per [deploy.md](./deploy.md) — do not debug forward on a suspicion.
2. **Is the container up?**
   ```sh
   ssh <app host>
   cd /apps/sentori
   docker compose -f docker-compose.yml ps
   docker compose -f docker-compose.yml logs --tail=200 server-v1
   ```
   A boot loop is usually a failed migration or a bad `.env`. The logs say which, and migrations run before the server binds a port — a container that never reaches "server boot" did not get past them.
3. **Is Postgres up?**
   ```sh
   docker compose -f docker-compose.yml ps postgres-v1
   docker compose -f docker-compose.yml logs --tail=100 postgres-v1
   ```
   Out of disk is the common one. Check the host: `df -h`. Attachments dominate, not rows.
4. **Is it Caddy rather than us?** `/healthz` from the app host itself (`curl -s http://127.0.0.1:18092/healthz`) answering while the public URL does not means the problem is in front of the server, not in it. See the Caddy notes in the devops repo — **never** overwrite the t01 Caddyfile from a repo copy; edit live, then import.

## After

There is no status page to update and no channel to post in. What is worth doing:

- If it was user-visible and you have customers on that instance, tell them directly.
- If the same thing happens twice, write it down. `docs/postmortems/` does not exist — create it when you have the first one rather than leaving a pointer to an empty idea.
- If the failure was invisible until you happened to look, that is the finding. Ask what would have shown it: an alert rule in `ops/prometheus-alerts.yml` (which needs a Prometheus scraping `/metrics` — there is none today), or a check in `bun run preflight`.

## What does not warrant panic

- A burst of `rate_limited` — the limiter working as designed.
- `rejected` from one project after an SDK release — a client bug, and rolling back the server will not fix it.
- Push send failures. They queue and retry; `sentori_push_queued` and `sentori_push_failed_24h` are on `/metrics`.

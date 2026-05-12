---
title: Self-hosting
description: Production deploy, SMTP, source maps, backups
---

# Sentori — self-hosting

For running Sentori on your own infra. The reference deploy is the
docker-compose in this repo.

## Architecture

```
                            ┌─────────────────┐
       browser ──HTTPS──▶   │  reverse proxy   │   (your TLS terminator)
                            │  caddy / nginx   │
                            └────────┬─────────┘
                                     │ http
                            ┌────────▼─────────┐
                            │   sentori-web    │  nginx + SPA bundle
                            │   /admin/api ▶───┼──────────┐
                            └──────────────────┘          │
                                                          │
                            ┌──────────────────┐          │
SDK on phone ──HTTPS──────▶ │  sentori-server  │ ◀────────┘
                            │  axum + Rust     │
                            └────┬─────────┬───┘
                                 │         │
                  ┌──────────────▼─┐   ┌───▼─────────┐
                  │  postgres 18   │   │  valkey 8   │
                  │  (events,      │   │  (rate      │
                  │   issues,      │   │   limit     │
                  │   tokens, ...) │   │   counters) │
                  └────────────────┘   └─────────────┘
```

Optional: SMTP relay (any provider) for new-issue email.

## Required env

Save to `.env` next to `docker-compose.yml`:

```bash
SENTORI_DEV_TOKEN=st_pk_$(head /dev/urandom | base32 | tr A-Z a-z | tr -d '=' | head -c 26)
SENTORI_ADMIN_PASSWORD=$(openssl rand -hex 12)
SENTORI_SESSION_SECRET=$(openssl rand -hex 32)
SENTORI_PG_PASSWORD=$(openssl rand -hex 16)
```

`docker compose up` will refuse to start if any of these are unset.

## Optional env (override.yml)

| Var | Default | Use |
|---|---|---|
| `SENTORI_RATE_LIMIT_PER_MIN` | `1000` | per-token request limit |
| `SENTORI_SMTP_HOST` | unset | enables new-issue email; if unset, no email is sent |
| `SENTORI_SMTP_PORT` | `587` | STARTTLS |
| `SENTORI_SMTP_USER` | unset | optional auth |
| `SENTORI_SMTP_PASS` | unset | optional auth |
| `SENTORI_SMTP_FROM` | `sentori@localhost` | From: address |
| `SENTORI_DATA_DIR` | `/data` | source-map blob storage path |
| `SENTORI_WEB_PORT` | `8000` | host port for the web container |
| `SENTORI_TRACE_RETENTION_DAYS` | `14` | how long spans + traces are kept (see *Data retention* below) |
| `SENTORI_SPAN_LIMIT_MONTHLY` | `10000000` | per-org monthly span-ingest budget, separate from the error-event quota; `0` = unlimited |
| `SENTORI_SELF_TRACE_PROJECT_ID` | unset | if set to a project UUID, the server emits its own `http.server` spans into that project |
| `RUST_LOG` | `info,sentori_server=info,tower_http=info` | |

Copy `docker-compose.override.example.yml` to
`docker-compose.override.yml` and edit. The override is auto-merged by
`docker compose`.

## Data retention

A daily background pass (`retention.rs`) manages the time-partitioned
tables:

- **events** are kept for the longest plan retention across all orgs,
  floor 30 days. Errors are the high-value signal — keep them.
- **spans + traces** are kept for `SENTORI_TRACE_RETENTION_DAYS`
  (default 14). Traces are high-volume and lower-value than errors, so
  a short hard window keeps storage bounded; recent traces stay 100%
  complete (Sentori does **not** sample at ingest). Set it longer if
  you have the disk; set it shorter to be aggressive.

The same pass keeps ~6 months of empty monthly partitions ahead of
"now" so writes never spill into the `*_default` catch-all partition —
so don't stop the server for months at a time and expect partition
hygiene to keep up. Expired monthly partitions are `DROP TABLE`-d (an
instant metadata op); the `traces` table (not partitioned) is pruned
with a delete.

## Starting

```bash
docker compose up -d
docker compose ps           # postgres should be "healthy"
docker compose logs -f server
```

The web UI lives at <http://localhost:8000> by default.

## Adding email recipients

Each project's settings page in the dashboard has a **Recipients**
panel for managing notification emails. For a quick CLI route you can
also insert rows directly:

```bash
docker compose exec postgres psql -U sentori -d sentori -c "
  INSERT INTO notification_recipients (id, project_id, email, on_new_issue)
  VALUES (
    gen_random_uuid(),
    '019508a0-0000-7000-8000-000000000000',  -- DEV_PROJECT_ID
    'oncall@example.com',
    true
  );
"
```

Verify SMTP wiring by triggering any new fingerprint and watching the
server logs:

```bash
docker compose logs -f server | grep -E 'new-issue|notifier'
```

## Source-map uploads

After a release build:

```bash
sentori-cli upload sourcemap \
  --release "myapp@1.2.3+456" \
  --token "$SENTORI_DEV_TOKEN" \
  --ingest-url "https://sentori.your-host.com" \
  ./bundle/index.android.bundle.map
```

Files are deduped by sha256 and stored under `SENTORI_DATA_DIR/artifacts/`.

## Populate dev data

For local development — dashboard polish, query EXPLAIN baselines,
performance audits — `tools/seed-events.ts` posts synthetic events
directly to the ingest endpoint so you can see the dashboard with
realistic shape without waiting on production users.

```bash
# 5,000 events across 200 user IDs and 10 release tags, last 7 days,
# with ~5% ANR mixed in.
bun tools/seed-events.ts \
  --token "$SENTORI_DEV_TOKEN" \
  --events 5000 --users 200 --releases 10 \
  --include-anr \
  --ingest-url http://localhost:8080
```

Each event is tagged `synthetic: seed-events` so you can clean up
later with:

```bash
docker compose exec postgres psql -U sentori -d sentori -c \
  "DELETE FROM events WHERE payload->'tags'->>'synthetic' = 'seed-events'"
```

To also simulate regressions (resolve some issues then re-post their
fingerprints so the server flips them to `regressed`), pass an admin
token + project ID:

```bash
bun tools/seed-events.ts ... \
  --include-regression \
  --admin-token "$SENTORI_ADMIN_TOKEN" \
  --project-id 019508a0-0000-0000-0000-000000000000 \
  --api-url http://localhost:8080
```

## Backups

Postgres is the source of truth. A nightly logical backup is the v0.1
recommendation:

```bash
docker compose exec -T postgres pg_dump -U sentori sentori \
  | gzip > backups/sentori-$(date +%F).sql.gz
```

Restore:

```bash
gunzip -c backups/sentori-2026-05-09.sql.gz \
  | docker compose exec -T postgres psql -U sentori -d sentori
```

The `server-data` volume holds source-map blobs (re-uploadable from CI),
so it's nice-to-have but not critical.

## Updating

```bash
git pull
docker compose pull        # if using prebuilt ghcr.io images
docker compose up -d --build
```

Migrations run on server boot via `sqlx::migrate!`. v0.1 migrations are
forward-only; for rollback, restore from a pre-update DB backup.

## Behind a reverse proxy

The web container speaks plain HTTP. Front it with Caddy / nginx /
Cloudflare for TLS:

```caddy
sentori.example.com {
    reverse_proxy localhost:8000
}
```

The SDK ingest endpoint is the same host: SDKs send to
`https://sentori.example.com/v1/events`, the web reverse-proxies
`/admin/api` to the server, and `/v1/*` goes through unchanged because
the web container only intercepts paths it knows about.

## Production hardening checklist

- Pin docker images to a specific SHA tag (replace `:latest`)
- Off-host Postgres with a read replica
- WAL archiving + PITR
- Run docker daemon as a non-root user
- Cloudflare (or equivalent) in front for DDoS / WAF
- Dedicated SMTP via Postmark / SES instead of shared providers

For the production setup history, see the [CHANGELOG](https://github.com/goliajp/sentori/blob/main/CHANGELOG.md) (v0.1.x — Phase 16).

# Sentori v0.2 — deployment guide

> Covers the two supported topologies: **self-hosted** (single
> docker host, your own data) and **SaaS** (cluster of containers,
> shared DB across tenants). Both run the same binaries.

## Self-hosted — single-image quick start

```bash
git clone https://github.com/goliajp/sentori-selfhosted.git
cd sentori-selfhosted

cp self-hosted/docker/.env.example .env
# Edit:
# - POSTGRES_PASSWORD (random)
# - SENTORI_SESSION_SECRET (`openssl rand -base64 24 | head -c 32`)
# - SENTORI_BOOTSTRAP_OWNER_EMAIL + SENTORI_BOOTSTRAP_OWNER_PASSWORD

docker compose -f self-hosted/docker/docker-compose.yml up -d
docker compose logs -f server | grep "ready"
# → "ready" appears within ~30s on first boot (migrations + bootstrap)

# Webapp + API: http://localhost:8080
# Healthz:     http://localhost:8080/healthz
```

That's it. The single `sentori-server` container serves the
webapp SPA + every API route. `docker compose up -d` is the whole
provisioning workflow.

## Self-hosted behind HTTPS (recommended for prod)

Put any reverse proxy in front of port 8080 and pass through to
the container. Example Caddyfile:

```
sentori.example.com {
    encode zstd gzip
    reverse_proxy localhost:8080
}
```

Make sure `SENTORI_COOKIE_SECURE=1` (the default) so the session
cookie sets the `Secure` flag. If you serve over plain HTTP for
local dev, flip to `SENTORI_COOKIE_SECURE=0`.

## SaaS — two-binary topology

Run two binaries against the **same** postgres database:

```
                 ┌──────────────┐
   ingest.* ───→ │ sentori-server │ ─→ postgres
   sentori.* ───→ │   :8080        │
                 └──────────────┘
                 ┌──────────────────────┐
   saas-mgmt ───→ │ sentori-saas-control │ ─→ same postgres
                 │       :9090            │
                 └──────────────────────┘
```

- **sentori-server** (port 8080): SDK ingest + webapp + dashboard
  + admin endpoints + per-workspace operations.
- **sentori-saas-control** (port 9090): cross-tenant workspace
  CRUD + Stripe webhook ingest. Same DB, different binary.

Required env vars for the SaaS deployment:

```bash
# sentori-server
SENTORI_DATABASE_URL=postgres://sentori:$PW@db:5432/sentori
SENTORI_SESSION_SECRET=$(openssl rand -base64 24 | head -c 32)
SENTORI_COOKIE_SECURE=1
SENTORI_SAASADMIN_USER_IDS=$OPS_UUID_1,$OPS_UUID_2
SENTORI_PUSH_WORKER_ENABLED=1

# sentori-saas-control
SENTORI_SAAS_DATABASE_URL=postgres://sentori:$PW@db:5432/sentori   # same DB
SENTORI_STRIPE_WEBHOOK_SECRET=$WHSEC
```

Caddy routes traffic to the right binary:

```
ingest.sentori.golia.jp, sentori.golia.jp {
    encode zstd gzip
    reverse_proxy localhost:8080  # sentori-server
}

api.sentori.golia.jp {
    encode zstd gzip
    handle /v1/saas/* {
        reverse_proxy localhost:9090  # sentori-saas-control
    }
    handle /v1/saas/stripe/* {
        reverse_proxy localhost:9090
    }
    handle {
        reverse_proxy localhost:8080
    }
}
```

## Database

PostgreSQL 18+ recommended. Migrations run automatically on
sentori-server boot — no manual `sqlx migrate run` step.

Backup / restore: standard `pg_dump` / `pg_restore`. The schema
has no per-tenant tablespaces — one logical dump per database.

## Push dispatcher

`SENTORI_PUSH_WORKER_ENABLED=1` (default) starts the background
worker. v0.2 ships a mock-success dispatcher; real APNs / FCM /
WebPush / HCM / MiPush vendor adapters land in v0.3+. Disable
with `=0` if you don't ship push and want one fewer SQL query
every 5s.

## Logging

`RUST_LOG=info,sqlx=warn` is the default. Per-module overrides:

```bash
RUST_LOG=info,sqlx=warn,sentori_server::push_worker=debug
```

Structured logs go to stdout — pipe to your log shipper of choice.

## Backups

- **PostgreSQL**: `pg_dump --format=custom sentori > backup.dump`
- **Push credential secrets**: live in `push_credentials.secret_blob`
  bytea column. Today stored as-is; encryption-at-rest via vault
  envelope lands in K7.
- **Attachment blobs**: minio / fs path configured via
  `SENTORI_ATTACHMENT_STORE` (default in-memory; configure
  persistent backend before turning replays on at scale).

## Scaling notes

- `sentori-server` is stateless — multiple replicas behind a
  load balancer are safe (sessions are DB-backed, push worker
  uses `FOR UPDATE SKIP LOCKED`).
- `sentori-saas-control` should run as a singleton (stripe
  webhook idempotency is db-backed but no need to multiply).
- Postgres: provision generously; partitioned tables (events,
  spans, push_sends, metric_minute/hour/day) drop monthly so
  retention is configurable per-table.

## Cutover from legacy SaaS

See [CUTOVER.md](./CUTOVER.md) for the step-by-step plan +
data preservation guarantees.

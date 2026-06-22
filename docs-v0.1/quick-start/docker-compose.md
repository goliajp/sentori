# Quick start — docker compose

Run a single-workspace Sentori install on your laptop in under a minute.

## Requirements

- Docker 24+ (or any compose v2 — `docker compose version` says `v2.x.x`).
- 1 GB free RAM.
- Ports 5432 (postgres) + 8080 (sentori) free.

## Boot

```bash
git clone https://github.com/goliajp/sentori-selfhosted
cd sentori-selfhosted/self-hosted/docker
cp .env.example .env
# edit .env — set POSTGRES_PASSWORD + SENTORI_BOOTSTRAP_OWNER_EMAIL/PASSWORD
docker compose up -d
```

Wait ~20 seconds for the postgres healthcheck + first-time
migration to land. Then:

```bash
curl http://localhost:8080/healthz
# → {"status":"ok","db":"ok","version":"0.1.0"}
```

## First-owner bootstrap

Setting both `SENTORI_BOOTSTRAP_OWNER_EMAIL` and
`SENTORI_BOOTSTRAP_OWNER_PASSWORD` in `.env` makes the
server auto-create the Owner user on first boot. If you
leave them unset, sign up via the dashboard `/signup` flow
once the web UI is wired in Phase 5.

The bootstrap is **idempotent** — subsequent restarts
detect the existing Owner row and skip.

## Send a test event

```bash
PROJECT_ID="$(curl -s http://localhost:8080/v1/projects | jq -r '.[0].id')"

curl -X POST "http://localhost:8080/v1/events/$PROJECT_ID" \
  -H 'content-type: application/json' \
  -d '{
    "kind": "error",
    "error_type": "TypeError",
    "message": "x is undefined",
    "platform": "javascript",
    "release": "myapp@1.0.0",
    "environment": "production"
  }'
# → 202 Accepted with {"event_id": "...", "issue_id": "...", "is_new": true}
```

## Stop / wipe

```bash
docker compose down       # stop + keep data
docker compose down -v    # stop + wipe pg volume
```

## Next

- [Concept overview](../concept/overview.md)
- [Helm install](./helm.md) — same stack in Kubernetes
- [SDK integration](../reference/sdk-integration.md)

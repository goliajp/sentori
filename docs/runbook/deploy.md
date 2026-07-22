# Deploy

We deploy by tagging a release on `main`, pulling the GHCR image on the app VM, and rolling the two server containers (`server-blue`, `server-green`) one at a time. There is no staging environment yet — we promote straight from `main` to prod with the blue/green roll as the safety net. This runbook is the canonical procedure.

## Pre-flight

Before you cut a tag:

1. CI on `master` is green — `build`, `v0.2 core`, and `mobile-e2e` if
   it ran. A red gate is fixed before a tag, never deployed around.
2. Migrations live in `core/migrations/` and run at boot, so a new one
   ships the moment the image does. Confirm it is idempotent: it will
   be re-applied on every restart of every self-hosted install.
3. Run the local gates the CI runs, using the same commands — `cargo
   test` without `--all-targets` skips every integration test and still
   exits 0:
   ```sh
   cd core              && cargo test --workspace --all-targets
   cd self-hosted/server && cargo test --all-targets
   cd webapp            && bun run check
   bash scripts/check-rfc3339.sh
   ```
4. Note the previous version in case you need to roll back. `docker exec sentori-server-blue env | grep SENTORI_VERSION` on the app VM, or read `compose/.env`.

## Cut the release

```sh
# On your laptop, on a clean main:
git pull
git tag v<X.Y.Z>
git push origin v<X.Y.Z>
```

The `pages` GitHub Actions workflow auto-deploys marketing + docs on push to `main`. The server + web images are built and pushed to GHCR by `build.yml` — wait until both are green before continuing.

## Roll one container at a time

On the app VM:

```sh
cd /etc/sentori
export SENTORI_VERSION=v<X.Y.Z>

# Pull the new image (doesn't touch running containers)
docker compose -f /etc/sentori/production-compose.yml --env-file ./.env pull

# Roll server-blue first
docker compose -f /etc/sentori/production-compose.yml --env-file ./.env \
    up -d --no-deps server-blue
```

Now sit on the Grafana overview dashboard for 5 minutes:

- `sentori_ingest_total{status="accepted"}` rate stays steady
- `sentori_ingest_total{status="rejected"}` rate **does not** spike
- p99 ingest duration stays in the same band
- Caddy logs are clean (`docker logs caddy --tail=100`)

If anything looks wrong, run the rollback section below before rolling green.

If everything is fine after 5 min, roll green:

```sh
docker compose -f /etc/sentori/production-compose.yml --env-file ./.env \
    up -d --no-deps server-green
```

Watch dashboards for another 5 min. Caddy's `lb_policy ip_hash` keeps each client pinned to one upstream during the swap, so no in-flight session loses its server-side state.

## Migrations

Migrations live in `server/migrations/` and are applied at server start by `sqlx::migrate!`. Nothing to do during the roll itself — the first server container to come up runs them. Subsequent containers see "already applied" and are no-ops.

**Important caveat:** never push a destructive migration (drop column, drop table, narrowing constraint) and a code change that depends on the new shape *in the same image*. If a roll halfway happens (blue is the new image, green is the old image), the old code can crash on the new schema. Stage destructive changes:

1. Tag N: code that **tolerates** both old and new shapes; migration adds the new shape.
2. Tag N+1: code that **requires** the new shape; migration drops the old shape.

Wait at least one full backup cycle (24h) between N and N+1 so you have a clean rollback path.

## Rollback

```sh
SENTORI_VERSION=v<X.Y.Z-prev> \
  docker compose -f /etc/sentori/production-compose.yml --env-file ./.env \
    up -d --no-deps server-blue server-green
```

Roll both at once on rollback (no need for the staggered roll — by definition the previous version is the one you trust). After they're up, check the same dashboards.

If a migration was applied and the rollback puts you on code that doesn't know about the new schema, that's the staging issue from the previous section — your only safe move is **forward** with a fix. Resist the urge to manually hand-edit the schema.

## After-deploy

- Update the Better Stack status page if there was any user-visible blip.
- Post the rolled-out tag in `#sentori-ops` ("v<X.Y.Z> deployed; smoke green; rolling next thing in 24h" or similar).
- If anything surprised you, write it down in the postmortem dir even if it didn't reach P1/P2 — silent surprises are how production gets surprising.

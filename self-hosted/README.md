# Sentori self-hosted

OSS RN-first error monitoring + APM.

[![License](https://img.shields.io/badge/license-Apache--2.0%20OR%20MIT-blue.svg)](../LICENSE-APACHE)
[![Docker](https://img.shields.io/badge/ghcr.io-sentori--selfhosted-blue.svg)](https://github.com/orgs/goliajp/packages/container/package/sentori-selfhosted)

## Try it in 30 seconds

```bash
docker run -d --name sentori-pg \
    -e POSTGRES_PASSWORD=changeme -p 5432:5432 \
    postgres:18-alpine

docker run -d --name sentori \
    -e SENTORI_DATABASE_URL='postgres://postgres:changeme@host.docker.internal:5432/postgres' \
    -e SENTORI_BOOTSTRAP_OWNER_EMAIL='you@example.com' \
    -e SENTORI_BOOTSTRAP_OWNER_PASSWORD='change-me-please' \
    -p 8080:8080 \
    ghcr.io/goliajp/sentori-selfhosted:latest

curl http://localhost:8080/healthz
# → {"status":"ok","db":"ok","version":"0.1.0"}
```

For the complete stack with healthchecks +
`docker-compose`: see [`docker/`](./docker/) or read the
[Docker quick start](../docs-v0.1/quick-start/docker-compose.md).

For Kubernetes:

```bash
helm install sentori oci://ghcr.io/goliajp/charts/sentori-selfhosted \
    --namespace sentori --create-namespace \
    --set server.bootstrap.ownerEmail=you@example.com \
    --set server.bootstrap.ownerPassword='change-me-please'
```

Full guide: [Helm quick start](../docs-v0.1/quick-start/helm.md).

## What's inside

| Path | Description |
|---|---|
| [`server/`](./server/) | The axum binary. Standalone Cargo workspace (independent of `core/`'s workspace so the docker layer builds cleanly). Composes every K crate from `core/`. |
| [`migrations/`](./migrations/) | Symlinks to `core/migrations/0001-0015`. Single source of truth for schema. |
| [`docker/`](./docker/) | `Dockerfile` (multi-stage → distroless cc, < 80 MB) + `docker-compose.yml` (postgres + server) + `.env.example`. |
| [`helm/`](./helm/) | Chart `sentori-selfhosted` v0.1.0 — Deployment + StatefulSet postgres + Service + Ingress + NOTES. |

Per [cement-stone methodology](../.claude/state/refactor-standards.md),
everything here is **水泥** (cement) — selfhosted-specific
composition over the 17 K-tier (钢筋) and 13 stones in
`core/`.

## Architecture (the short version)

- **Single workspace per database** — one Sentori install
  = one Postgres database. No multi-tenant logic in the
  data plane.
- **17 K-tier crates** in `core/crates/` handle every
  ingest concern: events (K4), issues (K5), spans (K6),
  push tokens (K7), replays (K8), runtime metrics (K9),
  CT log monitoring (K10), notifier (K11), integrations
  (K12), audit log (K13), alert rules (K14), saved views
  (K15), ACL gate (K16), billing quotas (K17).
- **13 stones** in `core/crates/` are pure libraries
  (S1 license JWT, S2 privacy salt, S3 issue fingerprint,
  S4 event ringbuffer, S5 Stripe webhook verify, S6/S7/S8
  sourcemap/DWARF/ProGuard resolvers, S9 cookie session,
  S10 rate limiter, S11 geoip reader, S12 secrets vault,
  S13 argon2 password).
- **0 unsafe code** in `core/`
  (`#![forbid(unsafe_code)]`).
- **All K-tier services share one Postgres pool** via
  `AppState` in `self-hosted/server/src/state.rs`.

Read [`docs-v0.1/concept/overview.md`](../docs-v0.1/concept/overview.md)
for the full picture.

## SDK ingest

```
POST /v1/events/{project_id}
Content-Type: application/json

{
  "kind": "error",
  "error_type": "TypeError",
  "message": "x is undefined",
  "platform": "javascript",
  "release": "myapp@1.0.0",
  "environment": "production"
}
```

See [SDK integration reference](../docs-v0.1/reference/sdk-integration.md).

## Environment variables

See [reference/env-vars.md](../docs-v0.1/reference/env-vars.md).
Required: `SENTORI_DATABASE_URL`. Optional but
recommended: `SENTORI_BOOTSTRAP_OWNER_EMAIL` +
`SENTORI_BOOTSTRAP_OWNER_PASSWORD` for first-boot Owner
creation.

## Versioning

`v0.x.y` is an active-development line — minor versions
may introduce breaking changes documented in the changelog
+ migration notes. The v1.0.0 stability promise lands
when the SDK + dashboard surface is frozen.

Docker tags:
- `:latest` — newest stable release.
- `:0.1.0` (and other semver) — pinned releases.
- `:edge` — main-branch build (latest commit).
- `:sha-<7chars>` — commit-pinned image.

## Issues + contributing

- Bug? open an issue with the
  [bug report template](../.github/ISSUE_TEMPLATE/bug_report.md).
- Feature? open one with the
  [feature template](../.github/ISSUE_TEMPLATE/feature_request.md).
- PRs welcome — read
  [CONTRIBUTING.md](../.github/CONTRIBUTING.md) first.
- Security issues: **security@golia.jp** (see
  [SECURITY.md](../.github/SECURITY.md)).

## License

Dual-licensed Apache-2.0 OR MIT at the user's choice.
Copyright © GOLIA K.K. See
[`LICENSE-APACHE`](../LICENSE-APACHE),
[`LICENSE-MIT`](../LICENSE-MIT), and
[`NOTICES.md`](../NOTICES.md).

## Zero dependency on `legacy server/`

The `server/` + `web/` directories at the monorepo root
are the **legacy** sentori implementation, kept as
read-only reference until SH6 retire. The v0.1
self-hosted binary is a fresh-start implementation that
does NOT import any legacy code.

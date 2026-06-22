# Sentori SaaS cutover — legacy → v0.2

> Status: draft. Cutover is user-gated; do not execute without explicit
> approval. The steps below are the autonomous-design plan for when
> the user pulls the trigger.

## Pre-flight (no production impact)

These can run whenever, repeatedly, without touching prod.

```
# 1. Provision the v0.2 cluster (postgres + sentori-server + sentori-saas-control)
#    on a separate DB host. Migrations run automatically on first boot.
docker compose -f self-hosted/docker/docker-compose.yml up -d

# 2. Build sentori-migrate (one-shot binary; no daemon)
cargo build --release -p sentori-migrate

# 3. Dry-run the ETL with SaaS prod credentials read-only
./target/release/sentori-migrate \
  --src "postgres://sentori_ro:$LEGACY_PW@sentori.golia.jp:5432/sentori" \
  --dst "postgres://sentori:$V02_PW@v02-host:5432/sentori" \
  --dry-run
# Output: per-set read counts. Confirm they match expectations.

# 4. Real ETL (idempotent; ON CONFLICT DO NOTHING throughout)
./target/release/sentori-migrate \
  --src "postgres://sentori_ro:$LEGACY_PW@sentori.golia.jp:5432/sentori" \
  --dst "postgres://sentori:$V02_PW@v02-host:5432/sentori"
# This is safe to re-run — only new rows get written.

# 5. Sanity-check a few rows
psql $V02_URL -c "SELECT COUNT(*) FROM workspaces"
psql $V02_URL -c "SELECT COUNT(*) FROM events"
psql $V02_URL -c "SELECT COUNT(*) FROM tokens WHERE revoked_at IS NULL"
```

## Cutover (production impact — short outage)

The token contract is preserved end-to-end; no SDK changes required.

```
# 1. Freeze legacy writes (1-minute outage window starts)
#    Either:
#    a) Switch legacy ingest Caddy block to 503 maintenance
#    b) Or block port-level in firewall
#    c) Or set legacy server's READ_ONLY=1 env if supported

# 2. Final delta ETL (catches anything between dry-run and cutover)
./target/release/sentori-migrate --src "..." --dst "..." \
  --tables identity,tokens,events,issues,sessions,spans,push,attachments,\
           dashboard,dashboard_extra,analytics,metrics,ops

# 3. Flip ingest.sentori.golia.jp DNS / Caddy reverse-proxy
#    to point at v0.2 cluster.
#    SDKs (existing apps in the field) hit the same URL with the
#    same token; they don't know anything changed.

# 4. Smoke test ingest from a real device
#    or curl manually:
curl -X POST https://ingest.sentori.golia.jp/v1/events \
  -H "Authorization: Bearer st_pk_<actual-prod-token>" \
  -H "Content-Type: application/json" \
  -d '{ "type": "error", "message": "cutover smoke test" }'
# Expect 202 Accepted.

# 5. Flip sentori.golia.jp (dashboard) DNS / Caddy similarly.
# 6. Outage window ends.
```

## Post-cutover monitoring

```
# Watch v0.2 logs for any 401 / 5xx spikes
docker logs -f sentori-server | grep -E '(401|5..)'

# Check push_worker is draining queued sends
psql $V02_URL -c \
  "SELECT status, COUNT(*) FROM push_sends GROUP BY status"

# Check session-gated admin endpoints from a real login
curl -X POST https://sentori.golia.jp/auth/login \
  -d '{"email": "you@golia.jp", "password": "..."}'
# Then exercise admin endpoints with the returned token.
```

## Rollback

Legacy DB is untouched during cutover (read-only). If v0.2 misbehaves:

```
# Flip Caddy / DNS back to legacy host.
# Note: any data that ingested into v0.2 between cutover-start
# and rollback is *only* in v0.2 — copy it back with a reverse
# sentori-migrate run (target legacy schema).
```

The 1-minute freeze window keeps the divergent-write surface small;
a planned 5-second window is realistic if the ETL job is parallelized.

## Data preservation guarantee

- **Tokens**: legacy tokens persist verbatim (SHA-256 hash + last4 + kind
  copied 1:1). Existing SDKs continue authing.
- **Events / issues / sessions / spans / metrics / push / track / security
  events / federation links / user reports**: all rows ETL'd with
  `workspace_id = legacy_orgs.id` (identity rename only).
- **Members**: role 4-level (owner/admin/member/viewer) → 3-level
  (owner/admin/user) with viewer + member → user mapping.
- **Teams + project_teams + team_memberships**: NOT migrated in v0.2.
  Legacy rows preserved on legacy DB; re-enable post-v0.2 if needed.
- **Saved views / alert rules / integrations / audit logs / watchers /
  notifications / activity log / issue comments + integration links +
  mutes**: full 1:1 copy.

Edge cases that may need hand-fix-up:
- legacy users with `viewer` role expecting strict read-only: now `user`;
  enforce via app-layer ACL if needed.
- legacy `org_ownership_transfers` mid-flight: drained pre-cutover.
- in-flight push_sends queued in legacy: drain pre-cutover (5-minute
  pause for worker queue to clear).

-- v2.4 — backfill identity_fingerprints from historical events.payload.
--
-- Context. Prior to migration 0066 the identity_fingerprints table
-- didn't actually exist in the schema (its CREATE TABLE never made
-- it in), so the ingest-time write was a no-op via tracing::warn.
-- All historical event payloads still carry `payload.user.linkHashes`
-- (the SDK has shipped `setUser({ linkBy: ... })` since v2.3), they
-- just never reached the fingerprint table.
--
-- This migration replays each historical event into the fingerprint
-- table using the same formula `identity::compute_fingerprint` uses
-- at ingest:
--
--   stored = sha256(scope.salt || key_type || ':' || client_hash)
--
-- Idempotent: the INSERT is ON CONFLICT DO NOTHING keyed on
-- (event_id, scope_id, key_type) — running twice is a no-op. On a
-- cold install (zero historical events, zero linkHashes) it's an
-- empty INSERT.
--
-- Safety:
--   - We trust `is_valid_client_hash` was enforced at ingest, but
--     keep a `length = 64` guard so a single broken historical row
--     can't poison the backfill.
--   - Events whose project no longer has a default identity_scope
--     (shouldn't happen post-0065) silently skip — the inner JOIN
--     filters them out.

INSERT INTO identity_fingerprints (event_id, scope_id, key_type, fingerprint, received_at)
SELECT
    e.id AS event_id,
    s.id AS scope_id,
    kv.key AS key_type,
    digest(
        s.salt
        || convert_to(kv.key, 'UTF8')
        || convert_to(':', 'UTF8')
        || convert_to(kv.value, 'UTF8'),
        'sha256'
    ) AS fingerprint,
    e.received_at
FROM events e
JOIN projects p ON p.id = e.project_id
JOIN org_identity_scopes ois ON ois.org_id = p.org_id AND ois.is_default = true
JOIN identity_scopes s ON s.id = ois.scope_id
CROSS JOIN LATERAL jsonb_each_text(
    COALESCE(e.payload->'user'->'linkHashes', '{}'::jsonb)
) AS kv(key, value)
WHERE length(kv.value) = 64
  AND kv.value ~ '^[0-9a-f]+$'
ON CONFLICT (event_id, scope_id, key_type) DO NOTHING;

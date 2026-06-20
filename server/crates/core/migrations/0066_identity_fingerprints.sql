-- v2.3 W6.c — identity_fingerprints table.
--
-- The companion to identity_scopes (0065). Each event with one or
-- more user identity keys (email / phone / oauth_sub / ...) gets one
-- row per key here. The salt comes from identity_scopes.salt; the
-- stored value is sha256(salt || key_type || ":" || client_hash) —
-- see server/src/identity.rs::compute_fingerprint.
--
-- Why this lives in a separate migration from 0065: the table was
-- referenced by the ingest path (write_event_fingerprints) and the
-- admin lookup endpoint since v2.3 W6.b shipped, but its CREATE TABLE
-- never made it into a migration. Backfilling here so cold installs
-- and CI both build clean. Existing prod installs that somehow
-- already have the table (created out-of-band) are unaffected via
-- IF NOT EXISTS.
--
-- Schema notes:
--   - PK (event_id, scope_id, key_type) — one event can carry several
--     key types (email + googleSub), but at most one row per key type.
--   - fingerprint stored as BYTEA(32) raw — same shape compute_
--     fingerprint returns.
--   - received_at duplicated from events.received_at for cheap
--     window queries (avoids a join when only the time bucket matters,
--     e.g. "top affected fingerprints, last 7d").
--   - ON DELETE CASCADE on scope_id mirrors the existing scope-
--     deletion semantic from 0065. No FK on event_id because events
--     is range-partitioned (events_partitioned, migration 0003) and
--     cross-partition FKs aren't supported.

CREATE TABLE IF NOT EXISTS identity_fingerprints (
    event_id     UUID         NOT NULL,
    scope_id     UUID         NOT NULL REFERENCES identity_scopes(id) ON DELETE CASCADE,
    key_type     TEXT         NOT NULL,
    fingerprint  BYTEA        NOT NULL CHECK (octet_length(fingerprint) = 32),
    received_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    PRIMARY KEY (event_id, scope_id, key_type)
);

-- Forward lookup (operator types raw value → server computes stored
-- fingerprint → query here).
CREATE INDEX IF NOT EXISTS identity_fingerprints_lookup_idx
    ON identity_fingerprints (scope_id, key_type, fingerprint);

-- Recent-window scans for the Users overview (most-affected fingerprints
-- in last N days).
CREATE INDEX IF NOT EXISTS identity_fingerprints_recent_idx
    ON identity_fingerprints (scope_id, received_at DESC);

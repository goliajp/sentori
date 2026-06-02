-- v1.1 chunk S2 — security events.
--
-- `sentori.reportSecurity(kind, data)` posts here. The shape is a
-- thin envelope (kind + opaque jsonb data); per-kind structure is
-- enforced client-side by helper functions (`reportPinMismatch`,
-- future `reportRootDetected`, etc.) so the server can ingest new
-- kinds without a schema bump.
--
-- Separate table from `events` (errors / ANRs / near-crashes) so:
--   - the retention policy can diverge (security data may need to
--     live longer for the trust scoring engine in S3)
--   - high-cardinality kinds don't pollute issue grouping
--   - the analytics path doesn't pay for the JSONB blob when not
--     reading security data
--
-- ASN + install_id (S1) ride as proper columns rather than nested
-- inside `data` so the trust scoring engine can filter without
-- cracking JSONB.

CREATE TABLE IF NOT EXISTS security_events (
    id           UUID        PRIMARY KEY,
    project_id   UUID        NOT NULL,
    kind         TEXT        NOT NULL,
    user_id      TEXT,
    install_id   TEXT,
    release      TEXT,
    environment  TEXT,
    country      TEXT,
    asn          INTEGER,
    asn_org      TEXT,
    server_name  TEXT,
    data         JSONB       NOT NULL DEFAULT '{}'::jsonb,
    occurred_at  TIMESTAMPTZ NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_project_ts_idx
    ON security_events (project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS security_events_project_kind_ts_idx
    ON security_events (project_id, kind, occurred_at DESC);

CREATE INDEX IF NOT EXISTS security_events_project_install_ts_idx
    ON security_events (project_id, install_id, occurred_at DESC)
    WHERE install_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS security_events_project_asn_ts_idx
    ON security_events (project_id, asn, occurred_at DESC)
    WHERE asn IS NOT NULL;

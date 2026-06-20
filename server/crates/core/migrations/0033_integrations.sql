-- Phase 43 sub-A.01 — typed external integrations.
--
-- Each row is one connection between a Sentori org and an external
-- service (Linear, Slack, …). The `kind` column gates which adapter
-- (`integrations::linear`, `integrations::slack`, …) interprets
-- `config_jsonb`. We keep one row per (org, kind) — reconnecting
-- updates rather than creating a new row.
--
-- `config_jsonb` carries the adapter's persisted state: OAuth access
-- tokens, refresh tokens, workspace IDs, default-team configuration,
-- etc. The exact shape is up to each adapter; the DB just treats it
-- as opaque JSON.
--
-- Plain JSONB for v0.7. If we ever need at-rest encryption, the
-- `session_secret`-derived key + a small `secret_blob BYTEA` column
-- is the planned path; until then, DB-level access controls + the
-- absence of a public read endpoint are enough.

CREATE TABLE IF NOT EXISTS integrations (
    id          UUID PRIMARY KEY,
    org_id      UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL CHECK (kind IN ('linear', 'slack')),
    config      JSONB NOT NULL DEFAULT '{}'::JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);

-- One active connection per (org, kind). Re-connect via UPSERT.
CREATE UNIQUE INDEX IF NOT EXISTS integrations_org_kind_active_uniq
    ON integrations (org_id, kind)
    WHERE revoked_at IS NULL;

-- Phase 43 sub-B.02 — per-issue link to its external counterpart.
-- One row per (issue, integration_kind) so an issue can be linked to
-- both a Linear ticket and a Slack thread without colliding.
CREATE TABLE IF NOT EXISTS issue_integration_links (
    issue_id       UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    integration_kind TEXT NOT NULL,
    external_id    TEXT NOT NULL,
    external_url   TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (issue_id, integration_kind)
);

CREATE INDEX IF NOT EXISTS issue_integration_links_external_idx
    ON issue_integration_links (integration_kind, external_id);

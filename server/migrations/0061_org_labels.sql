-- v1.4 W24 — per-org label catalog + colors + SLA timer.
--
-- v1.2 W4 introduced `issues.labels TEXT[]` as a free-form per-issue
-- list of strings. Operators could type anything; there was no
-- shared catalog, no color encoding, no time-based escalation.
--
-- W24 adds:
--   - `org_labels` — the catalog. Each label is named once per org
--     and carries an optional color (CSS hex) + optional SLA-hours
--     value used to compute "is this p0 overdue?".
--   - `projects.fingerprint_with_labels` — opt-in per-project flag
--     to include label set in fingerprint grouping. NOTE: labels
--     today are dashboard-set, never SDK-set; this flag is a
--     schema/UI carry-forward for the v2.0 SDK protocol bump that
--     will let SDKs attach labels at submit time. Setting the flag
--     in v1.4 has no behavioural effect on the ingest path.

CREATE TABLE IF NOT EXISTS org_labels (
    id                   UUID PRIMARY KEY,
    org_id               UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    -- Stored case-sensitive; UI is responsible for normalising.
    name                 TEXT NOT NULL,
    -- CSS color literal (e.g. '#ff8800' or 'tomato'). Optional;
    -- NULL falls back to the dashboard's accent palette.
    color                TEXT,
    -- When set, p0/p1 issues carrying this label that go un-resolved
    -- for more than `sla_priority_hours` hours surface an SLA-breach
    -- badge in the dashboard.
    sla_priority_hours   INTEGER,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS org_labels_org_idx ON org_labels (org_id);

ALTER TABLE projects
    ADD COLUMN IF NOT EXISTS fingerprint_with_labels BOOLEAN NOT NULL DEFAULT FALSE;

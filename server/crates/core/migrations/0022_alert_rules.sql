-- Phase 27 sub-A: alert rules.
--
-- One row per rule. A rule is project-scoped (project_id set) or
-- org-wide (project_id NULL — fires on any project in the org).
-- Triggers and filters are JSONB so the evaluator can pick up new
-- shapes without migrations; the CHECK on trigger_kind keeps the
-- enum surface tight.
--
-- Trigger kinds (v0.2):
--   - new_issue     — first event of a fingerprint
--   - regression    — `resolved → regressed` flip (Phase 23 sub-D)
--   - event_count   — ≥N events match filter inside `windowMinutes`
--   - crash_free_drop — crash-free session rate dips below threshold
--                       in the last `windowMinutes`
--
-- Trigger config shapes (camelCase, evaluator parses):
--   new_issue:        {}
--   regression:       {}
--   event_count:      { count: 100, windowMinutes: 5 }
--   crash_free_drop:  { threshold: 0.99, windowMinutes: 60 }
--
-- Filter config:
--   { environment?, release?, errorTypeRegex? }
--
-- Channels: array of { type: 'email' | 'webhook', ... }.
--   email:   { type: 'email', to: ['a@b.com'] }
--   webhook: { type: 'webhook', url, secret }   — secret signs HMAC
--
-- Throttle prevents alert storms — same rule can't fire more than
-- once per `throttle_minutes`. Cron evaluator (sub-B) checks
-- `last_fired_at` before sending.

CREATE TABLE IF NOT EXISTS alert_rules (
    id               UUID PRIMARY KEY,
    org_id           UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    project_id       UUID REFERENCES projects(id) ON DELETE CASCADE,
    name             TEXT NOT NULL,
    enabled          BOOLEAN NOT NULL DEFAULT TRUE,

    trigger_kind     TEXT NOT NULL CHECK (trigger_kind IN
        ('new_issue', 'regression', 'event_count', 'crash_free_drop')),
    trigger_config   JSONB NOT NULL DEFAULT '{}'::jsonb,
    filter_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
    channels         JSONB NOT NULL DEFAULT '[]'::jsonb,

    throttle_minutes INTEGER NOT NULL DEFAULT 10 CHECK (throttle_minutes >= 0),
    last_fired_at    TIMESTAMPTZ,

    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by       UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_rules_org_idx ON alert_rules (org_id);
CREATE INDEX IF NOT EXISTS alert_rules_project_idx
    ON alert_rules (project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS alert_rules_enabled_idx
    ON alert_rules (enabled, trigger_kind) WHERE enabled = TRUE;

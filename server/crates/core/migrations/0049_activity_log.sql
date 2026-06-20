-- v1.2 W5 — unified per-issue mutation feed.
--
-- Until now `list_issue_activity` synthesised an event stream from
-- two disjoint tables: `issue_comments` for prose, and
-- `issues.resolved_at`/`regressed_at` for status transitions. That
-- meant transitions other than resolved/regressed (silenced,
-- assignee changes, merges, labels & priority changes coming in W4,
-- mute coming in W6) had no audit trail at all. Operators couldn't
-- answer "who muted this and when" without `git log`-ing the dashboard.
--
-- This migration introduces a single append-only `activity_log` table.
-- All future mutation paths write one row per state change; the read
-- side (`list_issue_activity`) merges these with the legacy synthesised
-- entries so issues whose transitions predate this table still display
-- their resolved/regressed markers.
--
-- No backfill: per the v1.2 roadmap, we accept that pre-existing
-- non-resolved/regressed transitions (silence, assignee changes) are
-- lost. They'll repopulate on the next mutation.

CREATE TABLE IF NOT EXISTS activity_log (
    id          BIGSERIAL PRIMARY KEY,
    issue_id    UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    verb        TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'::JSONB,
    at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The dominant access pattern is "this issue's feed in reverse
-- chrono". Composite index covers both filter + sort.
CREATE INDEX IF NOT EXISTS activity_log_issue_at_idx
    ON activity_log (issue_id, at DESC);

-- "What did this user do" — secondary, scoped per-actor. Smaller and
-- not on the hot path; partial to skip the unattributed system rows.
CREATE INDEX IF NOT EXISTS activity_log_actor_at_idx
    ON activity_log (actor_id, at DESC)
    WHERE actor_id IS NOT NULL;

-- v0.8.2 — end-user-submitted bug reports.
--
-- Distinct from automatic error events: this is the "tap a button to
-- send feedback" surface that ships from inside the host app. Carries
-- a free-form title + body plus an optional `event_id` linking the
-- report to a specific crash the user just experienced (the host app
-- typically does the link automatically — show a "report this crash"
-- prompt after captureException). When `event_id` is NULL the report
-- lands in the project's Inbox.
--
-- Auth shape: ingest token (st_pk_…), same boundary as /v1/events.
-- No PII enforcement at this layer; the host app decides whether to
-- include the user's email + name. Length caps below mirror the wire
-- validation in `event::UserReport`.

CREATE TABLE IF NOT EXISTS user_reports (
    id            UUID PRIMARY KEY,
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    event_id      UUID,
    issue_id      UUID REFERENCES issues(id) ON DELETE SET NULL,
    title         TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    body          TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 8000),
    email         TEXT CHECK (email IS NULL OR char_length(email) <= 320),
    name          TEXT CHECK (name IS NULL OR char_length(name) <= 200),
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index the common dashboard queries: latest per project, per issue.
CREATE INDEX IF NOT EXISTS user_reports_project_received_idx
    ON user_reports (project_id, received_at DESC);

CREATE INDEX IF NOT EXISTS user_reports_issue_idx
    ON user_reports (issue_id)
    WHERE issue_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_reports_event_idx
    ON user_reports (event_id)
    WHERE event_id IS NOT NULL;

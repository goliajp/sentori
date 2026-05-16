-- v0.9.3 +S3 — culprit commit tracking.
--
-- One issue ↔ many candidate commits. Each row records:
--   - the commit SHA the operator (or future auto-detector) believes
--     introduced the issue
--   - GitHub metadata fetched at insert time (author, message,
--     committed_at, html_url) so the dashboard renders without
--     needing GitHub at view time
--   - confidence score (0-100). manual = 100.
--   - source (manual / auto) — auto will land in v1.0 with PAT-based
--     git history sync.
--
-- ON DELETE CASCADE so deleting an issue cleans its culprits.

CREATE TABLE IF NOT EXISTS culprit_commits (
    id              UUID PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_id        UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    commit_sha      TEXT NOT NULL CHECK (char_length(commit_sha) BETWEEN 7 AND 64),
    author          TEXT,
    message         TEXT,
    committed_at    TIMESTAMPTZ,
    html_url        TEXT,
    confidence      INTEGER NOT NULL DEFAULT 100 CHECK (confidence BETWEEN 0 AND 100),
    source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'auto')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (issue_id, commit_sha)
);

CREATE INDEX IF NOT EXISTS culprit_commits_issue_created_idx
    ON culprit_commits (issue_id, created_at DESC);

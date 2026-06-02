-- Phase 5 sub-section B: releases + issues + event linkage.

CREATE TABLE IF NOT EXISTS releases (
    id          UUID PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,                 -- e.g. "myapp@1.2.3+456"
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, name)
);

CREATE TABLE IF NOT EXISTS issues (
    id             UUID PRIMARY KEY,
    project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    fingerprint    TEXT NOT NULL,
    error_type     TEXT NOT NULL,
    message_sample TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'silenced', 'closed')),
    first_seen     TIMESTAMPTZ NOT NULL,
    last_seen      TIMESTAMPTZ NOT NULL,
    event_count    BIGINT NOT NULL DEFAULT 0,
    UNIQUE (project_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS issues_project_status_last_seen_idx
    ON issues (project_id, status, last_seen DESC);

ALTER TABLE events ADD COLUMN IF NOT EXISTS issue_id UUID
    REFERENCES issues(id) ON DELETE CASCADE;
ALTER TABLE events ADD COLUMN IF NOT EXISTS release_id UUID
    REFERENCES releases(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS events_issue_received_idx
    ON events (issue_id, received_at DESC);

-- Phase 9: notification recipients per project + email on new issue.

CREATE TABLE IF NOT EXISTS notification_recipients (
    id              UUID PRIMARY KEY,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    email           TEXT NOT NULL,
    on_new_issue    BOOLEAN NOT NULL DEFAULT TRUE,
    on_regression   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, email)
);

CREATE INDEX IF NOT EXISTS notification_recipients_project_idx
    ON notification_recipients (project_id);

-- Phase 5 sub-section A: project / token / events tables.
-- Issues + grouping land in sub-section B; partitioning in sub-section D.

CREATE TABLE IF NOT EXISTS projects (
    id          UUID PRIMARY KEY,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokens (
    id          UUID PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token_hash  TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL CHECK (kind IN ('public', 'admin')),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS tokens_project_id_idx ON tokens (project_id);

CREATE TABLE IF NOT EXISTS events (
    id            UUID PRIMARY KEY,
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    occurred_at   TIMESTAMPTZ NOT NULL,
    platform      TEXT NOT NULL,
    release       TEXT NOT NULL,
    environment   TEXT NOT NULL,
    error_type    TEXT NOT NULL,
    error_message TEXT NOT NULL,
    payload       JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS events_project_received_idx
    ON events (project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS events_project_environment_idx
    ON events (project_id, environment);

-- Phase 26 sub-A: session pings.
--
-- One row per *finished* session. The SDK fires a single ping when the
-- session closes (foreground→background, normal exit, or unrecoverable
-- crash). v0.2 doesn't track active sessions or session updates — that
-- complexity (Sentry-style init + close + state machine) costs more
-- than it adds when crash-free-rate is the primary signal.
--
-- `user_id` is the *application's* user id (the same value SDK callers
-- set via `sentori.setUser({ id })`), not `users.id`. NULL means an
-- anonymous session — counted in session-rate but not user-rate.

CREATE TABLE IF NOT EXISTS sessions (
    id          UUID PRIMARY KEY,
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     TEXT,
    release     TEXT NOT NULL,
    environment TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('ok', 'errored', 'crashed', 'exited')),
    started_at  TIMESTAMPTZ NOT NULL,
    duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sessions_project_release_idx
    ON sessions (project_id, release, received_at DESC);
CREATE INDEX IF NOT EXISTS sessions_project_received_idx
    ON sessions (project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS sessions_project_user_idx
    ON sessions (project_id, user_id) WHERE user_id IS NOT NULL;

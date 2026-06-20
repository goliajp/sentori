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
--
-- Phase 29 task 16 fix: this migration originally created a `sessions`
-- table that collided with 0007's auth-login `sessions` table. On a
-- fresh DB the IF NOT EXISTS silently skipped, then the index CREATE
-- failed on the missing project_id column and the whole server boot
-- aborted. We now:
--   1. detect the auth-schema `sessions` table (by absence of
--      project_id) and rename it to `auth_sessions` first,
--   2. ensure `auth_sessions` exists (covers dev systems that worked
--      around the conflict by `DROP TABLE sessions` before this fix),
--   3. then create the event-pings `sessions` table as originally
--      intended.
-- `user_auth.rs` queries `auth_sessions` going forward.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'sessions'
    )
    AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'sessions'
          AND column_name = 'project_id'
    ) THEN
        ALTER TABLE sessions RENAME TO auth_sessions;
        ALTER INDEX IF EXISTS sessions_user_id_idx
            RENAME TO auth_sessions_user_id_idx;
        ALTER INDEX IF EXISTS sessions_expires_at_idx
            RENAME TO auth_sessions_expires_at_idx;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS auth_sessions (
    id          TEXT PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at  TIMESTAMPTZ NOT NULL,
    ip          TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx
    ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
    ON auth_sessions (expires_at);

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

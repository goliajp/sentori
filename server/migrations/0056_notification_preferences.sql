-- v1.3 W14 — per-user notification preferences.
--
-- v1.2 W8 fanned out every activity_log mutation to every watcher.
-- That's the right default but operators want to mute kinds they
-- don't care about (e.g. status_changed noise on a busy issue) and
-- pick a digest cadence so they're not paged at 3am.
--
-- Single row per user (PK). When missing, server treats it as
-- "all defaults" (empty mute list, immediate cadence, in-app
-- channel only). No backfill needed.

CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id      UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    muted_kinds  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- 'immediate' | 'hourly' | 'daily'. v1.3 only enforces
    -- 'immediate' (the existing fan-out path); hourly/daily are
    -- stored and surface in the UI but their digest worker lands
    -- in v1.4.
    cadence      TEXT NOT NULL DEFAULT 'immediate'
                     CHECK (cadence IN ('immediate', 'hourly', 'daily')),
    -- 'in_app' | 'email'. v1.3 only enforces 'in_app' (no email
    -- channel ships yet). Stored so the future email worker can
    -- read.
    channels     TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[],
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

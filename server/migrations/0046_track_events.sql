-- v1.1 chunk B — analytics `track` events.
--
-- Track events live in their own table so the high-volume analytics
-- query path doesn't fight the error / ANR retention loop on the
-- `events` table. Schema is intentionally narrow:
--   - one row per emit
--   - props is small JSONB (capped to ~40 keys client-side)
--   - dimensional columns (route, user_id, release, environment) are
--     materialised so per-dim filters don't have to crack JSONB
--
-- Hourly rollups land in chunk C; this table stays the source-of-truth
-- raw stream.
--
-- Indexes:
--   - (project_id, occurred_at DESC)        chronological list view
--   - (project_id, name, occurred_at DESC)  per-event-name funnel /
--                                           "events / min for name X"
--   - (project_id, user_id, occurred_at DESC) WHERE user_id IS NOT NULL
--                                           per-user activity panel
--                                           in chunk D
CREATE TABLE IF NOT EXISTS track_events (
    id          UUID        PRIMARY KEY,
    project_id  UUID        NOT NULL,
    name        TEXT        NOT NULL,
    user_id     TEXT,
    session_id  UUID,
    route       TEXT,
    release     TEXT,
    environment TEXT,
    props       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS track_events_project_ts_idx
    ON track_events (project_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS track_events_project_name_ts_idx
    ON track_events (project_id, name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS track_events_project_user_ts_idx
    ON track_events (project_id, user_id, occurred_at DESC)
    WHERE user_id IS NOT NULL;

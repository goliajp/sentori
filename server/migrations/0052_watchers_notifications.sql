-- v1.2 W8 — watchers + per-user notifications.
--
-- The activity_log table from W5 gives us "what happened to this
-- issue", but doesn't tell any specific operator "this happened on
-- an issue you care about." Watchers are the explicit subscription
-- (`I want pings about this issue's mutations`), and notifications
-- are the per-user inbox driven off the activity_log writes.
--
-- Two tables:
--
--   `watchers(issue_id, user_id, since)` — composite PK; one row per
--   (issue, user). Auto-populated when an issue is assigned to a
--   user (in W4's patch_issue / merge / bulk paths); operators may
--   also opt-in manually via the dashboard's per-issue "Watch"
--   toggle.
--
--   `notifications(id, user_id, kind, payload, read_at, created_at)`
--   — append-only; one row per (watcher, mutation). On activity_log
--   writes, the server enumerates watchers minus the actor and
--   enqueues one row per recipient. `kind` mirrors the activity
--   verb. `read_at = NULL` ⇒ unread.
--
-- No backfill: pre-W8 issues don't have watchers; the next mutation
-- that happens will start populating both tables.

CREATE TABLE IF NOT EXISTS watchers (
    issue_id    UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    since       TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (issue_id, user_id)
);

-- Secondary index for the "which issues am I watching" view in the
-- dashboard. Small + cheap.
CREATE INDEX IF NOT EXISTS watchers_user_idx ON watchers (user_id);

CREATE TABLE IF NOT EXISTS notifications (
    id          BIGSERIAL PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issue_id    UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'::JSONB,
    read_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Hot reads: "give me my recent unread notifications". Cover both
-- the unread filter and the chronological sort.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
    ON notifications (user_id, created_at DESC)
    WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS notifications_user_recent_idx
    ON notifications (user_id, created_at DESC);

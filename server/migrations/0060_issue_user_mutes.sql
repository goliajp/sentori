-- v1.4 W18 — per-issue mute (independent of per-kind global mute).
--
-- v1.3 W14 introduced notification_preferences.muted_kinds — global
-- "I don't care about status_changed events anywhere". W18 adds the
-- per-issue version: "I'm done with THIS particular issue, stop
-- pinging me even if I keep watching others of the same kind".
--
-- Mute > Watch: an operator can be a watcher AND have an issue
-- muted. The Watch toggle controls inclusion in fan-out enumeration;
-- the mute table excludes specific (user, issue) pairs from that
-- enumeration. Both must agree for a notification to fire.

CREATE TABLE IF NOT EXISTS issue_user_mutes (
    user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    issue_id UUID NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    since    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, issue_id)
);

CREATE INDEX IF NOT EXISTS issue_user_mutes_user_idx ON issue_user_mutes (user_id);

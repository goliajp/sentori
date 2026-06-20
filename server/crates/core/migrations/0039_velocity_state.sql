-- v0.9.0 #5 — velocity alert dedupe state.
--
-- velocity_eval cron records the last time it alerted on each issue
-- so the next pass doesn't re-fire within DEDUPE_MINUTES of the
-- previous alert (default 30 min). Tiny table, one row per issue
-- that's ever tripped the threshold.

CREATE TABLE IF NOT EXISTS velocity_state (
    issue_id          UUID PRIMARY KEY REFERENCES issues(id) ON DELETE CASCADE,
    last_alert_at     TIMESTAMPTZ NOT NULL,
    last_alert_ratio  DOUBLE PRECISION NOT NULL,
    last_alert_count  INTEGER NOT NULL,
    level             TEXT NOT NULL CHECK (level IN ('warn', 'page'))
);

CREATE INDEX IF NOT EXISTS velocity_state_last_alert_idx
    ON velocity_state (last_alert_at DESC);

-- v1.4 W17 — track when each user last received an hourly / daily
-- digest, so the worker knows what to batch in the next run.
--
-- One row per (user, cadence). The worker only ever has rows for
-- users whose preferences.cadence ∈ {hourly, daily}; immediate-
-- cadence users go through per-event email in W16.

CREATE TABLE IF NOT EXISTS digest_runs (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cadence      TEXT NOT NULL CHECK (cadence IN ('hourly', 'daily')),
    last_sent_at TIMESTAMPTZ,
    PRIMARY KEY (user_id, cadence)
);

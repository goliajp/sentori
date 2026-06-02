-- Phase 27 sub-F: mute / snooze.
--
-- Two distinct semantics:
--   - `muted = TRUE`: user explicitly silenced this rule, no
--     expiration; only an explicit unmute brings it back. Different
--     from `enabled = FALSE` because muted rules still show up in the
--     active list (with a chip) — disabling implies the user intended
--     to retire the rule.
--   - `snoozed_until > now()`: temporary silence (1h / 4h / 24h / 7d
--     from the dashboard's quick buttons). Auto-clears when the
--     timestamp passes; evaluator just checks `now() < snoozed_until`.
--
-- Both apply on top of `enabled` — a muted rule is `enabled AND
-- silent`. The evaluator's WHERE clause checks all three.

ALTER TABLE alert_rules
    ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;

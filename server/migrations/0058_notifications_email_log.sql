-- v1.4 W16 — track outbound notification emails.
--
-- v1.3 W14 added a `channels: ['in_app', 'email']` toggle on
-- notification_preferences but the email channel had no worker.
-- v1.4 W16 wires the dispatch: every fan_out that lands a row in
-- `notifications` ALSO enqueues an email when the recipient has
-- channel='email'.
--
-- This log table is so the dashboard (and the v0.2 digest worker)
-- can answer "did Sentori try to email Alice for issue X yet?"
-- without having to poll the SMTP relay's bounce queue.
--
-- Status values:
--   'queued'    — Sentori is about to attempt SMTP; the row is the
--                 dispatch lock.
--   'delivered' — SMTP RCPT TO acknowledged.
--   'failed'    — exception bubbled out of `mailer::send_plain`.
--                 last_error carries the lettre error string.
--   'skipped'   — operator's preferences say no email (cadence
--                 ∈ {hourly, daily}, will land in a digest instead).

CREATE TABLE IF NOT EXISTS notifications_email_log (
    id              BIGSERIAL PRIMARY KEY,
    notification_id BIGINT REFERENCES notifications(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Mirrors the recipient email at dispatch time so we don't have
    -- to JOIN users on every audit query (email is rarely changed
    -- post-verify; this denorm is correct enough).
    recipient_email TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'delivered', 'failed', 'skipped')),
    subject         TEXT NOT NULL,
    last_error      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_email_log_user_idx
    ON notifications_email_log (user_id, created_at DESC);

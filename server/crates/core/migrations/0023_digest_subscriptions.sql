-- Phase 27 sub-E: opt-in email digests.
--
-- One row per (user, org, frequency). Users self-serve via the
-- /api/users/me/digests endpoints; the cron job sends digests when
-- `last_sent_at + frequency_window < now()`.
--
-- Cascade on user/org delete keeps the row from outliving its
-- subjects; FK SET NULL would be wrong here because there's no row
-- without both pointers.

CREATE TABLE IF NOT EXISTS digest_subscriptions (
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    org_id       UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
    frequency    TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
    last_sent_at TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, org_id, frequency)
);

CREATE INDEX IF NOT EXISTS digest_subscriptions_due_idx
    ON digest_subscriptions (frequency, last_sent_at);

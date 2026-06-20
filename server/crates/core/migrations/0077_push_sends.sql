-- v2.7 W2 — one row per push send. Carries idempotency, current
-- status, and retry tracking.
--
-- Backend integrator POSTs /v1/push/send → server resolves `to:
-- ipt_*` to a device_tokens row → inserts a push_sends row with
-- status='queued' and `next_attempt_at = now()`. The dispatch cron
-- (push::dispatch_cron, mirrors webhook_dispatch::spawn_cron) sweeps
-- every 30s, dispatches via the provider trait, updates the row.
--
-- Retry schedule mirrors webhook: [60s, 5m, 30m, 2h, 12h, 24h] × 6 max.
-- On `PermanentlyInvalidToken` the dispatcher both fails this send AND
-- increments device_tokens.bad_streak (auto-revoke at streak=3).
--
-- `idempotency_key` is optional, scoped per project. Two POSTs with
-- the same (project, idempotency_key) collapse to the original send.

CREATE TABLE push_sends (
    id                UUID         PRIMARY KEY,
    project_id        UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    token_id          UUID         NOT NULL REFERENCES device_tokens(id) ON DELETE CASCADE,
    provider          TEXT         NOT NULL,
    payload           JSONB        NOT NULL,
    status            TEXT         NOT NULL DEFAULT 'queued'
                                   CHECK (status IN ('queued','sent','failed')),
    provider_outcome  TEXT,
    error             TEXT,
    retry_count       INTEGER      NOT NULL DEFAULT 0,
    idempotency_key   TEXT,
    next_attempt_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    sent_at           TIMESTAMPTZ
);

-- Idempotency check on the (project, key) pair when the key is set.
-- Partial unique index so multiple sends without a key coexist.
CREATE UNIQUE INDEX push_sends_idempotency_idx
    ON push_sends (project_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Dispatch cron's sweep query: pending rows ordered by next_attempt_at.
CREATE INDEX push_sends_pending_idx
    ON push_sends (next_attempt_at)
    WHERE status = 'queued';

-- Dashboard's "recent sends for this device" listing.
CREATE INDEX push_sends_token_recent_idx
    ON push_sends (token_id, created_at DESC);

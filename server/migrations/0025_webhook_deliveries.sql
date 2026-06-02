-- Phase 29 sub-B: persistent webhook retry queue.
--
-- Phase 27 sub-D shipped best-effort once-and-log webhook delivery; this
-- migration backs the queue that lets notifier::AlertFired enqueue a
-- delivery and have a background dispatcher (server/src/webhook_dispatch.rs)
-- retry on the locked schedule: [60s, 5m, 30m, 2h, 12h, 24h] across at
-- most 6 attempts before marking the row failed.
--
-- One row per (rule, payload, target) tuple. Pending rows are picked up
-- by the dispatcher when next_attempt_at <= now(). The partial index
-- keeps the sweep query cheap regardless of how big the delivered/failed
-- tail grows.

CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id               UUID PRIMARY KEY,
    rule_id          UUID NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
    payload          JSONB NOT NULL,
    target_url       TEXT NOT NULL,
    secret           TEXT NOT NULL,
    attempt          INTEGER NOT NULL DEFAULT 0,
    next_attempt_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_status      INTEGER,
    last_error       TEXT,
    status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'delivered', 'failed')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    delivered_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending
    ON webhook_deliveries (status, next_attempt_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_rule_recent
    ON webhook_deliveries (rule_id, created_at DESC);

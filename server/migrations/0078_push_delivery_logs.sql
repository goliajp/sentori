-- v2.7 W2 — per-attempt delivery log for receipts + dashboard
-- "what happened on each retry" surface.
--
-- One row per attempt against the provider. Lets the dashboard's
-- (future, v2.11) Push module show the timeline of "tried at T,
-- got 429 Retry-After:30, queued retry at T+30, tried at T+30, got
-- 200" for any send. Also the source of truth when manual
-- investigation needs the raw provider body.
--
-- `provider_body` is truncated to 2 KB at write time — providers
-- can dump very large error responses (notably FCM v1) that aren't
-- useful past their first kilobyte and would bloat the table.

CREATE TABLE push_delivery_logs (
    id                UUID         PRIMARY KEY,
    send_id           UUID         NOT NULL REFERENCES push_sends(id) ON DELETE CASCADE,
    attempt           INTEGER      NOT NULL,
    outcome           TEXT         NOT NULL,
    provider_status   INTEGER,
    provider_body     TEXT,
    duration_ms       INTEGER,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX push_delivery_logs_send_idx
    ON push_delivery_logs (send_id, attempt);

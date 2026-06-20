-- v2.26 — confirmed delivery ack columns. SDK posts to
-- POST /v1/push/sends/:id/ack on receive; server records the
-- timestamp + originating session. Idempotent (first-ack wins).
--
-- Both nullable; pre-v2.26 rows stay NULL (means "no ack recorded").
-- v2.27 push-correlation BI will JOIN on acked_at to compute delivery
-- vs. dispatch ratio.

ALTER TABLE push_sends
    ADD COLUMN acked_at        TIMESTAMPTZ,
    ADD COLUMN ack_session_id  TEXT;

CREATE INDEX push_sends_acked_idx
    ON push_sends (project_id, acked_at)
    WHERE acked_at IS NOT NULL;

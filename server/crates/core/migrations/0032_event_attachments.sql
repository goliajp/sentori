-- Phase 42 sub-C.01 — per-event attachments (screenshots, view trees,
-- state snapshots, log tails — anything binary or structured that
-- doesn't fit cleanly into the event JSON payload).
--
-- `ref` is the only client-facing handle. Server returns it after a
-- successful multipart upload to `/v1/events/<event_id>/attachments/<kind>`;
-- the SDK echoes it back inside the next `event.attachments[].ref`.
-- Ingest validates that every ref matches a row in this table with
-- the same event_id — so a malicious client can't reference an
-- attachment that belongs to a different event.
--
-- No FK from `event_id` to `events`: `events` is partitioned by
-- `received_at`, and partition drops are bulk DROPs that don't
-- cascade through FKs reliably. We bulk-delete attachment rows
-- alongside their event partition in `retention::run_once`, and the
-- `AttachmentStore::delete_event` call from there clears the on-disk
-- blobs at the same time.

CREATE TABLE IF NOT EXISTS event_attachments (
    ref           UUID PRIMARY KEY,
    event_id      UUID NOT NULL,
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL CHECK (kind IN ('screenshot', 'viewTree', 'stateSnapshot', 'logTail')),
    media_type    TEXT NOT NULL,
    size_bytes    INTEGER NOT NULL,
    captured_at   TIMESTAMPTZ NOT NULL,
    source        TEXT NOT NULL CHECK (source IN ('js', 'ios', 'android')),
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS event_attachments_event_id_idx
    ON event_attachments (event_id);

CREATE INDEX IF NOT EXISTS event_attachments_received_at_idx
    ON event_attachments (received_at);

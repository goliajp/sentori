-- v0.9.6 #2 — extend event_attachments.kind CHECK to allow the new
-- `replay` kind (gzipped NDJSON of wireframe snapshots).

ALTER TABLE event_attachments
    DROP CONSTRAINT IF EXISTS event_attachments_kind_check;

ALTER TABLE event_attachments
    ADD CONSTRAINT event_attachments_kind_check
    CHECK (kind IN ('screenshot', 'viewTree', 'stateSnapshot', 'logTail', 'sessionTrail', 'replay'));

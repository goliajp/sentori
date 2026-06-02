-- Phase 46 sub-A — extend the event_attachments.kind CHECK to allow
-- the new `sessionTrail` kind. A sessionTrail attachment is a JSON
-- blob containing the last N steps leading up to a crash (route
-- changes, breadcrumbs, optional view-tree / screenshot refs).
--
-- Postgres can't alter a CHECK in place; drop + recreate is the
-- straightforward path. The constraint name follows the default
-- naming Postgres picked for the original CHECK
-- (`event_attachments_kind_check`).

ALTER TABLE event_attachments
    DROP CONSTRAINT IF EXISTS event_attachments_kind_check;

ALTER TABLE event_attachments
    ADD CONSTRAINT event_attachments_kind_check
    CHECK (kind IN ('screenshot', 'viewTree', 'stateSnapshot', 'logTail', 'sessionTrail'));

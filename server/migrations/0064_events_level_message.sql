-- v2.0 W1 — captureMessage support.
--
-- Two new nullable columns on `events`:
--   * `level`   — severity for `kind = 'message'` events ('fatal' |
--                 'error' | 'warning' | 'info' | 'debug'). NULL for
--                 every other kind (existing rows and future
--                 error/anr/nearCrash rows).
--   * `message` — the human-readable string body of a manual
--                 capture-message call. NULL for non-message kinds
--                 (those carry `error.message` instead).
--
-- Forward-compat with v1 SDK: every existing row stays NULL on both
-- columns; v1 SDK requests without these fields parse cleanly.
--
-- Forward-compat with v2 SDK: a `kind = 'message'` row is required
-- to populate both columns. Application-level validation enforces
-- this; the DB stays permissive so a future kind doesn't need a
-- migration to land.
--
-- Note: `events.kind` lives inside the JSONB `payload` column, not
-- as a top-level column (see 0001_init.sql) — so we don't add a
-- kind-based filtered index here. The dashboard's "filter by level"
-- query joins through `error_type` ("Message" for kind=message
-- events) which already has an index. Adding a top-level `kind`
-- column is a v2.1 polish.

ALTER TABLE events
  ADD COLUMN level TEXT;

ALTER TABLE events
  ADD COLUMN message TEXT;

-- Index for level-based filtering (e.g. dashboard "show only
-- warning+ messages"). Partial on `level IS NOT NULL` keeps it
-- tight — only message-kind rows have a level set.
CREATE INDEX idx_events_level
  ON events (project_id, level)
  WHERE level IS NOT NULL;

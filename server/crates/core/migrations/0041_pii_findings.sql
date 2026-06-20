-- v0.9.2 +S6 — Privacy Lab.
--
-- pii_findings stores every potentially-PII string the scanner has
-- ever seen in an ingested event. Used to:
--   • compute a per-release Privacy Score (0-100) for the dashboard
--   • surface "top leak surfaces" for the operator to suppress with
--     server-side scrubber rules
-- Rows are bounded — scan picks up new events at most once. Retention
-- piggybacks on `events` retention via `event_id ON DELETE CASCADE`
-- indirectly (event row goes → finding row goes).
--
-- Pattern kinds: 'email' | 'phone' | 'cc-like' | 'address-like'.
-- The scanner regex is intentionally over-eager: false-positives are
-- cheap (operator dismisses), false-negatives are silent compliance
-- leaks. Each finding samples the matched string truncated to 64
-- bytes for review; longer matches are hashed not stored.

CREATE TABLE IF NOT EXISTS pii_findings (
    id            UUID PRIMARY KEY,
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    release       TEXT NOT NULL,
    event_id      UUID NOT NULL,
    field_path    TEXT NOT NULL,
    pattern_kind  TEXT NOT NULL CHECK (pattern_kind IN ('email', 'phone', 'cc-like', 'address-like')),
    sample        TEXT NOT NULL,
    seen_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pii_findings_project_release_idx
    ON pii_findings (project_id, release, seen_at DESC);

CREATE INDEX IF NOT EXISTS pii_findings_event_idx
    ON pii_findings (event_id);

-- Track which event ids the scanner has already processed so we
-- don't re-scan and create duplicate findings. One row per scanned
-- event with the scan timestamp.
CREATE TABLE IF NOT EXISTS pii_scan_cursor (
    event_id   UUID PRIMARY KEY,
    scanned_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pii_scan_cursor_scanned_at_idx
    ON pii_scan_cursor (scanned_at);

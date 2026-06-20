-- v0.9.0 #10 — index events by OTA bundle id so dashboard filters
-- ("show only events from bundle r/123") run efficiently. Bundle id
-- lives inside the JSONB payload at `payload->'bundle'->>'id'`; the
-- expression index lets PG use this path directly.
--
-- Partitioned events parent: indexes propagate to each partition.

CREATE INDEX IF NOT EXISTS events_bundle_id_idx
    ON events ((payload->'bundle'->>'id'))
    WHERE payload ? 'bundle';

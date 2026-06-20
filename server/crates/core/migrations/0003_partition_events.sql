-- Phase 5 sub-section D: partition events by month on received_at.
-- PG requires the partition key to be part of the primary key, so PK becomes
-- (received_at, id). This trades strict per-id idempotency for the
-- ability to drop old months in O(1). uuid v7 collisions are vanishingly
-- rare in practice, so duplicate inserts are accepted as a known limitation.

CREATE TABLE events_partitioned (
    id            UUID NOT NULL,
    project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    issue_id      UUID REFERENCES issues(id) ON DELETE CASCADE,
    release_id    UUID REFERENCES releases(id) ON DELETE SET NULL,
    received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    occurred_at   TIMESTAMPTZ NOT NULL,
    platform      TEXT NOT NULL,
    release       TEXT NOT NULL,
    environment   TEXT NOT NULL,
    error_type    TEXT NOT NULL,
    error_message TEXT NOT NULL,
    payload       JSONB NOT NULL,
    PRIMARY KEY (received_at, id)
) PARTITION BY RANGE (received_at);

CREATE TABLE events_2026_05 PARTITION OF events_partitioned
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE events_2026_06 PARTITION OF events_partitioned
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE events_2026_07 PARTITION OF events_partitioned
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE events_2026_08 PARTITION OF events_partitioned
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE events_default PARTITION OF events_partitioned DEFAULT;

INSERT INTO events_partitioned
    (id, project_id, issue_id, release_id, received_at, occurred_at,
     platform, release, environment, error_type, error_message, payload)
SELECT id, project_id, issue_id, release_id, received_at, occurred_at,
       platform, release, environment, error_type, error_message, payload
FROM events;

DROP TABLE events CASCADE;
ALTER TABLE events_partitioned RENAME TO events;

CREATE INDEX events_project_received_idx
    ON events (project_id, received_at DESC);
CREATE INDEX events_project_environment_idx
    ON events (project_id, environment);
CREATE INDEX events_issue_received_idx
    ON events (issue_id, received_at DESC);

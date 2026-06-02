-- v0.8.3 — custom metrics (counters / gauges / timings) submitted by
-- the host app. Distinct from spans + events: this is the "I want to
-- track payment_attempts.success and chart it" surface — arbitrary
-- structured data the customer cares about, ingested through the
-- same token boundary as /v1/events.
--
-- Storage model: one row per submitted point. No pre-aggregation here;
-- the dashboard's chart query buckets by name + tag-set + timestamp.
-- We're explicit-storage (not Valkey timeseries) so the data survives
-- restarts and retention/export is uniform with events.
--
-- `tags` is a Postgres `jsonb` column (small free-form key/value map);
-- indexed only on (project_id, name, ts) which covers the common
-- chart query. Tag filters go through a GIN index lazily — only worth
-- adding once a customer hits the slow-query log.

CREATE TABLE IF NOT EXISTS metrics (
    id           UUID PRIMARY KEY,
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name         TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
    value        DOUBLE PRECISION NOT NULL,
    tags         JSONB NOT NULL DEFAULT '{}'::jsonb,
    ts           TIMESTAMPTZ NOT NULL,
    received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS metrics_project_name_ts_idx
    ON metrics (project_id, name, ts DESC);

CREATE INDEX IF NOT EXISTS metrics_received_at_idx
    ON metrics (received_at);

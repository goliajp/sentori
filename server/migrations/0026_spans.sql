-- Phase 34 sub-B: spans table for distributed tracing.
--
-- Same partition shape as events (RANGE by received_at, PK includes
-- the partition key) so the retention task can manage span partitions
-- with the same code path it uses for events.

CREATE TABLE IF NOT EXISTS spans (
    id              UUID NOT NULL,
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    trace_id        UUID NOT NULL,
    parent_span_id  UUID,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ NOT NULL,
    duration_ms     INTEGER NOT NULL,
    op              TEXT NOT NULL,
    name            TEXT NOT NULL,
    status          TEXT NOT NULL CHECK (status IN ('ok', 'error', 'cancelled')),
    tags            JSONB NOT NULL DEFAULT '{}'::jsonb,
    data            JSONB,
    traceparent     TEXT,
    PRIMARY KEY (received_at, id)
) PARTITION BY RANGE (received_at);

-- Bootstrap a few months. retention.rs auto-creates further partitions
-- as the calendar advances.
CREATE TABLE IF NOT EXISTS spans_2026_05 PARTITION OF spans
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');
CREATE TABLE IF NOT EXISTS spans_2026_06 PARTITION OF spans
    FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');
CREATE TABLE IF NOT EXISTS spans_2026_07 PARTITION OF spans
    FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');
CREATE TABLE IF NOT EXISTS spans_2026_08 PARTITION OF spans
    FOR VALUES FROM ('2026-08-01') TO ('2026-09-01');
CREATE TABLE IF NOT EXISTS spans_default PARTITION OF spans DEFAULT;

-- Index strategy:
--   trace_id      → trace detail view, fetch all spans of one trace
--   parent_span_id → waterfall build, find children of a span (NULL
--                    rows excluded via partial index — saves space
--                    since every root span has parent_span_id NULL)
--   (project_id, received_at DESC) → trace list pagination
--   (project_id, op) → span search by op (e.g. all http.client spans)
CREATE INDEX IF NOT EXISTS spans_trace_idx
    ON spans (trace_id);
CREATE INDEX IF NOT EXISTS spans_parent_idx
    ON spans (parent_span_id)
    WHERE parent_span_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS spans_project_received_idx
    ON spans (project_id, received_at DESC);
CREATE INDEX IF NOT EXISTS spans_project_op_idx
    ON spans (project_id, op);

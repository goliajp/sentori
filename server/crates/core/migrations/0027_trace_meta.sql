-- Phase 34 sub-B: per-trace summary table.
--
-- `traces` is a materialized rollup of `spans` keyed by trace_id —
-- the dashboard's "trace list" view doesn't want to GROUP BY trace_id
-- every refresh; it queries this table for the headline columns and
-- only drills into `spans` when a row is clicked.
--
-- Not partitioned: trace counts are ~1/200 of span counts in practice
-- (root + many child spans per trace), so even a million spans only
-- materialises into a few thousand trace rows. We'll revisit if a real
-- workload ever pushes this table past 10M rows.

CREATE TABLE IF NOT EXISTS traces (
    trace_id     UUID PRIMARY KEY,
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    -- Root-span fields denormalized for the trace-list view.
    root_op      TEXT,
    root_name    TEXT,
    first_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
    span_count   INTEGER NOT NULL DEFAULT 0,
    -- Trace status is the worst-of: any span with status='error' marks
    -- the whole trace as error; otherwise 'cancelled' beats 'ok'.
    -- Maintained by the ingest path.
    status       TEXT NOT NULL DEFAULT 'ok'
                 CHECK (status IN ('ok', 'error', 'cancelled')),
    -- Sum of (root-span duration) — same number a top-level
    -- transaction would carry in Sentry. We don't compute wall-clock
    -- end-to-end here because async spans complicate it; root duration
    -- is the honest answer.
    duration_ms  INTEGER NOT NULL DEFAULT 0
);

-- Trace list keyset pagination uses (project_id, last_seen DESC, trace_id DESC).
CREATE INDEX IF NOT EXISTS traces_project_last_seen_idx
    ON traces (project_id, last_seen DESC, trace_id DESC);

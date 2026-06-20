-- Phase 39 sub-E: composite index for span search by op + duration.
--
-- The "top slowest http.client spans" query —
--   WHERE project_id = $1 AND op = $2 ORDER BY duration_ms DESC LIMIT N
-- — could only use (project_id, op) (migration 0026), which forces a
-- bitmap heap scan over the whole op partition + an in-memory top-N
-- sort (~330k candidate rows at 1M total, ~43 ms). With duration_ms
-- as the trailing index column the planner seeks the top N directly:
-- ~0.4 ms in the same dataset. See
-- docs/performance/baseline-v0.5-phase39.md.
--
-- Plain CREATE INDEX (not CONCURRENTLY — sqlx migrations run in a
-- transaction). On the partitioned parent this builds the index on
-- every existing partition, holding a brief lock on each; fine at the
-- volumes this table sees in practice.
CREATE INDEX IF NOT EXISTS spans_project_op_duration_idx
    ON spans (project_id, op, duration_ms DESC);

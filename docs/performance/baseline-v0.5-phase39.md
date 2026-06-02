# Performance baseline — v0.5 Phase 39 sub-E (Q4 composite index)

**Scope:** the deferred Phase 38 action item — add
`(project_id, op, duration_ms DESC)` to `spans` and re-measure the
"span search by op + duration, top N" query (Q4). The other three
hot-path queries (Q1 trace list, Q2 trace detail, Q3 events-on-trace)
are unchanged from
[baseline-v0.4-phase38.md](./baseline-v0.4-phase38.md) — this
migration touches only the Q4 path.

## Setup

Throwaway `postgres:18-alpine`, all migrations applied, then a SQL
bulk INSERT: 5,000 traces × 200 spans = **1,000,000 spans** (same
shape as the Phase 34/38 baselines, so the numbers are directly
comparable). `op` is spread across `http.client` / `http.server` /
`db.query` / `react.navigation` / `cache.get`; ~332k rows are
`http.client`. `ANALYZE` after load.

## Q4 — span search by op + duration

```sql
SELECT id, name, duration_ms, status
FROM spans
WHERE project_id = $1 AND op = 'http.client'
ORDER BY duration_ms DESC
LIMIT 50;
```

| | Plan | Exec |
|---|---|---:|
| **Before** (only `(project_id, op)`) | Parallel Append → Parallel Seq Scan on the big partition + Parallel Bitmap Heap Scan on `spans_default` → Gather Merge → top-N heapsort over ~332k candidate rows | **43.0 ms** |
| **After** (`(project_id, op, duration_ms DESC)`) | Merge Append of per-partition `Index Scan using spans_<p>_project_id_op_duration_ms_idx` — seeks the top 50 directly, no sort, no candidate materialisation; reads 60 buffers total | **0.40 ms** |

≈ **100× faster**, and crucially the cost no longer scales with the
candidate-set size — it's bounded by `LIMIT N` + partition count.

Index build on 1M rows: ~0.8 s. Index size: ~7.5 MB total across
partitions (~7.5 bytes/row) — cheap.

Compared to the prior baseline's Q4 (40.7 ms at 1M, the
fastest-growing curve of the four): the composite index removes that
curve entirely.

## Regression policy crosscheck

This is a strict improvement (one query 100× faster, plan shape
changes from seq-scan-and-sort to index-only top-N seek; no other
query's plan touched). Nothing to flag — the v0.3 performance gate is
about *regressions*.

## Notes

- The migration uses plain `CREATE INDEX` (not `CONCURRENTLY` — sqlx
  migrations run in a transaction). On the partitioned `spans` parent
  this builds the index on each existing partition with a brief lock;
  acceptable at the volumes this table sees.
- Q2 (trace detail) still pays a ~2 ms planning cost dominated by
  span-partition pruning at 1M rows — the `received_at >= N days`
  pruning hint stays deferred (revisit when partition count grows past
  ~12 months, per the Phase 38 baseline).
- Trace-table cardinality: with Phase 39 sub-A (span-name path
  normalization) + sub-B (navigation span as the per-screen root), the
  `traces` summary table holds ~1 row per *screen visit* instead of
  ~1 per *request* — a 1-2 order-of-magnitude reduction vs. the
  pre-v0.5 behaviour where every fetch was its own root trace. That
  keeps Q1 (trace list, `traces_project_last_seen_idx`) comfortably in
  its sub-ms regime; not separately re-measured here since the index +
  plan are unchanged.

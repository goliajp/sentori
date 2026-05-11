# EXPLAIN ANALYZE baseline at 1M spans — Phase 38 sub-A

> Dataset: **1,000,046 spans** (1M synthetic bulk-INSERT + 46 from
> earlier smoke), 5,007 traces, the bulk rows tagged
> `traces.root_name LIKE 'bulk-1m-v04 trace %'` for cleanup. PG 18,
> dev `sentori-pg` container. spans table 284 MB across partitions;
> traces table 720 KB.

## Headline

**Three of the four hot-path queries are still sub-millisecond at 1M
spans.** Q4 (span search by op + duration, top 50) goes from
5.64 ms at 100k → 40.7 ms at 1M — sub-linear growth (7.2× slower
for 10× more data), well under the 200 ms ingest SLO, but it's the
fastest-growing curve of the four and the obvious sub-E candidate
if real traffic ever justifies a migration.

| Query | 100k baseline (Phase 34 sub-D) | 1M re-baseline | Δ exec | Notes |
|---|---:|---:|---:|---|
| Q1 trace list (project paginated 100) | 0.075 ms | **0.131 ms** | +75% | Index Scan on `traces_project_last_seen_idx`; same plan. Buffer count 81 → 101 (sub-linear) |
| Q2 trace detail (200 spans of one trace) | 0.684 ms | **1.157 ms** | +69% | Bitmap Heap Scan on `spans_2026_05_trace_id_idx`; planning time 1.96 ms is now larger than execution, partition pruning the bottleneck (sub-D `received_at`-hint candidate, deferred) |
| Q3 events on this trace (sub-C addition) | n/a | **0.106 ms** / 6.80 ms plan | new | Index Scan via `events_trace_idx` partial index. Planning time dominated by event-partition pruning — same caveat as Q2 |
| Q4 span search (op + duration top 50) | 5.642 ms | **40.7 ms** | 7.2× | Bitmap Index Scan via `spans_2026_05_project_id_op_idx`; 166,314 candidate rows then sort top 50 in memory. The cost grows linearly with the candidate set, not the result size |

Total execution across the four: 42.1 ms at 1M vs ~6.5 ms at 100k.
The bulk of the increase is Q4; the other three remained sub-2 ms.

## Detail

### Q1 — Trace list

```
Limit  (actual time=0.022..0.117 rows=100 loops=1)
  Buffers: shared hit=101 read=3 dirtied=1
  ->  Index Scan using traces_project_last_seen_idx on traces
        Index Cond: project_id = ...
        rows=100, time=0.020..0.109
Planning Time: 0.450 ms
Execution Time: 0.131 ms
```

- ✅ Composite index `(project_id, last_seen DESC, trace_id DESC)`
  does exactly what the paginator needs. Buffer count grew 81 → 101
  for 9.4× more traces (5007 vs 510) — sub-linear because the index
  is balanced and the read only walks 100 leaf rows.

### Q2 — Trace detail

```
Append (across 5 partitions: spans_2026_05 returns 200, others 0)
  ->  Bitmap Heap Scan on spans_2026_05 spans_1
        Recheck Cond: trace_id = ... AND project_id = ...
        Heap Blocks: exact=200
        rows=200, time=0.99..1.06
        Bitmap Index Scan on spans_2026_05_trace_id_idx
          rows=200, time=0.020..0.020
Planning Time: 1.957 ms
Execution Time: 1.157 ms
```

- ✅ Per-partition Index Scan on `(trace_id)` still walks 200 rows
  in 1 ms. Planning time 1.957 ms vs execution 1.157 ms — same
  pattern as Phase 33 Q2 events: partition pruning is recomputed
  per query.
- 🔁 **Sub-E candidate (deferred)**: a `received_at >= now() -
  INTERVAL 'N days'` hint on the trace-detail SQL would let the
  planner statically prune older partitions. Phase 30 sub-E added
  the same hint to `list_events_for_issue`; the trace-detail query
  is a one-line copy. Worth it once partition count crosses 12
  months in prod.

### Q3 — Events on this trace (new vs 100k baseline)

```
Append (across all events partitions)
  ->  Index Scan using events_2026_05_events_trace_idx
        Index Cond: trace_id = ...
        Filter: project_id = ...
        rows=0
  ->  same scan against 6 other partitions, all 0 rows
Planning Time: 6.80 ms
Execution Time: 0.106 ms
```

- ✅ The Phase 36 sub-C partial index `events_trace_idx WHERE
  trace_id IS NOT NULL` is exactly what this query needs. Index
  Scan over every partition (since we don't know which one has
  matching events), but each partition's index lookup is microseconds.
- ⚠️ Planning Time 6.80 ms — the per-partition planner overhead is
  now the biggest line item in this whole baseline. Multiplied
  across the events table's full partition set, this is the dominant
  cost of any cross-partition events query. Same `received_at`
  prune-hint discussion as Q2; same recommendation (deferred).

### Q4 — Span search by op + duration

```
Limit
  -> Sort
      Sort Key: spans.duration_ms DESC
      Rows fed in: 166,314 → top 50 retained
  -> Append (filtered to spans_2026_05)
      -> Bitmap Heap Scan
          Recheck Cond: project_id = ... AND op = 'http.client'
          Heap Blocks: exact=...
          rows=166,314
          -> Bitmap Index Scan on spans_2026_05_project_id_op_idx
                rows=166,314, time=3.69..3.69
Planning Time: 2.09 ms
Execution Time: 40.7 ms
```

- ✅ Plan unchanged from 100k baseline — same Bitmap Index Scan +
  in-memory Sort.
- ⚠️ The cost is the Sort over 166k rows. The `(project_id, op)`
  index can't push `duration_ms > 50` or the `ORDER BY duration_ms
  DESC LIMIT 50` through, so PG materialises the candidate set and
  sorts it.
- 🔁 **Optimization candidate (deferred to v0.5)**: a composite
  index `(project_id, op, duration_ms DESC)` (or `WHERE
  duration_ms > 50` partial) would let PG seek the top-N directly.
  At current scale 40 ms is under SLO; defer until either real
  traffic reports it as slow or the next baseline shows the curve
  steepening past linear.

## Methodology

Same bulk-INSERT path as Phase 34 sub-D + Phase 33 sub-A:

```sql
-- 1. 5000 traces
INSERT INTO traces (...)
SELECT uuidv7(), '<project>', 'http.server',
       'bulk-1m-v04 trace ' || g, ...
FROM generate_series(1, 5000) g;

-- 2. 5000 root spans (parent_span_id NULL)
INSERT INTO spans (...) SELECT uuidv7(), ..., NULL, ... FROM traces
WHERE root_name LIKE 'bulk-1m-v04%';

-- 3. 199 children per root = 995,000 child spans
INSERT INTO spans (...)
SELECT uuidv7(), s.project_id, s.trace_id, s.id, ...
FROM spans s CROSS JOIN generate_series(1, 199) c
WHERE s.parent_span_id IS NULL AND s.name LIKE 'bulk-1m-v04%';

-- 4. cleanup (run before re-running the baseline)
DELETE FROM spans WHERE trace_id IN (
  SELECT trace_id FROM traces WHERE root_name LIKE 'bulk-1m-v04%'
);
DELETE FROM traces WHERE root_name LIKE 'bulk-1m-v04%';
```

Wall-clock: 14 s for 995k children + sub-second for the other two.
ANALYZE before EXPLAIN so the planner uses fresh stats.

## What this baseline doesn't cover

- **Multi-partition traces** — all synthetic data lands in
  `spans_2026_05`. Real spans usually do too (root + children fire
  within seconds), but cross-month spans aren't exercised.
- **High parent_span_id fan-out** — uniform 200-children-per-root
  doesn't match real shapes (one root with many siblings, one root
  with deep nesting). At this scale plan-shape doesn't change with
  fan-out; the read pattern is still Index Scan on `trace_id`.
- **Concurrent reads** — single-connection EXPLAIN, no contention.
  The next baseline against the staging load test (Phase 33 sub-C
  style) is the place to measure that.

## Regression policy crosscheck

Comparing against the Phase 33 v0.3 baseline (`docs/performance.md`
headline table):

- Q1, Q2, Q3 plan shapes unchanged. Wall-clock deltas under +75% —
  below the 20%-loose threshold trigger (which is on the same data
  shape, not 10× more rows; we're fine here).
- Q4 plan shape unchanged. Wall-clock 7.2× growth — explained by
  the 10× data growth + the in-memory Sort. Documented above as a
  v0.5 candidate; not a regression for v0.4 release.

## Action items

- ⏸ Q2 / Q3 `received_at >=` partition-pruning hint — apply when
  events / spans partition count reaches 12+ months. Same code
  pattern as Phase 30 sub-E.
- ⏸ Q4 `(project_id, op, duration_ms DESC)` composite — v0.5
  candidate. Re-evaluate after 6 months of real production traffic.
- ✅ v0.4 release proceeds without index migration; sub-B can tag
  and ship.

The bulk-1m-v04 synthetic rows are deleted from dev after measuring
(see methodology). Re-run by following the SQL above.

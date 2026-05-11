# Span ingest EXPLAIN baseline — Phase 34 sub-D

> Dataset: **100,050 spans** (500 synthetic traces × 200 spans each
> + 50 from earlier smoke), 510 traces. PG 18, dev `sentori-pg`
> container, `cargo run --quiet` debug build. spans table 27 MB
> across partitions; traces table 200 KB.
> All synthetic rows tagged `root_name LIKE 'bulk-100k%'` for cleanup.

## Headline

**All three hot-path queries are well under SLO**.

| Query | Execution | Planning | Plan | Notes |
|---|---:|---:|---|---|
| Q1 trace list (project, paginated 100) | **0.075 ms** | 0.37 ms | Index Scan on `traces_project_last_seen_idx` | exactly what we built the index for |
| Q2 trace detail (200 spans in one trace) | **0.68 ms** | 1.57 ms | Bitmap Heap Scan via `spans_2026_05_trace_id_idx` | per-partition Bitmap Index Scan, 206 heap blocks for 200 spans |
| Q3 span search (op + duration filter, top 50) | **5.64 ms** | 1.87 ms | Bitmap Heap Scan via `spans_2026_05_project_id_op_idx`, then Sort | 16,887 candidate rows filtered + sorted; the slowest of the three |

## Detail

### Q1 — Trace list (the most common dashboard hit)

```sql
SELECT trace_id, root_op, root_name, span_count, status, duration_ms, last_seen
FROM traces
WHERE project_id = $1
ORDER BY last_seen DESC, trace_id DESC
LIMIT 100;
```

```
Limit  (rows=100, time=0.011..0.057)
  Buffers: shared hit=81 dirtied=1
  ->  Index Scan using traces_project_last_seen_idx on traces
        Index Cond: project_id = $1
        rows=100, time=0.011..0.052
Planning Time: 0.370 ms
Execution Time: 0.075 ms
```

- ✅ Composite index `(project_id, last_seen DESC, trace_id DESC)` is
  exactly what the keyset paginator needs. No Filter, no Sort.
- 81 buffer hits for 100 rows. At larger scale (1M+ trace rows)
  buffer count grows logarithmically; still expected to stay sub-ms.

### Q2 — Trace detail (all spans of one trace)

```sql
SELECT id, parent_span_id, op, name, started_at, duration_ms, status
FROM spans
WHERE trace_id = $1
ORDER BY started_at;
```

```
Append (across 5 partitions)
  ->  Bitmap Heap Scan on spans_2026_05 spans_1
        Recheck Cond: trace_id = $1
        Heap Blocks: exact=206
        rows=200, time=0.032..0.564
        Bitmap Index Scan on spans_2026_05_trace_id_idx
          rows=207, time=0.015..0.016
  ->  Seq Scan on spans_2026_06..spans_default  (0 rows each, 0.001-0.003 ms)
Planning Time: 1.572 ms
Execution Time: 0.684 ms
```

- ✅ Trace fits entirely in one partition (`spans_2026_05` for now),
  Index Scan finds 207 rows (200 wanted + 7 false positives recheck
  filters out).
- 1.57 ms planning vs 0.68 ms execution — partition pruning is
  decided per query, so planning cost grows with partition count.
  At 12+ months of partitions this becomes the bottleneck; add the
  same `received_at`-based pruning hint Phase 30 sub-E used on
  `list_events_for_issue` if it matters.

### Q3 — Span search (op + duration filter)

```sql
SELECT trace_id, id, op, name, duration_ms, started_at
FROM spans
WHERE project_id = $1 AND op = 'http.client' AND duration_ms > 50
ORDER BY duration_ms DESC
LIMIT 50;
```

```
Bitmap Heap Scan on spans_2026_05
  Index Cond: (project_id = $1 AND op = 'http.client')
  Filter: duration_ms > 50  (then Sort top 50)
  rows=16887 candidate, time=0.397..5.5
Planning Time: 1.869 ms
Execution Time: 5.642 ms
```

- ⚠️ Slowest of the three because the `(project_id, op)` index can't
  push the `duration_ms > 50` filter or the `ORDER BY duration_ms`
  through. Bitmap returns 16,887 candidate rows, PG then filters and
  sorts in memory.
- Still under 10 ms — comfortably within budget for v0.4.
- **Optimization candidate** (deferred): an extra
  `(project_id, op, duration_ms DESC)` composite would let PG seek
  the top-N directly. Not worth a migration until real traffic shows
  the cost — single-digit ms is the noise floor.

## Methodology

Used SQL `generate_series` bulk INSERT same as Phase 33 sub-A — HTTP
through `/v1/spans:batch` would cap around 500 sp/s (server-side
fingerprint + DB upsert per span), so 100 k via HTTP would take ~3 min
and dominate this commit's wall-clock. Direct SQL is ~1 s.

```sql
-- 1. 500 traces
INSERT INTO traces (...)
SELECT uuidv7(), '<project_id>', 'http.server',
       'bulk-100k synthetic trace ' || g, now() - random()*7d, ...
FROM generate_series(1, 500) g;

-- 2. 500 root spans
INSERT INTO spans (..., parent_span_id, ...)
SELECT uuidv7(), ..., NULL, ...
FROM traces WHERE root_name LIKE 'bulk-100k%';

-- 3. 199 children per root = 99,500 child spans
INSERT INTO spans (..., parent_span_id, ...)
SELECT uuidv7(), s.project_id, s.trace_id, s.id, ...
FROM spans s CROSS JOIN generate_series(1, 199) c
WHERE s.parent_span_id IS NULL AND s.name LIKE 'bulk-100k%';

-- 4. cleanup
DELETE FROM spans WHERE trace_id IN (SELECT trace_id FROM traces WHERE root_name LIKE 'bulk-100k%');
DELETE FROM traces WHERE root_name LIKE 'bulk-100k%';
```

`tools/seed-spans.ts` is the HTTP path for tooling that wants to
exercise the real ingest pipeline (validation, quota, trace
materialization). Use SQL bulk for performance-baseline measurement;
use the bun script for ingest correctness work.

## What this baseline doesn't cover

- **Cross-partition trace** — bulk synthetic data all lands in the
  current month (`spans_2026_05`). Real traces won't either (root +
  children fire within milliseconds), but the EXPLAIN doesn't
  prove out the multi-partition path. Re-baseline at 1M when several
  months of partitions exist.
- **Bumpy distributions** — uniform 200 spans per trace. Real traffic
  has a long tail (one giant trace per heavy endpoint, many tiny
  traces from health checks). Skewed `span_count` per trace mostly
  affects Q1's row width, which is already minimal.
- **Cold start** — all queries run after `ANALYZE`. First query
  after a `bgwriter` flush is slightly slower; not material for any
  hot path.

## Action items

- ⏸ `(project_id, op, duration_ms DESC)` index for Q3 — deferred.
  5.6 ms is fast enough; only add when real traffic shows seek-heavy
  search load.
- ⏸ Q2 partition-pruning hint (`AND received_at >= now() -
  INTERVAL 'N days'`) — same pattern as Phase 30 sub-E for
  `list_events_for_issue`. Apply when partition count grows past 12
  months in production.

Phase 38 sub-A re-baselines at 1M spans against the same three
queries; that's where the action items above get re-evaluated.

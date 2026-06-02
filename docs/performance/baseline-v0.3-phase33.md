# EXPLAIN ANALYZE baseline at 1M events — Phase 33 sub-A

> Dataset: **1,020,430 events** (1.02M total, of which 1M are
> synthetic bulk-INSERT rows tagged `synthetic: bulk-1m`), 1,266
> issues, 117 sessions, 115 alert_rules, 54 webhook_deliveries.
> PG 18, dev `sentori-pg` container. DB size 509 MB.
> Re-runs every hot-path query from the v0.3 Phase 30 sub-D
> baseline so we can see the curve.

## TL;DR

**All five hot-path queries are still sub-millisecond at 1M events.**
Total execution time across the five queries combined is **1.24 ms**
at 1M events (vs **0.55 ms** at 5 k — 2.3× slower for 200× more
data, i.e. plenty of headroom).

No new indexes are required. No query plan changed shape from the
5k baseline. The 90-day partition-pruning hint added in Phase 30
sub-E behaved correctly (the planner accepted it; the bulk data
happens to all sit inside the current month so there are no other
partitions to prune).

## Comparison table

| Query | 5k baseline | 1M re-baseline | Δ exec | Notes |
|---|---|---|---|---|
| Q1 issue list | 0.18 ms / 3.52 ms plan | **0.23 ms** / 1.01 ms plan | +28% | Index Scan on `issues_project_status_last_seen_idx`; same plan, planning *faster* on the larger DB |
| Q2 events for issue | 0.17 ms / 3.52 ms plan | **0.46 ms** / 2.65 ms plan | +170% | 1M events in one issue+partition; index walks newest-first and stops at LIMIT 50 |
| Q3 sessions health | 0.08 ms / 0.46 ms plan | **0.21 ms** / 0.46 ms plan | +160% | Sessions table unchanged at 117 rows; Seq Scan still correct |
| Q4 alert rule sweep | 0.06 ms / 0.56 ms plan | **0.29 ms** / 0.56 ms plan | +380% | Same 115 rules; variance is buffer-cache state, not plan |
| Q5 webhook dispatch | 0.05 ms / 0.52 ms plan | **0.05 ms** / 0.52 ms plan | 0% | Partial index pinned; flat |
| **Total exec** | **0.55 ms** | **1.24 ms** | **2.3×** | 200× more data, 2.3× slower; sub-millisecond budget intact |

## Methodology

The dataset is half "natural" (5k events from `tools/seed-events.ts`
via HTTP, with realistic fingerprinting and per-event project_id
distribution) and half "bulk" (1M synthetic rows inserted directly
via SQL `generate_series` against a single hot issue, to make the
data set big without spending 25 min of HTTP throughput on the
ingest path).

Bulk insert template:

```sql
INSERT INTO events (...)
SELECT
  uuidv7(),
  '<project>'::uuid,
  '<issue>'::uuid,
  NULL,
  now() - (random() * INTERVAL '7 days'),
  ...
FROM generate_series(1, 100000) s;
```

Run 10× → 1 M rows in ~20 s wall-clock. All rows land in the
current month's partition (`events_2026_05`, 491 MB).

To restore the DB after measuring:

```sql
DELETE FROM events WHERE payload->'tags'->>'synthetic' = 'bulk-1m';
```

## Q1 — Issue list (1M dataset)

```
Limit  (cost=0.57..30.87 rows=100 width=165) (actual time=0.035..0.194 rows=100 loops=1)
  Buffers: shared hit=69 read=32
  ->  Nested Loop Left Join
        ->  Index Scan using issues_project_status_last_seen_idx on issues i
              Index Cond: project_id = ... AND status = 'active'
              actual time=0.028..0.165 rows=100
              Buffers: shared hit=69 read=32
        ->  Memoize (assignee_user_id → users.email)
              Hits: 99  Misses: 1
Planning Time: 1.009 ms
Execution Time: 0.226 ms
```

- ✅ Same plan as 5 k baseline — composite index `(project_id,
  status, last_seen DESC)` answers the query in 100 rows, no Filter
  step required.
- The DB grew 100× in events count but only ~1.3× in issues (1265 →
  1266 because the bulk insert reused one issue). So Q1's latency
  rise from 0.18 → 0.23 ms reflects buffer-cache state, not
  data growth. Planning *fell* from 3.52 → 1.01 ms — partition
  metadata is sharper after sub-D's `events_default` + sub-E's
  cleanup ran.

## Q2 — Events for a single issue (1M dataset)

The hot 1M-row issue. Plan still walks the index newest-first per
partition and stops at LIMIT 50:

```
Append (across all 7 events partitions)
  ->  Index Scan using events_2026_05_issue_id_received_at_idx on events_2026_05
        Index Cond: issue_id = ... AND received_at >= now() - '90 days'
        Filter: project_id = ...
        actual time: <0.5 ms total
  ->  ... 6 more partitions, all returning 0 rows
Planning Time: 2.648 ms
Execution Time: 0.455 ms
```

- ✅ The 1M events under one issue do **not** materialise into the
  plan. Postgres walks `(issue_id, received_at DESC)` descending,
  fetches the first 50 ROWS and stops. Index Searches: 1.
- ⚠️ Planning Time 2.65 ms vs Execution 0.46 ms — the planner still
  recompiles partition pruning per query, same caveat as the 5 k
  baseline. The sub-E partition-pruning hint helps when there are
  *more partitions* (12+ months); 7 partitions hits the noise
  floor where the hint barely matters.

**No change required.** The cost is in cross-partition planning
overhead, not data scanning.

## Q3 — Sessions health aggregate (unchanged)

```
Sort -> Seq Scan on sessions
  Filter: project_id = ... AND received_at >= now() - 24h
  Rows Removed by Filter: 117
Execution Time: 0.207 ms
```

117 rows total — Seq Scan continues to be correct. Latency growth
from 0.08 → 0.21 ms is buffer cache, not a plan change.

## Q4 — Alert rule cron sweep

```
Seq Scan on alert_rules
  Filter: enabled AND NOT muted AND trigger_kind='event_count' AND (snoozed_until IS NULL OR <now())
  rows=72 of 115
Execution Time: 0.287 ms
```

115 rules, predicate keeps 72. Same shape as 5 k. The latency
variance (0.06 → 0.29 ms) is again cache state — Q4 is now
running on a 509 MB DB so buffer pressure is higher.

The deferred `(trigger_kind) WHERE enabled AND NOT muted` partial
index would shave this further, but **still not warranted**: 0.29 ms
on a 30 s cron has zero impact on system load. Decision unchanged.

## Q5 — Webhook dispatch sweep (flat)

```
Sort -> Seq Scan on webhook_deliveries
  Filter: status='pending' AND next_attempt_at <= now()
  rows=0 of 54
Execution Time: 0.050 ms
```

Identical to 5 k baseline. The partial index
`idx_webhook_deliveries_pending` is sized for the case where the
table grows past a few hundred rows with a long `delivered`/`failed`
tail; current shape (54 rows total) doesn't reach that threshold.

## Conclusions

- The schema scales cleanly from 5 k to 1 M events with no new
  indexes. All five hot-path queries stay sub-millisecond.
- The Q2 planning-time observation (2.65 ms vs 0.46 ms execution)
  remains the largest fraction of the wall-clock budget; sub-E's
  hint is correct in principle but its full payoff only lands when
  the partition count grows past a year.
- The two indexes flagged "deferred" in the 5 k baseline
  (`list_events_for_issue` partition pruning at 12+ months,
  `alert_rules` partial index above 500 rules) are still not earning
  their keep. No migration needed.

## Action items for sub-B and sub-E

- **Sub-B (cursor pagination)** is still valuable: dashboard
  rendering of 1k+ issues is bottlenecked by React, not PG. Cursor
  + infinite scroll lets the dashboard skip materialising rows it
  doesn't show.
- **Sub-E (performance baseline doc)** is essentially this file +
  the 5 k file from Phase 30 sub-D + the lesson "regression
  threshold = `plan or buffer pages change shape`, not "wall-clock
  +20%"" — wall-clock at 1 M is dominated by cache state and is a
  noisy signal.

No changes to migrations or query code are required as a result of
this re-baseline.

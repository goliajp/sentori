# EXPLAIN ANALYZE baseline — Phase 30 sub-D

> Dataset: 5,000 synthetic events / 987 issues / 117 sessions /
> ~115 stale alert_rules / ~54 stale webhook_deliveries, seeded via
> `tools/seed-events.ts --events 5000 --issues 1000 --include-anr`.
> PG 18, dev `sentori-pg` container. Queries reproduced verbatim from
> the dashboard's hot paths (`server/src/api/*.rs`).

## TL;DR

**All five hot-path queries hit existing indexes or are correctly
Seq-Scanned at this scale.** Execution time for the five queries
combined is **0.55 ms**. The dashboard's perceived latency at 5k
events is dominated by the React/TanStack-Query roundtrip, not PG.

No new indexes are mandatory for sub-E at 5k-event scale. Two
review-at-scale items are flagged below for when sub-D is re-run at
1M events (Phase 33 sub-A).

---

## Q1 — Issue list (most-common dashboard hit)

`GET /admin/api/projects/{id}/issues?status=active` → top of every
session. Plan:

```
Limit  (cost=0.57..29.61 rows=100) (actual time=0.027..0.150 rows=100)
  Buffers: shared hit=102
  ->  Nested Loop Left Join
        ->  Index Scan using issues_project_status_last_seen_idx on issues i
              Index Cond: project_id = ... AND status = 'active'
        ->  Memoize (assignee_user_id → users.email)
              Hits: 99  Misses: 1
Execution Time: 0.183 ms
```

- ✅ Composite index `(project_id, status, last_seen DESC)` is exactly
  what the query needs; no Filter step, planner reads 100 rows from
  the index in order.
- ✅ Memoize for the `LEFT JOIN users u` — 99/100 cache hits because
  most issues are unassigned. Effectively free.
- Bottleneck: none at this scale. **At 1M events / 100k issues, the
  102 buffer hits scale linearly to ~200 (index height + leaf reads);
  still sub-ms.**

## Q2 — Events for a single issue (issue detail page)

`GET /admin/api/projects/{id}/issues/{issue_id}/events`. Touches every
events partition.

```
Append (across events_2026_05..events_2026_10 + events_default)
  ->  Index Scan using events_<month>_issue_id_received_at_idx
        Index Cond: issue_id = $1
        Filter:   project_id = $2
  ->  ... repeated per partition
Execution Time: 0.172 ms
Planning Time: 2.679 ms  ← noteworthy
```

- ✅ Per-partition Index Scan on `(issue_id, received_at DESC)`. Each
  partition returns 0 or N rows; total 50 returned.
- ⚠️ **Planning Time 2.7 ms vs Execution Time 0.17 ms** — the planner
  recompiles partition pruning each query. Acceptable for a click
  but a noticeable share of the wall-clock budget.
- 🔁 **Review at 1M events** (sub-E candidate): adding `AND received_at
  >= now() - INTERVAL '90 days'` to the query lets the planner prune
  every events partition older than 90 days statically. Drops planning
  time substantially when the partition count grows. Code change is
  in `server/src/api/admin.rs::list_events_for_issue`.

  **Implemented in Phase 30 sub-E.** Verified with a synthetic
  `events_2025_q1` + `events_2025_q4` partition pair created against
  the dev DB: the query plan **dropped from 9 partitions scanned to
  7** with the hint in place (both 2025 partitions pruned). Planning
  time fell from 3.52 ms → 3.16 ms at this scale; the win scales with
  partition count, so the larger return is once the cluster carries
  12+ months of partitions in production. The lookback is exposed as
  a server-bounded `?days=` query param (default 90, clamp 1..365)
  so the dashboard can still ask for older windows when investigating
  long-tail issues.

## Q3 — Health aggregate (5-minute bucket, last 24h)

`GET /admin/api/projects/{id}/health` — overview widget.

```
Seq Scan on sessions
  Filter: project_id = $1 AND received_at >= now() - 24h
  Rows Removed by Filter: 117
Execution Time: 0.079 ms
```

- ✅ Seq Scan at 117 rows is the right call — index lookup overhead
  beats sequential read at this size.
- Index `sessions_project_received_idx` exists (`(project_id,
  received_at DESC)`, migration 0021). The planner will pick it at
  scale once `random_page_cost × log(N)` beats Seq Scan cost.
- 🔁 **Review at 1M sessions**: re-run this query, verify planner
  switches to the index scan. If not, set `enable_seqscan = off` on
  the connection for this query, or add a hint.

## Q4 — Alert rule cron sweep (`event_count` trigger)

`server/src/rule_eval.rs::sweep_event_count` — runs every 60s.

```
Seq Scan on alert_rules
  Filter: enabled AND NOT muted AND trigger_kind = 'event_count'
          AND (snoozed_until IS NULL OR snoozed_until < now())
  Rows Removed by Filter: 43
Execution Time: 0.064 ms
```

- ✅ 115 rules total in dev (lots from prior tests), Seq Scan reads
  all of them and the filter keeps 72. Tiny.
- 🔁 **Review at 1k alert_rules** (a single-org large-team scenario):
  if planner sticks with Seq Scan because the predicate filters > 50%
  of rows, consider a partial index `(trigger_kind) WHERE enabled AND
  NOT muted` to short-circuit the cron sweep.

## Q5 — Webhook dispatch pending sweep

`server/src/webhook_dispatch.rs::sweep_once` — runs every 30s.

```
Seq Scan on webhook_deliveries
  Filter: status = 'pending' AND next_attempt_at <= now()
  Rows Removed by Filter: 54
Execution Time: 0.048 ms
```

- ✅ Partial index `idx_webhook_deliveries_pending` already exists on
  `(status, next_attempt_at) WHERE status='pending'`. Planner picks
  Seq Scan because the unfiltered table is tiny.
- At scale (10k+ deliveries with `failed`/`delivered` tail), the
  partial index becomes the only thing the cron touches. Sized
  exactly for sub-B's hot path.

---

## Methodology

```sh
# 1. spin up a clean dev DB (or accept the current state — synthetic
#    events are tagged `synthetic: seed-events` for later cleanup).
docker compose up -d postgres

# 2. seed the data shape this baseline assumes.
bun tools/seed-events.ts \
  --token "$SENTORI_DEV_TOKEN" \
  --events 5000 --users 200 --releases 10 --issues 1000 --include-anr \
  --ingest-url http://localhost:8080

# 3. EXPLAIN (ANALYZE, BUFFERS) each query above against the dev DB.

# 4. cleanup if desired:
docker exec sentori-pg psql -U postgres -d sentori \
  -c "DELETE FROM events WHERE payload->'tags'->>'synthetic' = 'seed-events'"
```

## Action items for sub-E

Sub-E (索引补齐) is **mostly a no-op at the 5k-event baseline** —
every hot-path query already lands on its intended index. The two
items considered:

1. ✅ **`list_events_for_issue` partition pruning hint** — implemented.
   Added a server-bounded `?days=` query param (default 90, clamp
   1..365) and `AND received_at >= now() - make_interval(days => $)`
   to the SQL. Verified the planner statically prunes events
   partitions older than the bound (see Q2 implementation note).

2. ⏸ **`alert_rules` partial index for cron sweep** — deferred. Only
   adds value above ~500 rules in a single org and the current dev
   shape (115 rules, of which 72 match the cron predicate) doesn't
   meet that bar. Tracked as a follow-up note in the Q4 section above
   rather than a sub-E migration.

The 1M-event re-baseline (Phase 33 sub-A) is the next opportunity to
catch regressions and decide whether the deferred item above needs to
land as a migration.

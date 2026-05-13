# Sentori — performance baseline

Single source of truth for what "fast enough" means in this codebase.
Three measurements feed this page; each one has a dedicated baseline
doc with the raw output and methodology — links below.

## Headline numbers

| Surface | Measurement | Result | SLO target | Headroom |
|---|---|---|---|---|
| Dashboard issue list (Q1) | EXPLAIN ANALYZE @ 1M events | **0.23 ms** execution | 50 ms | 217× |
| Issue detail events (Q2) | EXPLAIN ANALYZE @ 1M events | **0.46 ms** execution | 50 ms | 109× |
| Sessions health aggregate (Q3) | EXPLAIN ANALYZE @ 1M events | **0.21 ms** execution | 50 ms | 238× |
| Alert rule cron sweep (Q4) | EXPLAIN ANALYZE @ 1M events | **0.29 ms** execution | 100 ms | 345× |
| Webhook dispatch sweep (Q5) | EXPLAIN ANALYZE @ 1M events | **0.05 ms** execution | 100 ms | 2000× |
| Ingest `/v1/events` | k6-style 50 req/s × 60 s | **P99 12.6 ms** | 200 ms | 16× |
| Ingest `/v1/events:batch` | 50 req/s × 60 s | **P99 33.5 ms** | 200 ms | 6× |
| Ingest `/v1/sessions` | 50 req/s × 60 s | **P99 5.7 ms** | 200 ms | 35× |
| Ingest `/v1/deploys` | 50 req/s × 60 s | **P99 6.2 ms** | 200 ms | 32× |

All measurements taken on the same dev environment: macOS 25.4
(Darwin) + Postgres 18 in docker (`sentori-pg` on `127.0.0.1:55434`)
+ sentori-server debug build. Production with the release build and
real network jitter will skew different in either direction; the
numbers above are the reference for "does this PR regress
something."

## Detail per surface

- [`baseline-v0.3-phase30.md`](./performance/baseline-v0.3-phase30.md) —
  EXPLAIN ANALYZE for all five hot-path queries at 5 k events / 1 k
  issues. Per-query plan + buffer counts + bottleneck analysis +
  "review at scale" deferred items.
- [`baseline-v0.3-phase33.md`](./performance/baseline-v0.3-phase33.md) —
  Same five queries re-run at 1.02 M events. Comparison table
  against the 5 k baseline; methodology (SQL bulk INSERT for the
  synthetic 1 M because the HTTP path is throughput-capped at 660
  ev/s by inline server processing); conclusion that both deferred
  items (partition pruning + alert_rules partial index) are still
  not earning their keep.
- [`ingest-load-test.md`](./performance/ingest-load-test.md) — Four
  ingest endpoints at 50 req/s open-loop scheduler for 60 s.
  Per-endpoint P50/P95/P99/max latency table + per-endpoint
  analysis. 0 errors out of 3,000 requests.
- [`dashboard-lcp.md`](./performance/dashboard-lcp.md) — Lighthouse
  CI assertion gate for the dashboard. LCP < 1.2 s is a hard
  build-breaker; TBT / FCP / CLS emit warnings. Run with
  `cd web && bun run build && bun run preview & bun run lhci`.

## Regression policy

**A PR is performance-regressing if:**

1. Any of the nine headline numbers above is worse by **> 20 %** on
   re-measurement against the same dataset shape, **OR**
2. Any EXPLAIN plan changes shape — index name change, partition
   pruning loss, Seq Scan introduced, new Sort step, Hash Join
   becomes Merge, etc. Pure cost-estimate changes are not
   automatic regressions; new plan operators are.

**The reviewer asks for one of three things** if a regression is
detected:

1. **An explanation in the PR description**, naming the
   measurement that regressed and why the trade-off is worth it
   (new feature, new index for correctness, etc).
2. **A `phase XX sub-Y:` follow-up commit** that recovers the
   number before merge.
3. **A `docs/performance.md` update** that explicitly accepts the
   new baseline because the old one was wrong or the SLO target
   was overly tight.

The threshold is intentionally loose at 20 % because wall-clock
varies with buffer cache state and Postgres pg_dump bgwriter ticks.
Plan-shape changes are tight (binary) because those are diagnostic
of a structural shift, not noise.

## How to re-measure

Each detail doc above has a "Methodology" section with the exact
commands. The TL;DR:

```bash
# EXPLAIN baselines — 5 k or 1 M scale (see each doc)
bun tools/seed-events.ts --token "$SENTORI_DEV_TOKEN" \
  --events 5000 --issues 1000 --include-anr \
  --ingest-url http://localhost:8080
# Then connect to postgres and EXPLAIN (ANALYZE, BUFFERS) the
# five queries from the detail docs.

# Ingest load test — adjust --rate and --duration
bun tools/load-test.ts --token "$SENTORI_DEV_TOKEN" \
  --ingest-url http://localhost:8080 \
  --rate 50 --duration 60
```

After re-measuring, update the headline table above and link the
new detail doc.

## Out-of-scope for v0.3

The following are valid performance questions but not load-bearing
for the v0.3 release; they'll get baselines when the time comes:

- **Symbolication latency at scale**. The `sentori_symbolicate_duration_seconds`
  histogram (Phase 31 sub-F) is now wired but needs real Grafana
  data over weeks of traffic to be meaningful. A baseline against
  this metric goes into the equivalent v0.4 phase.
- **Concurrent dashboard sessions**. Each connection to the
  dashboard maintains its own polling loop for issues +
  /v1/events/_recent; we have not measured the server's per-conn
  ceiling. Single-conn is comfortably fast; multi-conn is a v0.4
  question.
- **Storage growth rate per event**. Inferable from the 1 M event
  bulk insert (~500 MB on partition `events_2026_05`, so ≈ 0.5 KB
  per event), but not a formal baseline yet because the synthetic
  rows are smaller than real ones (no stack frames, simple
  payload). A formal "X events per GB" number will land alongside
  the retention tooling.

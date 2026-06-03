# v2-metrics — runtime metrics ingest + storage + rollup pipeline

Status: **draft — lands ahead of v2.1 W1 code per the doc-first
convention from Phase 42.**

Date: 2026-06-03

Owner: claude + takagi

References:

- `docs/roadmap/v2.1.md` — L3b W1 implementation plan; this doc
  fleshes out the schema, partition / rollup / retention strategy,
  cron interval math, BI query grammar, and the capacity envelope
  it implies.
- `server/src/api/metrics.rs` — v0.8.3 metrics endpoint (already
  on prod, drives the recordMetric path; v2.1 W1 layers
  auto-instrument metrics on top of it via a new endpoint that
  shares the same storage table).
- `.claude/CLAUDE.md` — performance bedrock that bounds every
  decision here (host main-thread < 1 % sustained, < 5 ms tick,
  60 s window < 500 KB total network).

## Why a new endpoint, not extend `/v1/events`?

`/v1/events` carries event-shaped payloads (`kind: error | message
| anr | nearCrash`) that route through the same parser, fingerprint
pipeline, attachment writer, and notification gates. Adding a
metric kind to that union forces every consumer of the event
parser to handle a no-op for the new kind; worse, the fingerprint
+ notification pipeline is irrelevant for metrics and would burn
cycles on every batch.

The orthogonal endpoint `POST /v1/events/<p>/metrics` shares the
**token boundary** (project_id-keyed `st_pk_*` token, same as
`/v1/events`) but has its own parser, validator, and writer. Zero
overlap with the event ring.

This mirrors what the existing v0.8.3 `POST /v1/metrics:batch`
already does — v2.1 W1 unifies the URL path under the
`/v1/events/<p>/*` shape so the SDK can use one base URL for
everything, and keeps the v0.8.3 endpoint as a permanent alias
for back-compat.

## Schema

### `runtime_metrics_raw` (new — migration `0068`)

Daily-partitioned by `ts`. 90-day raw retention. Each row is one
metric point; SDK batches up to 500 points per HTTP request.

```sql
CREATE TABLE runtime_metrics_raw (
  ts          timestamptz   NOT NULL,
  project_id  uuid          NOT NULL,
  name        text          NOT NULL,   -- e.g. "runtime.fps.p50"
  value       double precision NOT NULL,
  tags        jsonb         NOT NULL DEFAULT '{}'::jsonb,
  tags_hash   bigint        NOT NULL,    -- stable hash of tags for primary key
  release     text,                       -- denormalized dim — covered by index
  environment text,                       -- denormalized dim
  device_class text,                      -- "phone-low" / "phone-mid" / "tablet" / "desktop"
  PRIMARY KEY (project_id, ts, name, tags_hash)
) PARTITION BY RANGE (ts);
```

**Why denormalize `release` / `environment` / `device_class`** out
of `tags`: every BI query slices on these. A column lookup beats
a `tags->>` JSON expression by ~5× on cold cache; the storage
overhead (~12 bytes per row) is negligible vs. the per-query
latency win.

**Why `tags_hash` in the PK**: two batches that emit the same
`(name, tags)` at the same `ts` should idempotently dedup. Hash
of canonical-JSON tags makes the constraint cheap (vs hashing the
whole tag JSON at query time).

Partitions are created daily by a cron (see "Partition lifecycle"
below). Each daily partition is named
`runtime_metrics_raw_yyyymmdd`.

### `runtime_metrics_1m`, `_1h`, `_1d` (new — migration `0068`)

Flat materialized aggregate tables. Refreshed by
`metrics_rollup::spawn_cron` (see below).

```sql
CREATE TABLE runtime_metrics_1m (
  bucket_ts   timestamptz NOT NULL,  -- floor(ts, 1 min)
  project_id  uuid        NOT NULL,
  name        text        NOT NULL,
  release     text,
  environment text,
  device_class text,
  -- 6 measures pre-computed per bucket × dim combo
  count       bigint      NOT NULL,
  sum         double precision NOT NULL,
  avg         double precision NOT NULL,
  p50         double precision NOT NULL,
  p95         double precision NOT NULL,
  p99         double precision NOT NULL,
  PRIMARY KEY (project_id, bucket_ts, name, release, environment, device_class)
);
-- _1h: PRIMARY KEY identical, bucket_ts is floor(ts, 1 hour)
-- _1d: PRIMARY KEY identical, bucket_ts is floor(ts, 1 day)
```

**Why pre-compute p50/p95/p99 instead of storing histograms**:
the dashboard's BI panel only ever shows headline percentiles. A
t-digest column would store ~200 bytes per row to answer the same
queries with worse compression and worse cache locality. Pay the
percentile-computation cost once at rollup time; serve queries in
microseconds.

**Why `(release, environment, device_class)` in the rollup PK**:
the BI panel queries always group by at least one of these. Pre-
aggregating per-dim combo means the query is a covering index
scan, not a per-row tag-JSON evaluation.

### `runtime_metrics_dropped` (new — migration `0068`)

Per-day counters for accounting drops (rate-limit overflow,
malformed values, unknown tag keys). Daily granularity is enough
for "did we lose 0.001 % or 8 %" sanity checks; per-row drop
events would be a self-DoS.

```sql
CREATE TABLE runtime_metrics_dropped (
  day        date   NOT NULL,
  project_id uuid   NOT NULL,
  reason     text   NOT NULL,  -- 'rate_limit' | 'malformed' | 'unknown_tag'
  count      bigint NOT NULL,
  PRIMARY KEY (project_id, day, reason)
);
```

### Indexes (migration `0069`)

```sql
-- Raw: by-name latest reads + by-name time-window scans
CREATE INDEX runtime_metrics_raw_pname_ts
  ON runtime_metrics_raw (project_id, name, ts DESC);

-- Rollups: every BI query is (project, name, bucket_ts range)
CREATE INDEX runtime_metrics_1m_pname_bucket
  ON runtime_metrics_1m (project_id, name, bucket_ts DESC);
CREATE INDEX runtime_metrics_1h_pname_bucket
  ON runtime_metrics_1h (project_id, name, bucket_ts DESC);
CREATE INDEX runtime_metrics_1d_pname_bucket
  ON runtime_metrics_1d (project_id, name, bucket_ts DESC);
```

Postgres 18 handles the rest via the table partitioning's implicit
ts-range pruning.

## Retention

| Tier | Retention | Why |
|---|---|---|
| `_raw` | 90 d | Enough to investigate any single dogfood-week regression; drops align with the events table's existing 30 d retention plus a buffer. |
| `_1m` | 90 d | Same window — BI defaults to 24 h–7 d on this tier, so 90 d covers month-over-month. |
| `_1h` | 365 d | Annual trend reporting. |
| `_1d` | forever | Single row per day per dim combo; storage is trivial. |

Retention is enforced by extending the existing
`server/src/retention.rs` cron (already runs daily) to drop old
partitions of `_raw` and delete-by-bucket-ts on rollup tables.

## Partition lifecycle

A small cron tick (`metrics_partition::spawn_cron`, hourly)
maintains the `_raw` daily partitions:

- On boot + every hour: ensure today + tomorrow + day-after-
  tomorrow partitions exist (3-day rolling window).
- Daily at 03:00 UTC (off-peak for SaaS deployment in JST):
  drop partitions older than `now - 90d`.

Implemented in pure SQL — `CREATE TABLE IF NOT EXISTS … PARTITION
OF runtime_metrics_raw FOR VALUES FROM … TO …` — no extension
dependency. Avoids the pg_partman / TimescaleDB requirement so
self-hosted deployments stay on a stock Postgres 18.

## Rollup pipeline (`metrics_rollup::spawn_cron`, 60 s tick)

Matches the existing `rule_eval::spawn_cron` / `digest::spawn_cron`
/ `velocity::spawn_cron` / `webhook_dispatch::spawn_cron` modular
shape — one `tokio::spawn` per cron, owned by `main.rs` startup
sequencing.

**Tick math**:

- **60 s tick** (raw → 1m): on each tick, aggregate `_raw` rows
  where `ts ∈ [now - 70 s, now - 10 s)` into `_1m` (10 s safety
  margin: SDK batches flush every 30 s, so a metric emitted at
  `now-65s` lands at the server around `now-35s`; the 10 s margin
  catches in-flight batches without double-counting).
- **Once per hour at minute 03** (1m → 1h): aggregate the previous
  hour's `_1m` into `_1h`. Cheap — only ~60 rows per dim combo.
- **Once per day at 03:30 UTC** (1h → 1d): aggregate the previous
  day's `_1h` into `_1d`. Trivial.

Each tier uses `ON CONFLICT (...) DO UPDATE` so re-running a tick
is idempotent — the right primary key + the right merge function
let the same source range produce the same destination row, every
time.

## BI query grammar

The dashboard's BI panel shapes queries as:

```
DIM × MEASURE × TIME_BUCKET → series
```

| Axis | Picker values |
|---|---|
| **dim** | `release` / `environment` / `device_class` / `route` / `os_version` / `none` |
| **measure** | `avg` / `p50` / `p95` / `p99` / `sum` / `count` |
| **time bucket** | `1m` / `5m` / `15m` / `1h` / `1d` |

Server picks the rollup tier based on `(bucket, from, to)`:

| Window | Tier | Why |
|---|---|---|
| `to - from ≤ 1 h` and bucket ≤ `1m` | `_raw` (with on-the-fly aggregate) | Recent investigation; user wants exact values. |
| `1 h < to - from ≤ 30 d` | `_1m` (or higher if bucket is coarser) | Dashboard default — 24 h overview. |
| `30 d < to - from ≤ 180 d` | `_1h` | Cross-week / month-over-month. |
| `to - from > 180 d` | `_1d` | Annual reporting / capacity planning. |

Bucket coarser than the picked tier triggers a server-side
`date_trunc(bucket, bucket_ts)` GROUP BY in the SQL — no
materialized 5m/15m tiers; those are computed on-the-fly from
`_1m`. The query cost stays in microseconds because of the
covering index.

`name` is always required in the query — there's no "all metrics
right now" endpoint, because the answer is meaningless at
dashboard scale (every project has 6–50 distinct metric names).

## Capacity envelope

**Per-project ingest rate** (steady-state):

- SDK auto-instrument emits ~12 metric points / 30 s flush per
  device (FPS p50 + p95, heap, cold-start (rare), 3 route-nav
  buckets, network bytes in/out, CPU, battery).
- 100 devices/project × 12 points / 30 s = 4 points/sec/project
  steady state. Times a 50-project SaaS estimate → ~200 QPS write
  on `_raw`.

**Storage** (`_raw` at 90 d retention):
- 200 QPS × 86400 s × 90 d ≈ 1.5 B rows
- ~80 B / row uncompressed → ~120 GB. With pg 18's default
  compression on jsonb tags + ts ordering, expect ~60 GB on
  disk.

**Storage** (rollups, all tiers combined):
- Worst-case dim explosion: `(name × release × env × device_class)`
  = 30 × 50 × 3 × 4 = 18000 distinct rows per minute.
- `_1m` at 90 d: 18000 × 60 × 24 × 90 = 2.3 B rows. ~80 B each →
  ~180 GB.
- Realistic dim cardinality (most metric names don't fan out
  across every dim) cuts this 10–50×.

**Networking** (host app side, per SDK budget):

- 12 points × ~100 B / point per 30 s flush = ~1.2 KB / 30 s →
  ~2.4 KB / min.
- Compared to the 500 KB / 60 s NEVER-rule ceiling, metrics
  contribute ~0.5 % of the budget. Plenty of headroom for the
  auto-instrument expansion in W2.

**Server CPU** (rollup cron):

- 60 s tick aggregating 60 s × 200 QPS = 12k raw rows into ~3k
  rollup rows. SQL plan estimate: ~150 ms on the prod box. Idle
  for the other 59.85 s of each interval.

## Failure modes

| Mode | Behaviour | Why |
|---|---|---|
| `_raw` insert fails (DB timeout, partition missing) | Server returns `503` + `metrics-batch-deferred`; SDK rebuffers and retries on next flush. | Don't lose metrics on transient prod issues. |
| Rate-limit overflow (project exceeds 1000 metrics/sec) | Server returns `429` with `Retry-After: 1`; increments `runtime_metrics_dropped.reason='rate_limit'`; SDK halves the in-app batch size for the next flush. | Adaptive backpressure without poisoning the queue. |
| Malformed metric (name regex mismatch, non-finite value, > 16 tags) | Server silently drops just the bad point in the batch; rest land normally; increments `dropped.reason='malformed'`. | One bad metric in a batch of 500 shouldn't reject the whole batch. |
| Rollup tick falls behind | `tracing::warn!("metrics rollup lag exceeded …")` if `now - max(bucket_ts) > 90 s`; surface in dashboard as a banner. | Operator sees the problem before customers notice their chart hasn't moved. |
| Partition cron didn't pre-create today's partition | First insert auto-creates it (uses `IF NOT EXISTS` retry path inside the writer). | Robustness against the cron itself failing — the data path is the SOT. |

## What's NOT in this design (defer to v2.2+)

- **Custom user metric API** (`sentori.metric.counter("checkout.click")` /
  `gauge` / `histogram`). v2.1 surfaces only the auto-instrument
  set. Custom metrics need a naming convention, tag-cardinality
  governance, and a type-system story; defer until auto-instrument
  dogfoods through Insight.
- **Alerting rules on metrics** (e.g. "page me when FPS p95 < 30
  for 5 min"). Reuses v1.2 `rule_eval::spawn_cron` infra; defer
  to v2.2 once a few months of dogfood data shows which dim
  combos people actually want to alert on.
- **Histogram retention** (full t-digest per bucket). p50/p95/p99
  cover ~95 % of dashboard intent; full distributions are a
  power-user feature that pulls in t-digest infra. Defer.
- **PromQL / Graphite escape hatch**. v2.1 BI panel is the only
  query surface. Power-user query language is its own L2.

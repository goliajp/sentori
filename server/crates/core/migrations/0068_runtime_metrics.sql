-- v2.1 W1 — runtime metrics ingest + storage.
--
-- New surface, orthogonal to /v1/events. Five tables:
--   runtime_metrics_raw       — partitioned by day, 90d retention
--   runtime_metrics_1m / _1h / _1d  — flat materialized aggregates
--   runtime_metrics_dropped   — per-day accounting counters
--
-- Schema rationale + capacity envelope: docs/design/v2-metrics.md
-- The v0.8.3 `metrics` table (powering the recordMetric path on
-- /v1/metrics:batch) is left untouched — v2.1 layers on top via
-- the new tables, not as a migration of the existing one. Both
-- coexist; recordMetric is a small custom-metric channel,
-- runtime_metrics_* is the auto-instrument firehose.

CREATE TABLE runtime_metrics_raw (
  ts            timestamptz       NOT NULL,
  project_id    uuid              NOT NULL,
  name          text              NOT NULL,
  value         double precision  NOT NULL,
  tags          jsonb             NOT NULL DEFAULT '{}'::jsonb,
  -- Stable hash of canonical-JSON tags. Two batches with the same
  -- (project, ts, name, tags) idempotently dedup via PK.
  tags_hash     bigint            NOT NULL,
  -- Denormalized dim columns (also live in `tags`). Every BI
  -- query slices on these — a column lookup is ~5x cheaper than
  -- tags->>'release' on cold cache, and the storage overhead is
  -- ~12 bytes / row.
  release       text,
  environment   text,
  device_class  text,
  PRIMARY KEY (project_id, ts, name, tags_hash)
) PARTITION BY RANGE (ts);

-- Bootstrap partitions for the rolling 3-day window. The hourly
-- `metrics_partition` cron (added in W1 part 2) extends this
-- forward + drops partitions past 90d retention.
CREATE TABLE runtime_metrics_raw_2026_06_03
  PARTITION OF runtime_metrics_raw
  FOR VALUES FROM ('2026-06-03 00:00:00+00') TO ('2026-06-04 00:00:00+00');

CREATE TABLE runtime_metrics_raw_2026_06_04
  PARTITION OF runtime_metrics_raw
  FOR VALUES FROM ('2026-06-04 00:00:00+00') TO ('2026-06-05 00:00:00+00');

CREATE TABLE runtime_metrics_raw_2026_06_05
  PARTITION OF runtime_metrics_raw
  FOR VALUES FROM ('2026-06-05 00:00:00+00') TO ('2026-06-06 00:00:00+00');

-- Rollup tiers. Pre-computed (count, sum, avg, p50, p95, p99) per
-- (project, bucket_ts, name, release, environment, device_class).
-- Pre-computing percentiles instead of storing histograms costs
-- nothing in dashboard intent and ~200 B / row less in storage.
CREATE TABLE runtime_metrics_1m (
  bucket_ts     timestamptz       NOT NULL,
  project_id    uuid              NOT NULL,
  name          text              NOT NULL,
  release       text              NOT NULL DEFAULT '',
  environment   text              NOT NULL DEFAULT '',
  device_class  text              NOT NULL DEFAULT '',
  count         bigint            NOT NULL,
  sum           double precision  NOT NULL,
  avg           double precision  NOT NULL,
  p50           double precision  NOT NULL,
  p95           double precision  NOT NULL,
  p99           double precision  NOT NULL,
  PRIMARY KEY (project_id, bucket_ts, name, release, environment, device_class)
);

CREATE TABLE runtime_metrics_1h (
  bucket_ts     timestamptz       NOT NULL,
  project_id    uuid              NOT NULL,
  name          text              NOT NULL,
  release       text              NOT NULL DEFAULT '',
  environment   text              NOT NULL DEFAULT '',
  device_class  text              NOT NULL DEFAULT '',
  count         bigint            NOT NULL,
  sum           double precision  NOT NULL,
  avg           double precision  NOT NULL,
  p50           double precision  NOT NULL,
  p95           double precision  NOT NULL,
  p99           double precision  NOT NULL,
  PRIMARY KEY (project_id, bucket_ts, name, release, environment, device_class)
);

CREATE TABLE runtime_metrics_1d (
  bucket_ts     timestamptz       NOT NULL,
  project_id    uuid              NOT NULL,
  name          text              NOT NULL,
  release       text              NOT NULL DEFAULT '',
  environment   text              NOT NULL DEFAULT '',
  device_class  text              NOT NULL DEFAULT '',
  count         bigint            NOT NULL,
  sum           double precision  NOT NULL,
  avg           double precision  NOT NULL,
  p50           double precision  NOT NULL,
  p95           double precision  NOT NULL,
  p99           double precision  NOT NULL,
  PRIMARY KEY (project_id, bucket_ts, name, release, environment, device_class)
);

-- Per-day accounting counters. One row per (project, day, reason).
-- Drops sized for ops sanity checks ("0.001 % or 8 %?"); per-row
-- drop events would be self-DoS.
CREATE TABLE runtime_metrics_dropped (
  day         date    NOT NULL,
  project_id  uuid    NOT NULL,
  -- 'rate_limit' | 'malformed' | 'unknown_tag'
  reason      text    NOT NULL,
  count       bigint  NOT NULL,
  PRIMARY KEY (project_id, day, reason)
);

-- v2.1 W1 — indexes for the runtime metrics surface.
--
-- Every BI panel query is `(project_id, name, time-window)` —
-- a covering index on each tier nails it.
-- Postgres 18 handles ts-range partition pruning on _raw via the
-- existing PARTITION BY RANGE (ts) so we don't need an extra
-- (project_id, ts) index there.

-- Raw: by-name latest reads + by-name time-window scans
CREATE INDEX runtime_metrics_raw_pname_ts
  ON runtime_metrics_raw (project_id, name, ts DESC);

-- Rollup tiers: by-name bucket-window scans
CREATE INDEX runtime_metrics_1m_pname_bucket
  ON runtime_metrics_1m (project_id, name, bucket_ts DESC);

CREATE INDEX runtime_metrics_1h_pname_bucket
  ON runtime_metrics_1h (project_id, name, bucket_ts DESC);

CREATE INDEX runtime_metrics_1d_pname_bucket
  ON runtime_metrics_1d (project_id, name, bucket_ts DESC);

-- Drop-counter housekeeping queries: by-project + by-day.
CREATE INDEX runtime_metrics_dropped_pday
  ON runtime_metrics_dropped (project_id, day DESC);

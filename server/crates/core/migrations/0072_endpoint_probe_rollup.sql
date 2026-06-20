-- v2.1 W4 — endpoint probe hourly rollup table.
--
-- One row per (check_id, hour) with pre-computed uptime % +
-- latency percentiles. Refreshed by `endpoint_probe_rollup`
-- ticking hourly at minute 04 (offset from metrics_rollup's
-- minute 03 so the two crons don't fight for the buffer pool).
--
-- Forever-retained (one row per check per hour is trivial).
-- Drives the dashboard's 24 h sparkline + 7 d trend chart.

CREATE TABLE endpoint_probe_1h (
  bucket_ts      timestamptz      NOT NULL,
  check_id       uuid             NOT NULL,
  probe_count    integer          NOT NULL,
  ok_count       integer          NOT NULL,
  uptime_pct     double precision NOT NULL,
  p50_latency_ms integer          NOT NULL,
  p95_latency_ms integer          NOT NULL,
  PRIMARY KEY (check_id, bucket_ts)
);

-- Reverse-chrono read path: dashboard pulls the most recent
-- N hours per check for the sparkline.
CREATE INDEX endpoint_probe_1h_check_bucket
  ON endpoint_probe_1h (check_id, bucket_ts DESC);

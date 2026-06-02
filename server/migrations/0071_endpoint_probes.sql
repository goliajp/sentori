-- v2.1 W4 — endpoint probe results table.
--
-- One row per HTTP probe attempt. Day-partitioned + 30 d
-- retention (vs runtime_metrics' 90 d — probe data is denser
-- but the 1 h rollup summarises everything dashboards need).
--
-- The endpoint_probe_partition cron (paired with metrics_partition)
-- extends the forward window + drops past 30 d.

CREATE TABLE endpoint_probe (
  ts          timestamptz NOT NULL,
  check_id    uuid        NOT NULL,
  -- HTTP status code observed. 0 when the request never got
  -- past DNS / TCP / TLS — `error_kind` disambiguates.
  status_code integer     NOT NULL,
  latency_ms  integer     NOT NULL,
  -- True when EVERY configured assertion held.
  ok          boolean     NOT NULL,
  -- Set when ok=false. One of:
  --   'dns' | 'tcp' | 'tls' | 'timeout'
  --   'status' | 'body' | 'latency'
  error_kind  text,
  PRIMARY KEY (check_id, ts)
) PARTITION BY RANGE (ts);

-- Bootstrap partitions for the rolling 3-day window. The hourly
-- `endpoint_probe_partition` cron (W4 part 2) extends forward +
-- drops partitions older than 30 d.
CREATE TABLE endpoint_probe_2026_06_03
  PARTITION OF endpoint_probe
  FOR VALUES FROM ('2026-06-03 00:00:00+00') TO ('2026-06-04 00:00:00+00');

CREATE TABLE endpoint_probe_2026_06_04
  PARTITION OF endpoint_probe
  FOR VALUES FROM ('2026-06-04 00:00:00+00') TO ('2026-06-05 00:00:00+00');

CREATE TABLE endpoint_probe_2026_06_05
  PARTITION OF endpoint_probe
  FOR VALUES FROM ('2026-06-05 00:00:00+00') TO ('2026-06-06 00:00:00+00');

-- Hot read paths: dashboard renders 1 h / 24 h / 7 d windows
-- via ts range per check; the consecutive-2 issue lifecycle
-- query reads `ORDER BY ts DESC LIMIT 2` per check.
CREATE INDEX endpoint_probe_check_ts
  ON endpoint_probe (check_id, ts DESC);

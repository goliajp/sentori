-- v2.1 W4 — endpoint health configuration table.
--
-- One row per user-configured URL check. The cron worker
-- (endpoint_probe::spawn_cron) scans this table every 60 s,
-- selects rows that are not paused + whose interval has elapsed
-- since the last probe, and fans out a probe via reqwest.
--
-- See docs/design/v2-endpoint-health.md for the full assertion +
-- lifecycle rationale.

CREATE TABLE endpoint_check (
  id                       uuid PRIMARY KEY,
  project_id               uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- User-supplied label so dashboard list rows show something
  -- friendlier than the raw URL.
  name                     text NOT NULL,
  target_url               text NOT NULL,
  -- 'GET' / 'POST' / 'HEAD'. POST with body lands in v2.1.1.
  method                   text NOT NULL DEFAULT 'GET',
  -- Probe cadence. CHECK enforces the v2.1 floor at 60 s; lower
  -- intervals need cost guardrails (defer to v2.2).
  interval_sec             integer NOT NULL DEFAULT 60
                           CHECK (interval_sec >= 60),
  -- Assertions. NULL skips that check. Status assertion is an
  -- array of allowed codes — [200] for strict APIs, [200, 304]
  -- for cacheable endpoints, [200, 201, 204] for write paths.
  assertion_status_codes   integer[] NOT NULL DEFAULT ARRAY[200],
  -- Substring (not full regex) for hot-path speed. v2.1.1 can
  -- promote this to full regex if needed; pretty much every
  -- "the API is alive" check is a substring match against a
  -- known liveness payload (e.g. `"status":"ok"`).
  assertion_body_substring text,
  -- Probe is considered fail above this many ms (network +
  -- TLS + body read combined). NULL → no latency assertion.
  assertion_max_latency_ms integer,
  paused                   boolean NOT NULL DEFAULT false,
  created_by               uuid,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX endpoint_check_project ON endpoint_check (project_id);
-- Cron scan-due path: partial index on the "active" subset so
-- the cron's main filter stays a covering scan even at thousands
-- of checks per project.
CREATE INDEX endpoint_check_active
  ON endpoint_check (project_id, interval_sec)
  WHERE NOT paused;

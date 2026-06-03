# v2-endpoint-health — synthetic outside-in endpoint probing

Status: **draft — lands ahead of v2.1 W4 code per the doc-first
convention.**

Date: 2026-06-03

Owner: claude + takagi

References:

- `docs/roadmap/v2.1.md` — L3b W4 implementation plan.
- `docs/design/v2-metrics.md` — partition + rollup pattern this
  doc reuses.
- `.claude/CLAUDE.md` — the SDK performance bedrock doesn't
  apply here (probes run server-side, no SDK involvement) but
  the deploy isolation contract does — endpoint probe is one
  more cron in `sentori-server`, no new processes / services.

## L1 — Why outside-in

The auto-instrument runtime metrics (W1+W2) answer "is the SDK
inside the host app reporting healthy numbers?" Endpoint health
answers a different question: "is the host app's user-facing URL
reachable, returning the right status, returning the right body,
and doing all that under a latency SLA?" — answered without
trusting the SDK to be installed.

That decoupling is the whole point. A customer-facing API can be
silently 500'ing for hours before a single user-facing event
fires. A synthetic probe catches it on the next 60 s tick.

## L2 — Boundary

### In v2.1 W4

- User configures N URL checks per project via dashboard CRUD.
- `endpoint_probe::spawn_cron` (60 s tick) scans `endpoint_check`
  WHERE `NOT paused` AND `(last_probe IS NULL OR last_probe +
  interval_sec < now())`, fans out via `tokio::spawn` capped at
  32 concurrent probes.
- Each probe: `reqwest::Client` with 30 s timeout. Assertion
  engine: status code allowlist + body regex + max latency.
- Consecutive-2-fail → auto-create issue with kind `endpoint_down`,
  fingerprint root = target_url, current latency / error_kind
  as tags. Consecutive-2-pass after fail → auto-resolve.
- Notification dispatch through the existing `notifier_tx` channel
  (no new infra — endpoint_down issues route through Linear /
  Slack / email recipient rules exactly like a thrown exception
  would).
- Dashboard `/main/health`: list with 24 h uptime sparkline +
  p95 latency + status badge per row; detail view with 1 h / 24 h
  / 7 d timeseries + paginated probe log.
- Admin CRUD: `POST/GET/PUT/DELETE /admin/api/projects/{p}/
  endpoint-checks/{id?}` with `endpoint_check:write` IAM scope.

### Explicitly NOT in W4 (deferred)

- **Multi-region probe.** v2.1 only probes from lx64. Docs
  carry an "outage detection ≠ outage immunity" caveat.
  Multi-region needs Cloudflare Worker dispatch (per-region
  cron + per-region results table). Defer to v2.2 + paid-tier
  gating.
- **Plan-gated probe frequency.** v2.1 ships 60 s as the
  minimum interval; the `interval_sec >= 60` schema constraint
  enforces it. Lower intervals (10 s) need cost guardrails
  that don't yet exist. Defer to v2.2.
- **Browser headless probe (Lighthouse-style).** v2.1 only
  HTTP-asserts on status / body / latency. Page-load timing
  / web-vitals via headless Chromium is a much heavier
  primitive — defer to its own L2.
- **Probe-driven runtime metrics emit.** A future change could
  have the probe write `runtime.endpoint.{up,latency_ms}` into
  `runtime_metrics_raw` so the same BI panel works on both
  data sources. Compelling but not in W4 scope.
- **Webhook-on-failure beyond the issue-created notification.**
  Hosts get the standard notification routing through the
  endpoint_down issue. A dedicated webhook channel scoped to
  endpoint checks (with different retry policy than the
  generic webhook delivery cron) is a follow-up if anyone
  asks.

## Schema

### `endpoint_check` (migration `0070`)

```sql
CREATE TABLE endpoint_check (
  id                       uuid PRIMARY KEY,
  project_id               uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- User-supplied label so the dashboard row shows something
  -- friendlier than the raw URL.
  name                     text NOT NULL,
  target_url               text NOT NULL,
  -- 'GET' / 'POST' / 'HEAD'. POST with body lands in v2.1.1.
  method                   text NOT NULL DEFAULT 'GET',
  -- Probe cadence. CHECK enforces the v2.1 floor at 60 s.
  interval_sec             integer NOT NULL DEFAULT 60
                           CHECK (interval_sec >= 60),
  -- Assertions. NULL skips that check. Status assertion is an
  -- array of allowed codes — 2xx normally, [200] for strict APIs,
  -- [200, 304] for cacheable.
  assertion_status_codes   integer[] NOT NULL DEFAULT ARRAY[200],
  -- Substring (not full regex) for hot-path speed. v2.1.1 can
  -- promote this to full regex if needed; pretty much every
  -- "the API is alive" check is a substring match against a
  -- known liveness payload.
  assertion_body_substring text,
  -- Probe is considered fail above this many ms (network +
  -- TLS + body read combined). NULL → no latency assertion.
  assertion_max_latency_ms integer,
  paused                   boolean NOT NULL DEFAULT false,
  created_by               uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX endpoint_check_project ON endpoint_check (project_id);
-- Cron scan-due query path: WHERE NOT paused AND (last … due).
-- The "last probe time" lives in endpoint_probe, but a partial
-- index here gates the cron's main filter cheaply.
CREATE INDEX endpoint_check_active
  ON endpoint_check (project_id, interval_sec)
  WHERE NOT paused;
```

### `endpoint_probe` (migration `0071`)

Partitioned by `ts` daily, same shape as `runtime_metrics_raw`.
30 d retention (vs runtime_metrics' 90 d — probe data is dense,
1 row / interval / check, so 90 d would be ~120k rows per
high-frequency check while still summarising to the same uptime
% / p95).

```sql
CREATE TABLE endpoint_probe (
  ts            timestamptz NOT NULL,
  check_id      uuid        NOT NULL,
  -- HTTP status code observed. 0 when the request never got
  -- past DNS / TCP / TLS (use error_kind to disambiguate).
  status_code   integer     NOT NULL,
  latency_ms    integer     NOT NULL,
  -- True when EVERY configured assertion held.
  ok            boolean     NOT NULL,
  -- Set when ok=false. One of:
  --   'dns'   'tcp'   'tls'   'timeout'
  --   'status'   'body'   'latency'
  error_kind    text,
  PRIMARY KEY (check_id, ts)
) PARTITION BY RANGE (ts);

-- Bootstrap 3-day window. The endpoint_probe_partition cron
-- (added in W4 part 2) extends + drops past 30 d retention.
CREATE TABLE endpoint_probe_2026_06_03
  PARTITION OF endpoint_probe
  FOR VALUES FROM ('2026-06-03 00:00:00+00') TO ('2026-06-04 00:00:00+00');
CREATE TABLE endpoint_probe_2026_06_04
  PARTITION OF endpoint_probe
  FOR VALUES FROM ('2026-06-04 00:00:00+00') TO ('2026-06-05 00:00:00+00');
CREATE TABLE endpoint_probe_2026_06_05
  PARTITION OF endpoint_probe
  FOR VALUES FROM ('2026-06-05 00:00:00+00') TO ('2026-06-06 00:00:00+00');

-- Hot read path: dashboard renders 1 h / 24 h / 7 d windows
-- by ts range per check.
CREATE INDEX endpoint_probe_check_ts
  ON endpoint_probe (check_id, ts DESC);
```

### `endpoint_probe_1h` materialised aggregate (migration `0072`)

```sql
CREATE TABLE endpoint_probe_1h (
  bucket_ts     timestamptz NOT NULL,
  check_id      uuid        NOT NULL,
  probe_count   integer     NOT NULL,
  ok_count      integer     NOT NULL,
  uptime_pct    double precision NOT NULL,
  p50_latency_ms integer    NOT NULL,
  p95_latency_ms integer    NOT NULL,
  PRIMARY KEY (check_id, bucket_ts)
);

CREATE INDEX endpoint_probe_1h_check_bucket
  ON endpoint_probe_1h (check_id, bucket_ts DESC);
```

Refreshed by a small cron tick parallel to `metrics_rollup` —
hourly at minute 04 (offset from metrics' minute 03 so the
rollup query plan estimator doesn't see both crons fight for
the same buffer pool).

## Assertion engine

Pure function in a dedicated module so unit tests can replay
fixture responses without spinning a real HTTP client:

```rust
pub struct AssertionConfig {
    pub status_codes: Vec<i32>,
    pub body_substring: Option<String>,
    pub max_latency_ms: Option<i32>,
}

pub enum ProbeOutcome {
    Ok,
    Fail(&'static str), // 'dns' | 'tcp' | 'tls' | 'timeout' |
                        // 'status' | 'body' | 'latency'
}

pub fn evaluate(
    cfg: &AssertionConfig,
    status_code: i32,
    body: &str,
    latency_ms: i32,
) -> ProbeOutcome {
    if !cfg.status_codes.contains(&status_code) {
        return ProbeOutcome::Fail("status");
    }
    if let Some(needle) = &cfg.body_substring {
        if !body.contains(needle.as_str()) {
            return ProbeOutcome::Fail("body");
        }
    }
    if let Some(max) = cfg.max_latency_ms {
        if latency_ms > max {
            return ProbeOutcome::Fail("latency");
        }
    }
    ProbeOutcome::Ok
}
```

Network-failure classification (`dns` / `tcp` / `tls` / `timeout`)
happens around the `reqwest` call site by inspecting the error
chain; the assertion engine only ever sees the success path.

## Auto-issue lifecycle

State derives from the last N probes per check; no separate
flapping table. On every probe insert:

1. Read the last 2 probes for this `check_id` (cheap — covering
   index on `(check_id, ts DESC)`).
2. If both `ok = false` AND there's no open `endpoint_down` issue
   for this check → create one (fingerprint = `endpoint_down:
   <target_url>`).
3. If both `ok = true` AND there's an open `endpoint_down`
   issue for this check → auto-resolve it (resolution reason =
   "endpoint recovered after N probes ok").

Consecutive-2 (not consecutive-3) is the chosen sensitivity —
one transient failure shouldn't page; two in a row is signal.
Customers who want a different N can request it; the schema
doesn't lock us in.

## Failure modes

| Mode | Behaviour |
|---|---|
| Probe HTTP client times out | error_kind='timeout', ok=false. Counts toward the consecutive-fail tally. |
| DNS resolution fails | error_kind='dns'. Same. |
| Body read times out mid-response | latency_ms = (start-to-error elapsed), ok=false. error_kind='timeout'. |
| Concurrent recreates of the same partition | CREATE TABLE IF NOT EXISTS — idempotent. |
| Cron tick misses (server restart) | Next tick catches up; checks whose `interval_sec` window already lapsed fire immediately. No "must run exactly N times per hour" guarantee. |
| Endpoint check deleted while a probe is in-flight | INSERT into endpoint_probe fails on FK (check_id removed) — drop silently with a warn log. |

## Capacity envelope

- Cron tick = 60 s. Concurrent probe cap = 32.
- 100 checks at 60 s interval = ~1.6 QPS, fully absorbed by a
  single 32-worker fan-out.
- Probe row size ~50 B. 100 checks × 86400 / 60 = 144k rows /
  day. 30 d retention → 4.3 M rows total — trivial on the
  prod box.
- `endpoint_probe_1h` aggregate: 100 checks × 24 = 2400 rows /
  day. Forever-retained, never a concern.

## Why one cron, not one per check

A check-per-cron tokio task would scale to thousands of probes
but at the cost of one timer per check and a lifecycle problem
on pause / delete (have to kill the right task). One global
cron + scan-due query is O(checks-overdue) per tick, which is
still O(1) per check per interval. Pause / delete is a SQL
update — no task plumbing.

## Web UX surface

`/main/<org>/<project>/health` route, sidebar-pinned next to
Runtime.

- **List view** — one row per check. Columns: name, target_url,
  status badge (green / amber transient / red down / grey
  paused), 24 h uptime sparkline (from `_1h` rollup), p95
  latency over 24 h, "edit" / "pause" action.
- **Detail view** — 1 h / 24 h / 7 d toggle, timeseries of
  uptime (% per hour bucket) + latency (p50 + p95). Cursor-
  paginated probe log below. "Related issues" panel listing
  every auto-created `endpoint_down` issue for this check
  (resolved + open).
- **New / edit form** — target URL, method, interval, assertion
  editor (status codes multi-input, body substring, max
  latency). "Probe now" button does a one-shot dry-run before
  save.
- **Empty state** — illustration + a "Create your first check"
  CTA with three pre-filled examples (homepage / API health
  endpoint / login flow).

## Notification routing

Reuses the existing `notifier_tx` + `notifications` recipient
infrastructure. An `endpoint_down` issue lands like any other
issue: tag-filter rules + per-recipient channels apply. The
issue's `error_type` field is `"endpoint_down"`, `message_sample`
is the assertion fail summary (e.g. `"GET https://api.example.com
returned 503 — expected one of [200]"`).

Hosts who want a tighter SLA-grade pager flow (PagerDuty
integration, escalation policy) layer it on top of the existing
issue → webhook integration, which already runs through the
notifier.

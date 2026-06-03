---
title: Endpoint health — synthetic HTTP probes with assertions
description: v2.1 ships a synthetic probe that pings a URL on a schedule, runs status / body / latency assertions, and auto-creates an issue on consecutive failure. Set up + dashboard + alerting rules.
---

# Endpoint health

v2.1 ships a **synthetic monitoring** layer: register an HTTP
endpoint, the server pings it on a fixed cadence from the Sentori
control plane, runs a small set of assertions, and rolls the results
up in the **Health** dashboard. On consecutive failure it opens a
regular issue in the same project — so the existing on-call routes
(Slack / Linear / Jira / webhook) light up without extra wiring.

Unlike SDK runtime metrics, this needs **zero host integration**.
It's a server-side feature; the only "code" is a JSON payload that
defines the probe.

## When to use it

- Public HTTPS endpoints whose uptime feeds your SLO
- Auth-free health probes (`/healthz`, `/readyz`, `/api/ping`)
- Third-party dependencies you want a soft eye on (payment, identity,
  CDN)

When **not** to use it:

- Anything that needs request signing or rotating bearer tokens
  (v2.1 probes carry no auth header).
- High-cardinality URL spaces (one check per URL — don't register
  thousands).
- Replacing your real APM. Synthetic probes catch *external* downtime;
  the SDK pipeline catches *internal* errors. You want both.

## Creating a check

Open **Health** in the sidebar and click **New check**. Fill in:

| Field | Required | Default | Notes |
|---|---|---|---|
| `name` | yes | — | Human label, shown in the dashboard |
| `targetUrl` | yes | — | `http://` or `https://`, ≤ 2048 chars |
| `method` | no | `GET` | `GET` / `POST` / `HEAD` |
| `intervalSec` | no | `60` | Floor is 60 s |
| `assertionStatusCodes` | no | `[200]` | List of allowed status codes |
| `assertionBodySubstring` | no | — | Response body must contain this string |
| `assertionMaxLatencyMs` | no | — | Response time must be ≤ this |

A check is saved as `paused: false` and the next probe runs at the
top of the next 60 s tick.

### From the API

The dashboard form is a thin wrapper over the CRUD endpoint:

```http
POST /admin/api/projects/{projectId}/endpoint-checks
Content-Type: application/json

{
  "name": "api healthz",
  "targetUrl": "https://api.example.com/healthz",
  "method": "GET",
  "intervalSec": 60,
  "assertionStatusCodes": [200],
  "assertionBodySubstring": "ok",
  "assertionMaxLatencyMs": 800
}
```

Other routes follow the conventional shape:

```
GET    /admin/api/projects/{projectId}/endpoint-checks
GET    /admin/api/projects/{projectId}/endpoint-checks/{id}
PUT    /admin/api/projects/{projectId}/endpoint-checks/{id}
DELETE /admin/api/projects/{projectId}/endpoint-checks/{id}

GET    /admin/api/projects/{projectId}/endpoint-checks/{id}/probes
       ?from=...&to=...&limit=200                  — raw probe log
GET    /admin/api/projects/{projectId}/endpoint-checks/{id}/rollup
       ?from=...&to=...                            — 1 h tier
```

## What the probe does

Each scheduled tick:

1. Resolves DNS, opens a TCP connection, completes TLS.
2. Sends the request with a **30 s timeout** and reads at most
   **64 KB** of response body.
3. Evaluates assertions in order: `status_codes` → `body_substring`
   → `max_latency_ms`. The first failure wins.
4. Writes one row to `endpoint_probe(ts, check_id, status_code, latency_ms, ok, error_kind)`.

The `error_kind` taxonomy is small and ordered: `dns`, `tcp`, `tls`,
`timeout`, `status`, `body`, `latency`. The dashboard surfaces this so
you know whether the endpoint is **unreachable** (network layer) or
**misbehaving** (assertion layer).

A second cron rolls raw probes into `endpoint_probe_1h`
(`bucket_ts`, `probe_count`, `ok_count`, `uptime_pct`, `p50_latency_ms`,
`p95_latency_ms`) every hour. The dashboard sparkline reads from the
rollup; the probe-log table reads from raw.

## Auto-issue on consecutive failure

The assertion engine isn't a paging system on its own — it feeds the
**issue pipeline**. The rule:

> Two consecutive failing probes (within `2 × intervalSec`) opens an
> issue in the same project, level `error`, fingerprint
> `endpoint:<check-id>:<error_kind>`.

The first success after that resolves the issue. That fingerprint
choice means:

- A flapping `status` failure and a flapping `dns` failure on the same
  check are **two separate issues** — you can mute one without
  silencing the other.
- A second outage tomorrow on the same check + same `error_kind` is
  the **same issue** re-opened, not a new one — your dashboards stay
  stable.

Because the failure surface is a regular issue, every existing routing
rule applies for free: Slack channels, Linear / Jira sync, webhooks,
on-call schedules, per-issue mute. No new alert grammar.

## Multi-region: not in 2.1

Probes currently run from **one region** (whichever region the
control-plane scheduler lives in). Multi-region — with quorum
("issue only if ≥ 2 of 3 regions fail") — is deferred per
[`docs/design/v2-endpoint-health.md`](https://github.com/goliajp/sentori/blob/main/docs/design/v2-endpoint-health.md).
The single-region floor is honest about its blind spots: a global CDN
outage in one POP won't show up if your probe egresses from a
different POP.

If single-region is unacceptable for an SLO-critical endpoint, layer a
third-party multi-region monitor (StatusCake / UptimeRobot / Pingdom)
on top — they have a separate vantage point. Sentori's value isn't
"we replace every monitor", it's that endpoint failures land in the
**same issues + routing surface** as your application errors.

## Dashboard

**Health** (`Monitor → Health`) shows:

- One row per check with name, current 24 h uptime, last 24 h
  sparkline (one bar per hour, height = uptime %), and the latest
  probe result.
- Expand a row for the probe log — most recent 200 probes with `ts`,
  `status_code`, `latency_ms`, `ok`, and `error_kind` on failure.
- v2.1.3 split: per-check **detail page** at
  `/main/<org>/<project>/health/{id}` with 1 h / 24 h / 7 d
  rollup charts and cursor-paginated full probe log.

## Performance / cost

Probe traffic is **bounded by design**:

- 60 s floor on `intervalSec` → ≤ 1440 probes per check per day.
- 32 concurrent probes globally (scheduler semaphore) → never bursty.
- 64 KB body read cap → no surprise from a misbehaving endpoint.
- No retry on a single failed probe — failure is part of the signal.

The **target** endpoint sees one request every minute per check,
indistinguishable from a curl. The **Sentori control plane** writes
one row per probe + one row per hour-bucket per check.

## Related

- [Runtime metrics](./runtime-metrics.md) — client-side runtime
  vitals; the SDK cousin of this server-side probe.
- [Manual issue reporting](./manual-issue.md) — same Issues surface
  used here for auto-issue.
- [Multi-environment](./multi-environment.md) — register a check per
  environment with `environment` tag for staging / prod separation.

---
title: Runtime metrics — FPS, heap, cold-start, network, route nav
description: v2.1 auto-instruments six runtime signals from the host app and rolls them up in the Runtime dashboard. When to opt in, what lands, how to read it.
---

# Runtime metrics

v2.1 adds an opt-in pipeline that auto-instruments the host app's
**runtime health** — frame rate, JS heap, cold-start time, route
navigation latency, and network volume — and rolls it up in the
**Runtime** dashboard. Distinct from `captureException` (errors),
`startSpan` (traces), and `recordMetric` (business metrics): runtime
metrics are the **continuous vitals** of the app process itself.

The auto-instrument lives in the SDK. The host writes zero code beyond
the `capture.runtimeMetrics` flag.

## What gets emitted

The RN SDK ships six auto-instruments:

| Metric name | What it measures | Cadence | Source |
|---|---|---|---|
| `runtime.fps.p50` | Frame rate over a 1 s window | 1 Hz | `requestAnimationFrame` ticks |
| `runtime.heap.used_bytes` | JS heap occupancy | 0.2 Hz | Hermes / V8 `performance.memory` |
| `runtime.cold_start_ms` | Time from native launch → first JS render | once / session | RN bridge ready hook |
| `runtime.network.bytes_sent` | Request body bytes out | per request | `fetch` + `XHR` instrumentation |
| `runtime.network.bytes_received` | Response body bytes in | per request | same |
| `runtime.route_nav_ms` | Dwell time per route push | per nav | `@react-navigation` listener |

Each point carries automatic tags:

- `release` — the app build the point came from
- `environment` — `prod` / `staging` / `dev`
- `device_class` — coarse bucket (`low` / `mid` / `high`) derived
  from the device's reported total RAM

Tags are what drive the **dim** picker in the Runtime BI panel.

## Enabling it

### React Native (default **on**)

```ts
import { initSentori } from '@goliapkg/sentori-react-native'

initSentori({
  token: 'st_pk_…',
  release: 'myapp@1.2.3+456',
  // capture.runtimeMetrics defaults to true on RN.
  // To opt out:
  // capture: { runtimeMetrics: false },
})
```

The default is on because the per-tick cost of the RN auto-instruments
is bounded by a stop-ship perf budget (`< 1 %` main-thread sustained,
`< 5 ms` per tick) — see [the performance bedrock](https://github.com/goliajp/sentori/blob/main/.claude/CLAUDE.md).
If you've shipped 2.0.x and don't want the new traffic yet, flip it off
explicitly.

### Web (default **off**)

```ts
import { initSentori } from '@goliapkg/sentori-javascript'

initSentori({
  token: 'st_pk_…',
  release: 'web@1.2.3',
  capture: { runtimeMetrics: true }, // off by default in 2.1.0
})
```

Web is opt-in because the auto-instrument modules in 2.1.0 are RN-only;
turning the flag on just starts the **flusher** so a host can call
`emitMetric()` directly. The same is true for Vue / Svelte / Solid —
they inherit the JS flusher behaviour.

## How it flushes

Runtime metrics share the **30 s flusher** with the rest of the
non-event signals. The SDK drains a **10 000-point ring buffer** to
`/v1/runtime-metrics:batch` once per cycle, coalesced with the span
and metric POSTs so the host pays one round-trip, not three. Under
sustained overflow the ring drops the **oldest** points first and
self-reports the count via the internal circuit-breaker.

The wire batch is bounded:

- ≤ 10 000 points per drain (ring cap)
- ≤ 200 bytes per `name`, ≤ 16 tags, ≤ 40 / 200 bytes per tag key/value
- malformed points are silently dropped (NEVER rule — internal
  validation failures never throw to the host)

## Reading it in the dashboard

Open **Runtime** in the sidebar (`Monitor → Runtime`, or `g r` once
the chord lands in v2.1.2). The page has two layers:

1. **Six hero cards** — last 24 h reading of each signal, sized for at-a-glance
   triage. The card colour swaps from accent to red when the signal
   trends the wrong way vs the previous 24 h.
2. **BI panel** — pick `dim × measure × bucket`:
   - `dim`: `none` / `release` / `environment` / `device_class`
   - `measure`: `avg` / `p50` / `p95` / `p99` / `sum` / `count`
   - `bucket`: `1m` / `5m` / `15m` / `1h` / `1d`

The query routes to the right rollup tier automatically (raw → `_1m`
→ `_1h` → `_1d`) per
[`docs/design/v2-metrics.md`](https://github.com/goliajp/sentori/blob/main/docs/design/v2-metrics.md).
The resolution actually served is surfaced as a badge below the chart.

### Common slices

| Question | dim | measure | bucket |
|---|---|---|---|
| Did the new release drop FPS? | `release` | `p50` | `15m` |
| Are low-end devices crashing the heap? | `device_class` | `p95` | `1h` |
| How long is cold start trending? | `none` | `p95` | `1d` |
| Where is the navigation regression? | `none` (filter by route via tags) | `p95` | `15m` |

## Programmatic access

Everything the UI shows comes from a single typed endpoint:

```
GET /admin/api/projects/{projectId}/runtime-metrics/query
  ?name=runtime.fps.p50
  &measure=p50
  &dim=release
  &bucket=15m
  &from=2026-06-02T00:00:00Z
  &to=2026-06-03T00:00:00Z
```

Response:

```json
{
  "tier": "_1m",
  "series": [
    { "label": "myapp@1.2.3", "points": [{ "ts": "...", "value": 58.4 }, ...] },
    { "label": "myapp@1.2.2", "points": [...] }
  ]
}
```

The same shape feeds AI agents and ad-hoc queries — see
[`docs/protocol`](../protocol.md) for the full grammar.

## Custom metrics ≠ runtime metrics

`emitMetric` from `@goliapkg/sentori-core` is **for the auto-instrument
hooks**, not for business code. Two reasons:

1. The ring is sized for ~ms-cadence vitals, not bursty user actions.
2. The wire format strips down to `{ name, value, tags, ts }` — no
   span correlation, no breadcrumbs, no level.

For business observations use [`recordMetric`](./track-and-metrics.md):

```ts
sentori.recordMetric('cart.size', cart.length)
sentori.recordMetric('db.query.duration_ms', 42, { parent: span })
```

`recordMetric` goes through `/v1/metrics:batch` with looser validation
and span correlation. Runtime metrics and `recordMetric` end up in two
different dashboards — that separation is intentional.

## Performance budget

Per-platform measurements from v2.1 W2 perf bench (in CI as
`.github/workflows/sdk-perf.yml`):

- iOS (iPhone 14): FPS instrument adds **0.3 %** main thread, route nav
  **< 1 ms** per push.
- Android (Pixel 5): FPS instrument adds **0.7 %** main thread, route
  nav **< 2 ms** per push.
- Per-flush network: **< 50 KB** for a typical 30 s window on RN.

Stop-ship gate: if any auto-instrument crosses **5 ms** per tick on
the slowest device class (currently Pixel 5 / iPhone SE 2nd gen as
floor), the perf bench fails and the change can't ship.

## Related

- [Track + recordMetric](./track-and-metrics.md) — business analytics
  + metrics, distinct pipeline.
- [Manual trace + span](./manual-trace.md) — engineering timing with
  parent-child structure.
- [Endpoint health](./endpoint-health.md) — synthetic uptime probes,
  the server-side cousin of runtime metrics.

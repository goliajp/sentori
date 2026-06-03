---
title: Find slow routes
description: Where's the worst slowness — and is a new release making it worse? Per-route p50 / p95 in the Vitals dashboard.
---

The find-slow lens (v2.5) answers two operator questions:

1. **Where's the worst slowness right now?** Sort the per-route
   table by `ttid p95` descending; the worst routes float to
   the top.
2. **Did this release make it worse?** Pick "release A" in the
   release picker, screenshot the table. Pick "release B".
   Better: tick the same route on both views via the **compare**
   checkbox, then the delta strip shows `+45ms (12%)` or
   `-12ms (-3%)` per measure.

The data is the same `spans`-table aggregation the SDK has
populated since v0.9.4 (`tags['vital.kind']`, `useTraceNavigation`
hook). No new SDK call is needed if your app is already running
v1.0+ with `mobile-vitals` enabled.

## Dashboard flow

`/main/<org>/<project>/vitals` (or press `g v` from anywhere).

### Sort

Click any column header to sort by it. `↓` next to the label
means descending (the default for numeric columns); `↑` is
ascending. The sort lives in URL state (`?sort=ttidP95&dir=desc`)
so a sorted view is shareable.

Default sort: `ttid p95` descending. Right answer for the
default operator question.

### Compare

Each row has a checkbox in the left-most column. Tick up to 4
routes. The **first** ticked row becomes the baseline; each
subsequent ticked row appears in a delta strip above the table
with `+N ms (P %)` for each TTID measure plus a slow-frame
delta:

```text
compare · baseline /checkout
route             ttid p50 Δ        ttid p95 Δ        slow Δ
/cart             +12ms (+8%)       +45ms (+12%)      +3
/profile          -8ms (-5%)        -15ms (-3%)       —
```

Bold + coloured deltas mean the change crossed a threshold worth
acting on (`±5%` for p50, `±10%` for p95, any non-zero slow
delta).

To clear the comparison, click `clear` in the strip header.

### Drill

The route name in each row is a link. Clicking it routes to the
Issues list filtered by `tags.route = <route>` — pivot from "this
route is slow" to "what errors hit on this route, in what
window."

## Programmatic / agent flow

The data comes from the existing v0.9.4 vitals endpoint:

```bash
# Releases that have vitals data.
curl -X GET \
  "https://sentori.golia.jp/admin/api/projects/$PROJECT_ID/vitals/releases" \
  -H "Authorization: Bearer $SENTORI_ADMIN_TOKEN"

# Per-route p50/p95 + slow/frozen totals for one release.
curl -X GET \
  "https://sentori.golia.jp/admin/api/projects/$PROJECT_ID/vitals?release=myapp@1.2.3" \
  -H "Authorization: Bearer $SENTORI_ADMIN_TOKEN"
```

Response:

```jsonc
{
  "release": "myapp@1.2.3",
  "coldStart": { "p50Ms": 1230, "p95Ms": 2810, "samples": 442 },
  "perRoute": [
    {
      "route": "/checkout",
      "navigations": 1042,
      "ttidP50Ms": 280,
      "ttidP95Ms": 720,
      "ttfdP50Ms": 410,
      "ttfdP95Ms": 1150,
      "ttfdSamples": 312,
      "totalSlowFrames": 86,
      "totalFrozenFrames": 2
    }
    // … more routes
  ]
}
```

LLM-agent decision rule for "where to start triaging":

1. Sort `perRoute` by `ttidP95Ms` desc.
2. Drop routes with `navigations < 20` (statistical noise).
3. For the top 5, compare against the previous release's same
   route (re-fetch with the previous `?release=`) to flag a
   regression.
4. For each flagged regression, fetch the Issues filtered by
   `tags.route = <route>` to surface a likely cause.

## What populates the data

- **Cold start.** `mobile-vitals.ts` measures the delta between
  `applicationDidFinishLaunching` (iOS) /
  `Process.getStartElapsedRealtime()` (Android) and `init()`
  completion. SDK ships one `sentori.cold_start` span per
  process with `tags['vital.kind'] = 'cold_start'`.
- **TTID / TTFD per route.** `useTraceNavigation(navigationRef)`
  emits a `sentori.navigation` span with
  `tags['vital.kind'] = 'navigation'`, `data.route`, and the
  measured intervals. Calling `markTimeToFullDisplay(span)` when
  the screen finishes rendering tags the same span with
  `vital.ttfd_ms`.
- **Slow / frozen frame counters.** Tracked per-tick by the
  same hook; aggregated as `vital.slow_frames` /
  `vital.frozen_frames` tags on the navigation span.

## What this is NOT

- **Not a single-event flame graph.** Each row is a population
  aggregate. To see a single navigation's full breakdown, drill
  into the Traces module (currently `hidden: true`; opens with
  its own lens later).
- **Not a real-time signal.** Numbers refresh on page open;
  there's no streaming. For real-time "the app is laggy
  *right now*", the SDK's `preCrashSentinel` + ANR watchdog
  surface `nearCrash` events that float to Issues.
- **Not a perf budget gate for the SDK itself.** That lives in
  `sdk/core/src/__tests__/perf.bench.ts` (CI-gated). The
  numbers here measure the *host app's* speed, not Sentori's
  overhead.

## Related

- [`api/init`](../api/init.md) — `capture.runtimeMetrics` toggle
- [`recipes/runtime-metrics`](./runtime-metrics.md) — the
  auto-instrument SDK side
- [`recipes/find-bugs-with-explore`](./find-bugs-with-explore.md)
  — companion lens; the Issues drill from a slow route lands
  there

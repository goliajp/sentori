---
'@goliapkg/sentori-core': patch
'@goliapkg/sentori-javascript': minor
'@goliapkg/sentori-svelte': minor
'@goliapkg/sentori-vue': minor
'@goliapkg/sentori-solid': minor
---

v2.1.1 — web matrix runtime metrics wiring + perf budget CI

**Web SDKs now ship the runtime-metrics surface**

`@goliapkg/sentori-javascript`:

- New `runtime-metrics.ts` flusher mirroring the RN module —
  drains core's ring every 30 s and POSTs to
  `/v1/runtime-metrics:batch` via the same transport shape (auth
  + `Sentori-Sdk` header + `keepalive: true`). On failure,
  rebuffers + self-reports through the circuit breaker per the
  NEVER rule.
- `initSentori({ capture: { runtimeMetrics: true } })` opt-in
  starts the flusher. Defaults `false` in JS because the
  auto-instrument modules (FPS / heap / network bytes) are
  RN-only in 2.1.0; web hosts that want to push metrics today
  call `emitMetric()` directly from their own polling.
- Re-exports `emitMetric` / `RuntimeMetricBuffer` /
  `drainRuntimeMetricsForFlush` / `rebufferRuntimeMetrics` /
  `flushRuntimeMetrics` / `startRuntimeMetricsTimer` /
  `stopRuntimeMetricsTimer` so framework adapters don't have
  to pull in `@goliapkg/sentori-core` directly.

`@goliapkg/sentori-svelte` / `-vue` / `-solid`:

- Re-export the runtime-metrics surface from
  `@goliapkg/sentori-javascript` (matching each package's
  existing `addBreadcrumb` / `captureException` re-export
  convention).

`@goliapkg/sentori-react` / `-next`:

- Not updated in this patch — these packages don't re-export
  capture surfaces from `@goliapkg/sentori-javascript` at the
  index level (their convention is to ship providers / hooks /
  components only). Hosts using React or Next can import
  `emitMetric` directly from `@goliapkg/sentori-javascript`.

**Performance budget CI gate**

- `.github/workflows/sdk-perf.yml` runs `sdk/core` perf bench on
  every push to `master` + every PR touching `sdk/core/**`,
  `sdk/react-native/**`, `sdk/javascript/**`, or the workflow
  itself. A regression in any hot path (uuid / sampling / span /
  breadcrumb / trail / emitMetric / drain) fails the suite.
- New `sdk/core` bench entries:
  - `emitMetric (no tags) < 5 µs/op` — currently ~0.2 µs (25x margin)
  - `emitMetric (3 tags) < 10 µs/op` — currently ~0.3 µs (33x margin)
  - `drainRuntimeMetricsForFlush (300 pts) < 1000 µs` — currently ~48 µs (20x margin)

The big margins give the bench room to absorb shared-runner
variance without flaking; a real regression nudges times into
the same order of magnitude as the budget and the test fails
loudly.

**Core patch**

- `@goliapkg/sentori-core` gets a patch bump because the perf
  bench file was modified; no API change.

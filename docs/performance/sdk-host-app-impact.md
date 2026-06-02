# SDK host-app performance impact

> The Sentori SDK is an unwelcome guest in someone else's app. Every
> sample, span, walker tick, and attachment upload is overhead the
> host doesn't get paid for. The bar is **must not be detectable**.
>
> **Perf-honesty rule.** Sentori's whole pitch is "free upgrade".
> A free upgrade that's secretly slow ≠ free. So: **never write a
> perf number we haven't measured**. "Should be fast" / "structurally
> O(1)" / "additive code path" are guesses, not measurements — they
> belong in design notes, never in customer-facing perf claims.
> When the measurement gap exists, say so out loud (`"unmeasured;
> structural argument: …"`). When the rig is hard to set up, write
> the gap into the release notes and don't claim what wasn't tested.
> A faked perf number is a faster path to a dead product than no
> perf number at all.

This page captures: (a) the perf budget targets, (b) what each
hot-path is currently measured at, (c) the manual verification rig
to run before publish, (d) any **unmeasured** surface that the next
verify pass should cover.

See [`docs/performance.md`](../performance.md) for server-side and
dashboard perf baselines — different concern, same overall discipline.

## Budget targets (project rule)

| Line | Target | Source |
|---|---|---|
| Main thread CPU | < 1 % on mid-tier device | CLAUDE.md |
| Single-tick (any sampler / walker) | < 5 ms (anything ≥ 5 ms is a code red) | CLAUDE.md |
| Render frame drop (with vs. without Sentori) | diff < 1 % | CLAUDE.md |
| Replay attachment over 60 s | < 200 KB | CLAUDE.md + `replay-encoding.test.ts` |
| `captureException` total uplink in 60 s | < 500 KB | CLAUDE.md |
| Screenshot attachment | < 100 KB typical (webp/jpeg q=70, 480 px max) | `init.ts:66` |
| Heartbeat (analytics) | < 1 KB / min, < 1 ms / call | `init.ts:101` |
| Replay native walk floor | ≥ 100 ms tick period (10 Hz max) | `replay.ts:55` |

## Where each hot-path stands today (rc.10 baseline)

### Replay (`replay.ts` + native walker)

**Default capture rate:** 2 Hz. Was 4 Hz in rc.9; rolled back in
rc.10 after extrapolating thin-UI iOS sim numbers to a 200-node
Insight-class UI on Android put JS-thread occupancy past 1 %.
`replay.hz: 4` (or 8) opt-in for motion-heavy iOS apps.

**Wire format:** keyframe + delta (rc.9). Encoder unit test
(`replay-encoding.test.ts:180`) asserts < 200 KB for 60 s × 4 Hz
× 100-node dense UI with 2 nodes changing per tick — passes well
under budget.

**Per-tick cost** (measured static + extrapolated):

| Platform | UI shape | Measured | Extrapolated dense (200 nodes) |
|---|---|---|---|
| iOS sim, thin dev panel (11 nodes) | rc.10 default 2 Hz | 0.99 ms / tick | ~3 ms / tick @ 200 nodes |
| Android (Pixel 10 Pro AVD), thin | rc.10 default 2 Hz | not yet measured live | reflective Drawable colour ~2× iOS |

Android's `extractDrawableColor` uses reflective `getBackgroundColor()`
fallback (rc.7) — adds ~2× CPU vs. direct cast. Acceptable at 2 Hz;
unsafe at 4 Hz on mid-tier.

### Screenshots (`handlers/screenshot.ts`)

- Caps at 480 px max + WebP/JPEG q=70 → typical 60–100 KB.
- Quota: 10 per session in prod (`SCREENSHOT_PROD_LIMIT`), unlimited
  in dev (signal `__DEV__`).
- Yields the JS thread before capture (`handlers/screenshot.ts:38`).
- iOS uses 4-layer `keyWindow` fallback to handle dev-launcher edge
  cases (added rc.2). Android uses `ActivityThread` reflection back-fill
  for the same class of "Activity already resumed before module init"
  bugs.

### Heartbeat (analytics live-presence)

- Foreground 1/min; fires-and-forgets, no retry on failure
  (`heartbeat.ts:13`).
- Budget hard-coded into the design: < 1 KB / min, < 1 ms / call.

### Long-task + sample profiler (`long-task-monitor.ts` + `sample-profiler.ts`)

- Both use 50 ms `setInterval` ticks.
- Long-task monitor: threshold default 200 ms — only emits spans when
  the JS thread was actually busy past budget.
- Sample profiler: aggregates frame counts; emits one
  `sentori.profile` span per 60 s. Pairs with long-task monitor
  to cover "stuck JS thread" + "frame-rate distribution" together.

### Other capture (track / metrics)

- `track` (analytics events): batched with backoff, never per-event
  flush.
- `metrics`: batched with backoff. Comment in `metrics.ts:10` calls
  out the budget concern explicitly ("custom funnel events every nav
  would saturate the JS thread").

## In-code self-checks

| Check | Where | Triggers when |
|---|---|---|
| Replay byte budget | `__tests__/replay-encoding.test.ts` (unit) | 60 s × 4 Hz × 100 node sim ≥ 200 KB |
| Long-task threshold | `long-task-monitor.test.ts` | JS thread blocked > threshold |
| Sample profiler frame counts | `sample-profiler.test.ts` | Per-tick aggregation correctness |
| ANR (Android only) | native | Main thread wedged ≥ 5 s (Android system signal) |
| Pre-crash sentinel | `pre-crash-sentinel.ts` | ≥ 50 % of 60-frame window misses 32 ms budget |

These run on every preflight (`bun run preflight`) → no PR can
land that breaks the assertions.

## Manual verification rig (run before publish)

What unit tests can't catch: real CPU usage, real frame drop, real
device behaviour. Run the following on a real device or sim before
shipping anything that touches the perf-sensitive code paths.

### iOS — `sim-sentori`

```bash
xcrun simctl boot sim-sentori    # see [reference_dedicated_sim] memory
```

1. Build `apps/rn-example` against `sim-sentori`.
2. Open Xcode Instruments → Time Profiler + Core Animation FPS.
3. Record 60 s under typical interaction (scroll, navigate, tap CTAs).
4. Check:
   - **Main thread**: Sentori-rooted samples should be < 1 % of total.
   - **FPS**: 60 fps sustained; no drops > 16.7 ms.
5. Run again **without Sentori** (comment out `sentori.init`).
   Compare frame drop counts; difference should be < 1 %.
6. Use `await Sentori.probeNativeWireframe()` to read
   `lastDepthMax` / `lastSizeBytes` / `totalTicks` from JS console —
   sanity-check the walker has been firing all 60 s.

### Android — `Pixel_10_Pro` AVD (or S22 real device)

```bash
adb devices                       # confirm device connected
adb shell dumpsys gfxinfo com.goliapanda.sentori-example reset
# run app for 60 s under typical interaction
adb shell dumpsys gfxinfo com.goliapanda.sentori-example > /tmp/gfx.txt
```

1. Inspect `Janky frames:` and `99th percentile:` lines.
2. Compare against a baseline taken without Sentori — diff should be
   < 1 %.
3. Inspect `adb shell dumpsys cpuinfo com.goliapanda.sentori-example`
   — main-thread occupancy should be < 1 %.
4. S22 real-device verify is the OEM-drawable smoke test (see
   [reference_android_verify_rig] memory). Run periodically; not
   every release.

### Network — mock-ingest

`docs/runbook/v1.0-fresh-deploy.md` covers spinning up mock ingest.
For perf:

1. Replace ingest URL with a local mock that logs `POST` size and
   count to stdout.
2. Trigger 5 × `captureException(new Error(...))` in 60 s.
3. Read `tail` of mock log — sum of `Content-Length` headers should
   be < 500 KB total.

## Known limitations / open gaps

- **No CI gate on real-device perf.** The unit tests assert static
  byte budgets, but no automated CI job runs Instruments / dumpsys
  gfxinfo. Adding that requires a real device farm; out of scope for
  v1.x. Manual verify rig above is the substitute.
- **Android extrapolation only.** rc.10's rate rollback decision was
  based on a static extrapolation, not a live Android dense-UI
  measurement. Before any future bump back to 4 Hz default, repeat
  the rig on Pixel 10 Pro AVD with a 200-node mock screen.
- **iOS Hermes profiler integration** not yet auto-wired. Manual via
  Instruments. A future polish could expose Hermes profiler via the
  same native bridge so devs without Instruments can capture.

### Unmeasured v2 surface (W1–W3 additions)

Per the perf-honesty rule at the top of this doc, the following v2
APIs have a **structural** argument for cheapness but **no
measured number** yet. The verify rig needs to run against an
app exercising each surface before we can claim a budget on them.

- `safeFn` / `safeAsync` wrappers (`sdk/core/src/safe.ts`) — wrap
  every public API. Each call adds one try/catch frame + one
  function indirection. Structural: O(1), no allocation in the
  happy path. Measurement: TODO.
- `reportInternal` circuit-breaker (`sdk/core/src/self-report.ts`)
  — fires only on SDK-internal failure. Structural: bounded at 10
  calls / minute by the leaky bucket. Measurement: TODO; should
  never be hot in healthy operation.
- `captureMessage` (`sdk/javascript/src/capture.ts`,
  `sdk/react-native/src/capture.ts`) — similar shape to
  `captureException` but skips error parsing / sourcemap /
  screenshot. Structural: cheaper than captureException per call.
  Measurement: TODO.
- `setTag` / `setTags` / `mergeScopeTags` — Map writes / Object
  spread. Structural: O(n) in scope-tag count, called rarely.
  Measurement: TODO.
- `startTrace` / `withScopedSpan` (`sdk/core/src/spans.ts`) —
  same allocator as `startSpan`. Structural: identical perf
  envelope to existing `startSpan`. Measurement: existing
  span benchmarks (`perf.bench.ts`) cover the cost path.
- `recordMetric` `{ parent }` option — adds two Map sets to an
  existing call. Structural: trivial. Measurement: TODO.
- `SpanHandle.setAttribute` / `setAttributes` / `setStatus` /
  `recordException` — Map writes + one assignment. Structural:
  trivial. Measurement: TODO.
- `flush(timeoutMs?)` / `close()` (`sdk/react-native/src/lifecycle.ts`)
  — wraps existing per-buffer flushes in a `Promise.race`. Cost is
  dominated by the underlying flushes (already characterised).
  Measurement: TODO end-to-end timing of the race overhead itself.

**Before claiming these are "fast" to customers:** run the verify
rig (above) on an app exercising the new surface, in both iOS and
Android, with-vs-without comparison. Write the numbers back into
this doc. Until then, the v2.0 release notes say `"v2 surface
perf data is deferred to the next dogfood window"` — not "fast".

## Performance regressions: P0 (per CLAUDE.md)

> 性能问题报告 ("app 卡了" / "ANR" / "frame drop") = P0, 比 feature gap
> 优先. 先回滚再 debug.

If a customer reports app slowdown traced to Sentori: revert the
suspected SDK version on their app first, file the issue with the
verify-rig output above, then debug. Don't try to patch in place.

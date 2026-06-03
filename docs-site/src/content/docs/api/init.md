---
title: sentori.init()
description: The single entry point that wires Sentori into your app. Required call; everything else assumes it's already run.
---

`sentori.init(opts)` configures the SDK and (by default) attaches
global handlers for uncaught errors / promise rejections /
session lifecycle. Call it once, as early as possible — before
your app's first render.

```ts
import sentori from '@goliapkg/sentori-react-native'

sentori.init({
  token: 'st_pk_…',
  release: 'myapp@1.2.3',
})
```

If the SDK is already initialised, a second call is ignored (no
error, no replacement). Re-initialising at runtime is not
supported; spin up a new process for that.

## Required options

| Field | Type | Notes |
|---|---|---|
| `token` | `string` | Project token from the Sentori dashboard. Must start with `st_pk_`. Throwing if absent or malformed is intentional — there's no fallback. |
| `release` | `string` | Identifier like `myapp@1.2.3` or `myapp@1.2.3+456`. Drives grouping, the Releases dashboard, and source-map resolution. Required — the SDK refuses to ship without one. |

## Optional options

| Field | Type | Default | Purpose |
|---|---|---|---|
| `environment` | `string` | `'dev'` if `__DEV__`, else `'prod'` | Slice events by environment in the dashboard. |
| `ingestUrl` | `string` | `'https://ingest.sentori.golia.jp'` | Override for self-hosted Sentori. |
| `sample` | `{ errors?, traces?, messages? }` | All `null` (keep everything) | Per-event-class sampling. Each rate is `[0,1]`; `null` / omitted = keep all. `traces` is sampled deterministically over `traceId` so spans of one trace share the decision. |
| `sampling` | (same as `sample`) | — | Back-compat alias for `sample`. Both accepted; `sample` wins if both passed. |
| `capture` | `{ ... }` | See `init.capture` reference below | Toggles for individual capture sources (network, sessions, replay, …). |
| `logLevel` | `'silent' \| 'error' \| 'warn' \| 'info' \| 'debug'` | `'warn'` | Gate for the SDK's own `[sentori/...]` console output. See [`api/logger`](./logger.md). |
| `onReady` | `(info: ReadyInfo) => void` | — | Fires once after init completes. Use this instead of scanning console. See [Ready signal](#ready-signal) below. |
| `beforeSend` | `(event: Event) => Event \| null` | — | Sync host hook called per event before transport enqueue. Return `null` to drop. See [`api/before-send`](./before-send.md). |

### `init.capture` — toggle each capture source

Each toggle is independent. Defaults are picked so the host gets
**cheap, silent, audit-safe** behaviour out of the box; anything
expensive is opt-in.

| `capture.X` | Default | Behaviour |
|---|---|---|
| `globalErrors` | `true` | `window.onerror` (web) / `ErrorUtils.setGlobalHandler` (RN) → `captureException`. |
| `promiseRejections` | `true` | Unhandled rejection → `captureException`. |
| `network` | `true` (or `{ graphql: true }`) | `fetch` / `XMLHttpRequest` wrapper → `sentori.http` span + breadcrumb. `graphql: true` extracts `operationName` from POST bodies for nicer span names. |
| `sessions` | `true` | Opens a session on init + per foreground; closes on background. Drives crash-free rate. |
| `heartbeat` | `true` (1/min foreground) | Sends a ~200-byte presence ping. Powers live audience views. Set `false` to opt out. |
| `screenshot` | `false` | Capture a screenshot on every `captureException`. Each shot is ~50–200 KB; opt in deliberately. |
| `sessionTrail` | `false` | Seal the rolling step-buffer and upload as a `sessionTrail` attachment on each `captureException`. |
| `replay` | `'off'` / `'wireframe'` / `{ mode: 'wireframe', hz?: number }` | View-tree wireframe replay. Default off. Iron-rule budget: < 5 ms per 500 ms tick on a mid Android. |
| `runtimeMetrics` | `true` (RN) / `false` (JS) | Auto-instrument cold-start / FPS / heap / route-nav / network bytes. RN-only by default. |
| `longTaskMonitor` | `false` (or `{ thresholdMs }`) | JS-thread stall detector — emits a `sentori.longtask` span. |
| `sampleProfiler` | `false` (or `{ sampleMs, flushMs }`) | Idle-tick JS sample profiler. ~1–2 % JS-thread cost when enabled. |
| `preCrashSentinel` | `false` | Pre-crash window detector — emits `kind: nearCrash` proactively. |
| `launchCrashGuard` | `false` (or `{ enabled, onLaunchCrashDetected, threshold, timeoutMs }`) | OTA-update rollback escape hatch. |
| `trackAutoBreadcrumb` | `false` | When `true`, every `sentori.track()` also pushes a `breadcrumb: { type: 'track' }` so the next `captureException` carries the customer journey. |

### `init.identity` — cross-project user lookup

The identity layer is on by default — calling
`sentori.setUser({ id, linkBy: { email: ... } })` automatically
hashes each `linkBy` value client-side via SubtleCrypto and ships
only the hash. The server layers a per-scope salt before storing
fingerprints; raw values never reach Sentori.

To opt out (e.g. you don't use cross-project lookup and want
zero per-`setUser` crypto cost), pass `identity: false`. When
off, `setUser({ linkBy })` drops the `linkBy` map silently +
emits one info-level warn pointing to the documentation.

See [`privacy/identity`](../privacy/identity.md) for the data-flow
and threat model.

## Ready signal

`onReady` is the recommended way to detect "SDK is alive" — it
fires once after init has settled:

- `setConfig` is committed
- the native module bind probe has completed (success or refusal)
- transport is started
- cold-start measurement is finalised (RN)
- initial drain of pending native crashes is scheduled (it
  doesn't wait for the drain to *finish*; just to be scheduled)

The callback receives a `ReadyInfo`:

```ts
type ReadyInfo = {
  sdkVersion: string
  // RN-only: ms between cold-start signal and init completion
  coldStartMs?: number
  // RN-only: native module bind result
  native?: { bound: boolean; methods: string[] }
}
```

`native.bound = false` on RN means the host forgot to autolink
the native module — replay / screenshots / native-crash capture
won't fire, but JS-side capture still does. Surface this in your
own diagnostics if relevant.

```ts
sentori.init({
  token: 'st_pk_…',
  release: 'myapp@1.0.0',
  onReady(info) {
    if (info.native && !info.native.bound) {
      console.warn('Sentori native module not bound — autolink missing?')
    }
  },
})
```

## What `init` does NOT do

- It doesn't open a network connection eagerly. The first
  outbound HTTP is on the first captured event (or the
  60-second-later heartbeat).
- It doesn't replace global handlers when they're already wired
  by some other library. The SDK's handler chains the previous
  one through.
- It doesn't refuse to run in `__DEV__`. Dev events are sent the
  same as prod events; use `environment` to slice them in the
  dashboard.

## Related

- [`api/capture`](./capture.md) — `captureException` / `captureMessage`
- [`api/scope`](./scope.md) — `setUser` / `setTag` / `addBreadcrumb`
- [`api/tracing`](./tracing.md) — `startSpan` / `withSpan` / `startTrace`
- [`api/logger`](./logger.md) — `setLogLevel` / `setLogTransport`
- [`api/before-send`](./before-send.md) — host-side PII scrub hook
- [`privacy/identity`](../privacy/identity.md) — identity-layer audit

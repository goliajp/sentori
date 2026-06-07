# @goliapkg/sentori-javascript

## 1.3.0

### Minor Changes

- [`d8e38b2`](https://github.com/goliajp/sentori/commit/d8e38b222a4a5b1d76362514e637bc996c805cc2) Thanks [@doracawl](https://github.com/doracawl)! - v2.8 — Web Push opt-in, Service Worker subscription, server-side send for Next.js.

  Second phase of the v2.7→v2.12 Push rollout. v2.7 shipped the
  server foundation (provider trait, dispatch cron, secrets-sealed
  credentials, `/v1/push/*` routes); v2.8 lights up the **Web Push**
  branch end-to-end:

  **`@goliapkg/sentori-core` (minor) — types**

  Adds `PushMessage`, `PushOptions`, `PushPriority`, `PushTicket`,
  `PushTicketStatus`, `PushReceipt`. These mirror the
  `/v1/push/send` wire shape and are re-exported from
  `@goliapkg/sentori-javascript` + `@goliapkg/sentori-next` so the
  matrix shares one canonical contract.

  **`@goliapkg/sentori-javascript` (minor) — browser registration**

  New `sentori.push.registerWeb({ vapidPublicKey, ... })` that walks
  the standard browser opt-in path:

  1. `Notification.requestPermission()`
  2. `navigator.serviceWorker.register(serviceWorkerUrl)` (default `/sentori-sw.js`)
  3. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`
  4. POST the subscription JSON to the Sentori ingest
     `/v1/push/tokens`, getting back an `ipt_*` device handle.
  5. Cache the handle in `localStorage` + bind Service Worker
     `postMessage` events to optional `onMessage` / `onTap`
     callbacks.

  `unregisterWeb()` does the reverse — DELETE the handle + unsubscribe
  locally. Both are no-ops when the browser doesn't support the Push API.

  **Default off** — the host app calls `registerWeb` when ready.
  Sentori never triggers a permission prompt on its own. Same opt-in
  principle as `trackAutoBreadcrumb`.

  **`@goliapkg/sentori-next` (minor) — server-side send**

  New `sentoriPush({ ingestUrl, token })` factory at
  `@goliapkg/sentori-next/push`. Returns a `{ send, sendBatch,
getReceipt, isSentoriPushToken }` client that wraps `/v1/push/send`
  and `/v1/push/receipts/{id}` with the Sentori-native wire shape.
  Pure `fetch`, no Node-only imports — safe under `runtime: 'edge'`
  in App Router server actions + middleware.

  `sendBatch` concurrency-caps at 8 parallel HTTP calls to keep the
  Sentori dispatcher's queue healthy on big fan-outs.

  **Recipe**

  `docs-site` gains `recipes/push-from-nextjs.md` — end-to-end walk
  through: VAPID key pair generation, admin REST upload of the
  encrypted credentials, Service Worker template, `'use client'`
  register flow, App Router server action send, and a troubleshooting
  matrix mapping push-server status codes to operator action.

  **Compatibility**

  Wire shape is unchanged from v2.7. Customers using raw REST against
  `/v1/push/*` keep working without code changes. The Sentori-native
  wire shape `PushMessage` and the Expo-compat endpoints both stay byte-
  compatible.

### Patch Changes

- Updated dependencies [[`d8e38b2`](https://github.com/goliajp/sentori/commit/d8e38b222a4a5b1d76362514e637bc996c805cc2)]:
  - @goliapkg/sentori-core@1.3.0

## 1.3.0

### Minor Changes

- [`d8e38b2`](https://github.com/goliajp/sentori/commit/d8e38b222a4a5b1d76362514e637bc996c805cc2) Thanks [@doracawl](https://github.com/doracawl)! - v2.8 — Web Push opt-in, Service Worker subscription, server-side send for Next.js.

  Second phase of the v2.7→v2.12 Push rollout. v2.7 shipped the
  server foundation (provider trait, dispatch cron, secrets-sealed
  credentials, `/v1/push/*` routes); v2.8 lights up the **Web Push**
  branch end-to-end:

  **`@goliapkg/sentori-core` (minor) — types**

  Adds `PushMessage`, `PushOptions`, `PushPriority`, `PushTicket`,
  `PushTicketStatus`, `PushReceipt`. These mirror the
  `/v1/push/send` wire shape and are re-exported from
  `@goliapkg/sentori-javascript` + `@goliapkg/sentori-next` so the
  matrix shares one canonical contract.

  **`@goliapkg/sentori-javascript` (minor) — browser registration**

  New `sentori.push.registerWeb({ vapidPublicKey, ... })` that walks
  the standard browser opt-in path:

  1. `Notification.requestPermission()`
  2. `navigator.serviceWorker.register(serviceWorkerUrl)` (default `/sentori-sw.js`)
  3. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`
  4. POST the subscription JSON to the Sentori ingest
     `/v1/push/tokens`, getting back an `ipt_*` device handle.
  5. Cache the handle in `localStorage` + bind Service Worker
     `postMessage` events to optional `onMessage` / `onTap`
     callbacks.

  `unregisterWeb()` does the reverse — DELETE the handle + unsubscribe
  locally. Both are no-ops when the browser doesn't support the Push API.

  **Default off** — the host app calls `registerWeb` when ready.
  Sentori never triggers a permission prompt on its own. Same opt-in
  principle as `trackAutoBreadcrumb`.

  **`@goliapkg/sentori-next` (minor) — server-side send**

  New `sentoriPush({ ingestUrl, token })` factory at
  `@goliapkg/sentori-next/push`. Returns a `{ send, sendBatch,
getReceipt, isSentoriPushToken }` client that wraps `/v1/push/send`
  and `/v1/push/receipts/{id}` with the Sentori-native wire shape.
  Pure `fetch`, no Node-only imports — safe under `runtime: 'edge'`
  in App Router server actions + middleware.

  `sendBatch` concurrency-caps at 8 parallel HTTP calls to keep the
  Sentori dispatcher's queue healthy on big fan-outs.

  **Recipe**

  `docs-site` gains `recipes/push-from-nextjs.md` — end-to-end walk
  through: VAPID key pair generation, admin REST upload of the
  encrypted credentials, Service Worker template, `'use client'`
  register flow, App Router server action send, and a troubleshooting
  matrix mapping push-server status codes to operator action.

  **Compatibility**

  Wire shape is unchanged from v2.7. Customers using raw REST against
  `/v1/push/*` keep working without code changes. The Sentori-native
  wire shape `PushMessage` and the Expo-compat endpoints both stay byte-
  compatible.

### Patch Changes

- Updated dependencies [[`d8e38b2`](https://github.com/goliajp/sentori/commit/d8e38b222a4a5b1d76362514e637bc996c805cc2)]:
  - @goliapkg/sentori-core@1.3.0

## 1.3.0

### Minor Changes

- [`d8e38b2`](https://github.com/goliajp/sentori/commit/d8e38b222a4a5b1d76362514e637bc996c805cc2) Thanks [@doracawl](https://github.com/doracawl)! - v2.8 — Web Push opt-in, Service Worker subscription, server-side send for Next.js.

  Second phase of the v2.7→v2.12 Push rollout. v2.7 shipped the
  server foundation (provider trait, dispatch cron, secrets-sealed
  credentials, `/v1/push/*` routes); v2.8 lights up the **Web Push**
  branch end-to-end:

  **`@goliapkg/sentori-core` (minor) — types**

  Adds `PushMessage`, `PushOptions`, `PushPriority`, `PushTicket`,
  `PushTicketStatus`, `PushReceipt`. These mirror the
  `/v1/push/send` wire shape and are re-exported from
  `@goliapkg/sentori-javascript` + `@goliapkg/sentori-next` so the
  matrix shares one canonical contract.

  **`@goliapkg/sentori-javascript` (minor) — browser registration**

  New `sentori.push.registerWeb({ vapidPublicKey, ... })` that walks
  the standard browser opt-in path:

  1. `Notification.requestPermission()`
  2. `navigator.serviceWorker.register(serviceWorkerUrl)` (default `/sentori-sw.js`)
  3. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`
  4. POST the subscription JSON to the Sentori ingest
     `/v1/push/tokens`, getting back an `ipt_*` device handle.
  5. Cache the handle in `localStorage` + bind Service Worker
     `postMessage` events to optional `onMessage` / `onTap`
     callbacks.

  `unregisterWeb()` does the reverse — DELETE the handle + unsubscribe
  locally. Both are no-ops when the browser doesn't support the Push API.

  **Default off** — the host app calls `registerWeb` when ready.
  Sentori never triggers a permission prompt on its own. Same opt-in
  principle as `trackAutoBreadcrumb`.

  **`@goliapkg/sentori-next` (minor) — server-side send**

  New `sentoriPush({ ingestUrl, token })` factory at
  `@goliapkg/sentori-next/push`. Returns a `{ send, sendBatch,
getReceipt, isSentoriPushToken }` client that wraps `/v1/push/send`
  and `/v1/push/receipts/{id}` with the Sentori-native wire shape.
  Pure `fetch`, no Node-only imports — safe under `runtime: 'edge'`
  in App Router server actions + middleware.

  `sendBatch` concurrency-caps at 8 parallel HTTP calls to keep the
  Sentori dispatcher's queue healthy on big fan-outs.

  **Recipe**

  `docs-site` gains `recipes/push-from-nextjs.md` — end-to-end walk
  through: VAPID key pair generation, admin REST upload of the
  encrypted credentials, Service Worker template, `'use client'`
  register flow, App Router server action send, and a troubleshooting
  matrix mapping push-server status codes to operator action.

  **Compatibility**

  Wire shape is unchanged from v2.7. Customers using raw REST against
  `/v1/push/*` keep working without code changes. The Sentori-native
  wire shape `PushMessage` and the Expo-compat endpoints both stay byte-
  compatible.

### Patch Changes

- Updated dependencies [[`d8e38b2`](https://github.com/goliajp/sentori/commit/d8e38b222a4a5b1d76362514e637bc996c805cc2)]:
  - @goliapkg/sentori-core@1.3.0

## 1.2.0

### Minor Changes

- [`c26c88c`](https://github.com/goliajp/sentori/commit/c26c88c690bb9260881651e0d787c5d5b4b87bc3) Thanks [@doracawl](https://github.com/doracawl)! - v2.3 W6.0 — silent-by-default SDK logger.

  The SDK now ships a centralised logger module (`logger.error/warn/info/debug`)
  gated by a single `LogLevel` setting. Default level is `'warn'`: a normal Sentori
  install adds zero `[sentori]` lines to the host's console under healthy
  operation. Real problems (transport sustained failure, native module not bound,
  SDK-internal exception) still surface.

  New init fields:

  - `init({ logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug' })` — gates
    the host-facing console output. Default `'warn'`.
  - `init({ onReady: (info) => ... })` — fires once after init completes with a
    shared `ReadyInfo` shape (`sdkVersion`, plus RN-only `coldStartMs` + `native`).
    Use this to know the SDK is live without scanning the console.

  New host APIs (re-exported from each SDK):

  - `setLogLevel(level)` / `getLogLevel()` — change the gate at runtime.
  - `setLogTransport(fn)` — route Sentori-internal lines into the host's own
    logger (Datadog, OpenTelemetry, etc.); pass `null` to restore console.
  - `logger` namespace + `LogLevel` / `LogTransport` types for hosts that want to
    produce subsystem-prefixed lines themselves.

  JS SDK additions (RN was already wired in prior commits): `logLevel`, `onReady`,
  and the new canonical `sample` field (alongside the existing `sampling`
  back-compat alias). No behaviour change beyond log silence; existing init calls
  keep working.

  Mechanical perf bench (`sdk/core/src/__tests__/perf.bench.ts`) extended with
  logger budgets — gated-out `logger.debug` < 1 µs/op, emit through transport
  < 5 µs/op, `setLogLevel` toggle < 1 µs/op. Baseline numbers recorded at
  `docs/perf-baselines/v2.2.1.md` for Phase 3 (W6.1) to diff against.

- [`f1559cb`](https://github.com/goliajp/sentori/commit/f1559cbad697cc23e286f8f5d68f172b182d7d58) Thanks [@doracawl](https://github.com/doracawl)! - v2.3 W6.1 — `beforeSend` hook + unified `withSpan` entry point.

  Two additive surface changes per `docs/design/sdk-v2.3-redesign.md` §2:

  **`init({ beforeSend })` — host PII scrub hook**

  A sync host-supplied function called once per event just before
  transport enqueue. Return the event (possibly mutated) to ship it,
  or `null` to drop it entirely. Use for application-specific PII
  scrubbing the SDK can't do automatically.

  NEVER rule applies: a throwing hook is caught, one-shot warned, and
  the SDK falls back to the unmodified event. A non-event return
  (typo, `undefined`, etc.) gets the same treatment. Server-side
  `privacy_lab` continues running regardless of whether `beforeSend`
  is configured — `beforeSend` is the host's own defence layer in
  front of the existing server scrubber.

  ```ts
  sentori.init({
    token: "st_pk_…",
    release: "myapp@1.0.0",
    beforeSend(event) {
      if (event.tags?.flow === "kyc") return null; // never ship KYC events
      return { ...event, user: undefined }; // strip user
    },
  });
  ```

  **`withSpan` — unified entry point per design §2.3**

  `withSpan` now overloads by first-argument type:

  - `withSpan(name: string, fn)` — high-level wrap helper. Opens a
    span, runs `fn`, ends the span. Same semantics as
    `withScopedSpan(name, fn)`.
  - `withSpan(span: SpanContextLike, fn)` — low-level active-span
    manager. Pushes the span onto the active-context stack so child
    spans inherit it. Same semantics as the prior `withSpan` export
    (and the new explicit name `withActiveSpan`).

  The pre-v2.3 export name `withSpan` continues to work via the new
  overload (dispatching on first-arg type), so `withSpan(span, fn)`
  call sites are source-compatible. The explicit name
  `withActiveSpan` is exported for hosts that prefer disambiguation.
  `withScopedSpan` remains exported as the explicit name for the
  high-level path.

  Tests: new RN `applyBeforeSend` dispatcher unit tests + JS SDK
  `beforeSend` end-to-end tests via the fetch mock + core
  `withSpan(name, fn)` overload coverage (5 new tests on top of the
  v2.2 spans suite).

  `BeforeSendHook` type is exported from `@goliapkg/sentori-core` and
  re-exported by both SDKs.

### Patch Changes

- Updated dependencies [[`c26c88c`](https://github.com/goliajp/sentori/commit/c26c88c690bb9260881651e0d787c5d5b4b87bc3), [`f1559cb`](https://github.com/goliajp/sentori/commit/f1559cbad697cc23e286f8f5d68f172b182d7d58)]:
  - @goliapkg/sentori-core@1.2.0

## 1.1.0

### Minor Changes

- [`cb55b42`](https://github.com/goliajp/sentori/commit/cb55b4216dc45d2ddb58ef5fae31307685f54ebe) Thanks [@doracawl](https://github.com/doracawl)! - v2.1.1 — web matrix runtime metrics wiring + perf budget CI

  **Web SDKs now ship the runtime-metrics surface**

  `@goliapkg/sentori-javascript`:

  - New `runtime-metrics.ts` flusher mirroring the RN module —
    drains core's ring every 30 s and POSTs to
    `/v1/runtime-metrics:batch` via the same transport shape (auth
    - `Sentori-Sdk` header + `keepalive: true`). On failure,
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

### Patch Changes

- Updated dependencies [[`cb55b42`](https://github.com/goliajp/sentori/commit/cb55b4216dc45d2ddb58ef5fae31307685f54ebe)]:
  - @goliapkg/sentori-core@1.1.1

## 1.0.0

### Major Changes

- v2.0 — manual instrumentation v2 (W1–W4 closeout)

  The SDK gets its first major release since v1. Every change is
  either a rename (v1 aliases gone), a move (advanced surfaces
  behind subpath imports), or an additive new API. Wire format is
  forever back-compat with v1 — v1 SDK still reports against a
  v2 server and vice-versa. Migration is purely syntactic; estimated
  effort for a typical app is ~15 minutes. See the migration recipe
  at `docs.sentori.golia.jp/recipes/v1-to-v2-migration`.

  **Renamed (v1 aliases removed)**

  - `sentori.captureError(err)` → `sentori.captureException(err)`
  - `sentori.initSentori({ ... })` → `sentori.init({ ... })`
  - `span.finish()` → `span.end()`
  - Positional `addBreadcrumb('msg', { route })` → object-form
    `addBreadcrumb({ type, data })`
  - `Event` type → `SentoriEvent` (avoids DOM `Event` collision)
  - `SpanHandle` / `MomentHandle` types → `Span` / `Moment`

  **Moved (subpath imports — bundle hygiene)**

  - `FeedbackButton` → `import { FeedbackButton } from
'@goliapkg/sentori-react-native/feedback'` (top-level re-export
    retained for one release cycle)
  - `Sentry` compat layer → `import { Sentry } from
'@goliapkg/sentori-react-native/compat'` (already present in
    v1.x; reaffirmed here)

  **Additive — new in v2.0**

  - `sentori.captureMessage(msg, { level, tags })` — issues without
    a thrown `Error`. Lands in the Issues module with a 💬 icon
    next to thrown errors. Recipe:
    `docs.sentori.golia.jp/recipes/manual-issue`.
  - Formal `Span` / `Trace` surface — `startTrace(name)`,
    `startSpan(op, opts)`, `withSpan(span, fn)`, `withScopedSpan(op,
fn, opts)`. `Span` gains `.end()` / `.setAttribute()` /
    `.setStatus()` / `.recordException()` / `.isRecording()`,
    OTel-aligned. Recipes: `manual-trace`, `manual-span`.
  - `sentori.recordMetric(name, value, tags?, { parent: span })` —
    ties the metric point to its emitting span via `tags.span_id`,
    and the dashboard's trace detail view renders a **related
    metrics row** under that span. Recipe: `track-and-metrics`.
  - `init.capture.trackAutoBreadcrumb: true` — every
    `sentori.track(name, props)` also pushes a `{ type: 'track',
data: { name, props } }` breadcrumb, so a later
    `captureException` carries the customer journey. Defaults
    `false` to preserve v1 breadcrumb shape on upgrade; recommended
    `true` for new integrations.
  - `BreadcrumbType` union adds `'track'`; server `BreadcrumbType`
    enum adds matching `Track` variant.

  **Safety guarantee — NEVER rule**

  Every public `sentori.*` API is wrapped via `safeFn` /
  `safeAsync` (`sdk/core/src/safe.ts`); internal errors silently
  fail and optionally self-report via the circuit breaker. The host
  app never sees a thrown error, a rejected promise, a frame drop,
  a network failure, or anything else attributable to Sentori — per
  `.claude/CLAUDE.md` performance budgets (< 1 % main-thread
  sustained, < 5 ms per tick).

  **Server compatibility**

  v1 and v2 SDK requests parse cleanly against either v1 or v2
  server. Regression suites `server/tests/v1_compat.rs` (existing)
  and `server/tests/v20_compat.rs` (added with v2.1 W1) gate this.

  **Rollout**

  We dogfood the SDK on the SaaS dashboard. Recommended customer
  sequence: lockstep upgrade + run the codemod (15 min), opt into
  `trackAutoBreadcrumb`, adopt `captureMessage` / `withSpan` /
  `recordMetric({ parent })` for the cases v1 didn't fit. Mixed
  v1 / v2 fleets are supported indefinitely — there's no flag day.

### Patch Changes

- Updated dependencies []:
  - @goliapkg/sentori-core@1.0.0

## 0.6.0

### Minor Changes

- [`ff0be91`](https://github.com/goliajp/sentori/commit/ff0be919b7d5cc0a1ba84e00d6203218806c5450) Thanks [@doracawl](https://github.com/doracawl)! - v2.3 W6.2 — cross-project user lookup via client-side hashed identities

  Sentori never sees raw email / phone / OAuth sub anymore. Hosts
  can now correlate one user's events across multiple projects in
  the same org without sending PII to the server.

  ## SDK API

  ```ts
  sentori.setUser({
    id: "usr_internal_123", // unchanged
    name: "Lihao", // optional, display only
    linkBy: {
      // NEW — values hashed client-side
      email: "lihao@example.com",
      googleSub: "108293…",
      phone: "+81-90-1234-5678",
    },
  });
  ```

  The `linkBy` map accepts any (key_type → raw_value) pair. SDK
  internally:

  1. Normalises (email lowercase+trim, phone E.164-ish, etc).
  2. Hashes via `crypto.subtle.digest('SHA-256', …)` — 64-char hex.
  3. Discards raw value — never crosses the network.

  Wire format carries `user.linkHashes` (a hex-only map). Server
  validates each value matches `/^[a-f0-9]{64}$/` at ingest;
  malformed (e.g. accidental raw email) → 400 rejection.

  ## What ships in the dashboard

  A new **Users** module: operator types raw value into the search
  box → browser hashes → URL state and POST body carry hash only →
  server returns cross-project hit aggregates (events / issues /
  first-seen / last-seen per project). The raw value never persists
  in dashboard state, URL, browser history, or server logs.

  ## Privacy posture

  - Different orgs use different per-org salts → same email
    produces different stored fingerprints in different orgs.
    Cross-org correlation impossible by construction.
  - Server-side salt is loaded into memory; not present in event
    payload dumps. If both `events` and `identity_scopes` tables
    leak together, fingerprints are still unsalted-sha256 — not
    trivially reversible.
  - Hosts that don't call `setUser({ linkBy })` send no identity
    hashes; this feature has zero footprint when unused.

  ## SDK behaviour

  - `setUser` returns void synchronously (host stays single-line).
  - Hash work happens in background; commits to scope when ready.
  - If a `captureException` fires before the hash settles, the
    event ships without linkHashes for that call. Next event picks
    it up.
  - If `crypto.subtle` is unavailable (very old runtime), hash
    rejects silently and linkBy is dropped — NEVER rule, no host-
    visible failure.

  See `docs/design/sdk-v2.3-redesign.md` §5 for the full architecture.

- [`f4748cf`](https://github.com/goliajp/sentori/commit/f4748cf3f1030fb1df6fcc1f4bd5d6fd16d0aeca) Thanks [@doracawl](https://github.com/doracawl)! - v2.3 W6.0 — silent-by-default + structured ready signal

  **SDK is now silent on the host's console under normal operation.**
  Previously every SDK install produced ~6 `[sentori] …` console.warn
  lines on init + per-tick replay diagnostics + breadcrumb dumps in
  dev mode. Hosts seeing `[sentori]` in their metro now means
  Sentori has a real problem, not "Sentori is doing its job."

  ## New `init` options

  ```ts
  sentori.init({
    token: "st_pk_…",
    release: "myapp@1.2.3",

    // NEW: log gate — default 'warn', set 'silent' for total silence
    logLevel: "warn" | "silent" | "error" | "info" | "debug",

    // NEW: ready callback — replaces the console banner
    onReady: (info) => {
      // info.sdkVersion, info.coldStartMs, info.native.bound,
      // info.native.methods
    },
  });
  ```

  `onReady` fires once after init completes (setConfig + native bind
  probe + transport start all settled). Host uses this to know the
  SDK is live instead of scanning the console.

  ## New `setLogTransport`

  For hosts that want to route Sentori internal logs into their own
  log aggregator (Datadog / OpenTelemetry / Bugsnag / etc.):

  ```ts
  import { setLogTransport } from "@goliapkg/sentori-react-native";

  setLogTransport((level, tag, args) => {
    myLogger.log({ source: `sentori/${tag}`, level, args });
  });
  ```

  When set, console output is fully suppressed. Pass `null` to
  restore console output. If the transport throws, Sentori swallows
  (NEVER rule) and falls back to console for that line.

  ## Log routing changes

  | Old behaviour                                                                  | New behaviour                                           |
  | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
  | `console.warn('[sentori] native module bound; methods: …')`                    | `logger.debug('native', …)` — needs `logLevel: 'debug'` |
  | `console.warn('[sentori] replay tick: FIRST INVOCATION')`                      | `logger.debug('replay', …)`                             |
  | `console.warn('[sentori] replay: scheduled …')`                                | `logger.debug('replay', …)`                             |
  | `console.warn('[sentori] breadcrumb: …')`                                      | `logger.debug('breadcrumb', …)`                         |
  | `console.warn('[sentori] captureException eventId=…')` (dev dump)              | `logger.debug('capture', …)`                            |
  | `console.warn('[sentori] heartbeat failed')`                                   | `logger.debug('heartbeat', …)` (transient network)      |
  | `console.warn('[sentori] transport failed: …')`                                | `logger.warn('transport', …)` (default-visible)         |
  | `console.warn('[sentori] screenshot threw')`                                   | `logger.warn('native', …)`                              |
  | `console.warn('[sentori] requireNativeModule threw')`                          | `logger.error('native', …)` (real problem)              |
  | `console.warn('[sentori] internal failure in <api>: …')`                       | `logger.error('internal', …)` (default-visible)         |
  | `console.log('sentori: initialized (dev) · cold N ms')` (one-shot init banner) | **removed** — surface via `onReady`                     |

  Net effect with default `logLevel: 'warn'`:

  - ✓ Silent on success path
  - ✓ Real problems still visible
  - ✓ Host can dial up to `'debug'` when debugging Sentori itself
  - ✓ Host can dial down to `'silent'` for CI / production-quiet hosts

  ## Why now

  User feedback (2026-05-23) on a host metro session showing 6
  `[sentori]` WARN lines for normal init. The Sentori principle is
  "免费的好处" — a free bonus must not pollute the host's runtime
  surface. Console warns from normal operation broke that contract.

  Part of the [v2.3 SDK redesign](../docs/design/sdk-v2.3-redesign.md);
  identity layer + Sentry compat layer follow in W6.1+.

### Patch Changes

- Updated dependencies [[`ff0be91`](https://github.com/goliajp/sentori/commit/ff0be919b7d5cc0a1ba84e00d6203218806c5450), [`f4748cf`](https://github.com/goliajp/sentori/commit/f4748cf3f1030fb1df6fcc1f4bd5d6fd16d0aeca)]:
  - @goliapkg/sentori-core@0.10.0

## 0.5.0

### Minor Changes

- [`09c823f`](https://github.com/goliajp/sentori/commit/09c823f4bcc9216f7c14943480dff390bef7d9de) Thanks [@doracawl](https://github.com/doracawl)! - v2.0 W1 — `captureMessage` manual issue reporting.

  Adds the missing piece of the manual instrumentation story: `sentori.captureMessage(message, opts?)` lands an issue without forcing the caller to construct an `Error`. Routes to the Issues module in the dashboard, distinct from `track` (analytics) and `recordMetric` (numeric).

  ```ts
  sentori.captureMessage("Payment provider returned 500, used fallback", {
    level: "warning",
    tags: { feature: "checkout" },
  });
  ```

  What ships in W1:

  - **New top-level API**: `captureMessage(message, opts?)` on every framework SDK (RN, JS, Solid, Svelte, Vue). React / Next / Expo continue to access it via their underlying SDK.
  - **NEVER-rule foundation**: `safeFn` / `safeAsync` / `reportInternal` utilities in `@goliapkg/sentori-core`. Every public API can now be wrapped so internal failures silently fail and never propagate to the host app. `captureMessage` is the first API to land with this discipline; W2 backfills it across the rest.
  - **5-level severity**: `'fatal' | 'error' | 'warning' | 'info' | 'debug'`. Aligns with RFC 5424 / syslog; deliberately skips Sentry's redundant `'log'` level.
  - **`SamplingConfig.messages`**: per-event-class sampling rate. `null` / absent / `1.0` = keep all.
  - **`EventKind` adds `'message'`** as a union member. `Event.error` becomes optional (message-kind events carry `level` + `message` instead). TypeScript-strict exhaustive switches on `EventKind` may need a `case 'message':` added — additive change, no runtime impact on existing callers.
  - **Server**: `events.level` + `events.message` columns (nullable migration `0064_events_level_message.sql`). Server is forward-compatible with v1 SDK wire format — v1 SDK requests parse cleanly with the new fields absent. `tests/v1_compat.rs` locks the contract in.

  Self-hosted upgrade order: server first (run the new migration), then SDK. v1 SDK clients keep working against v2 server forever.

- [`cdddae4`](https://github.com/goliajp/sentori/commit/cdddae448347fe6fdb7ceeb87c9818b13a9844d0) Thanks [@doracawl](https://github.com/doracawl)! - v2.0 W2 — manual span / trace surface + scope tags (additive).

  Adds the Sentry / OTel-aligned manual instrumentation primitives. All v1.x APIs continue to work unchanged — these are net-new exports.

  **New Span methods on `SpanHandle`:**

  ```ts
  span.end({ status: "ok" }); // canonical name; `finish()` still works
  span.setAttribute("db.query", sql);
  span.setAttributes({ k1: "v1", k2: "v2" });
  span.setStatus("error", "timeout"); // stashes; applied at end()
  span.recordException(err); // attaches err shape to span.data.exception
  span.isRecording(); // true while not ended
  ```

  **New top-level functions:**

  ```ts
  sentori.startTrace('checkout-flow')           // explicit new trace root, auto-tags source=manual
  sentori.withScopedSpan('db.query', async (s) => {
    // span auto-ends with status from promise outcome
    return await db.query(...)
  })
  ```

  **Global scope tags:**

  ```ts
  sentori.setTag("rollout", "dark-mode-v2");
  sentori.setTags({ rollout: "dark-mode-v2", tier: "pro" });
  // every subsequent captureException / captureMessage merges these.
  // per-call extras.tags / opts.tags win on conflict.
  ```

  Scope tags persist across captures within a process. The `setUser(...)` API (already present) follows the same precedence rule — per-call user override > scope user.

  **What's still v1.x in this release:**

  `captureError` / `initSentori` (RN) aliases, `addBreadcrumb(type, data)` positional form, `Event` type name (vs `SentoriEvent`), and `SpanHandle.finish()` all stay first-class — no deprecation warnings yet. The clean v2 major cut (v2.0.0) removes the v1.x aliases all together; it lands in W4 alongside the docs / recipes / publish.

### Patch Changes

- Updated dependencies [[`09c823f`](https://github.com/goliajp/sentori/commit/09c823f4bcc9216f7c14943480dff390bef7d9de), [`cdddae4`](https://github.com/goliajp/sentori/commit/cdddae448347fe6fdb7ceeb87c9818b13a9844d0)]:
  - @goliapkg/sentori-core@0.9.0

## 0.4.5

### Patch Changes

- [`2e611cb`](https://github.com/goliajp/sentori/commit/2e611cbf7b3751d8a7c93e15dfef1bafa53f523c) Thanks [@doracawl](https://github.com/doracawl)! - v1.x final polish: loosen inter-package dependency ranges from exact pins to caret ranges, plus refresh `@goliapkg/sentori-expo`'s peer range on `@goliapkg/sentori-react-native`.

  Previously every SDK's `dependencies` listed sibling packages with exact pins (e.g. `"@goliapkg/sentori-core": "0.8.3"`), which forced peer-dep resolution conflicts the moment any individual package moved. The same `core` package would be requested at two different exact versions simultaneously from two sibling adapters, and npm/bun would surface a warning or pick one arbitrarily.

  These dependencies now use caret ranges (e.g. `"@goliapkg/sentori-core": "^0.8.3"`). For pre-1.0 packages caret restricts to the same minor (`>=0.8.3 <0.9.0`), so the behavioral envelope is unchanged from a SemVer standpoint while patch-level updates flow through normally.

  `@goliapkg/sentori-expo`'s peer dependency on `@goliapkg/sentori-react-native` was stuck at `">=0.2.0"` (an artefact from when RN was on 0.2.x); now updated to `">=1.0.0-rc"` to reflect the current RN line.

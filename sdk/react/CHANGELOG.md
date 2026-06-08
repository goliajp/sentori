# @goliapkg/sentori-react

## 1.1.1

### Patch Changes

- [`5f0fa5b`](https://github.com/goliajp/sentori/commit/5f0fa5b525158cf024b99fa952716b19f1e447f1) Thanks [@doracawl](https://github.com/doracawl)! - fix(sdk): never emit `console.error` from runtime paths — host apps reading red `[sentori]` lines mistake them for their own app crashing and pull Sentori out. Downgraded to `console.warn`:

  - `sentori-core`: `logger.error(...)` now routes to `console.warn` in the default console emit path. Host-supplied log transports still receive the real `error` level so they can route it to their aggregator however they like.
  - `sentori-react`: `SentoriProvider` init-failure catch block.
  - `sentori-next`: `clientInit` and `serverInit` failure catch blocks.

  The runtimeMetrics flush-failure channel that triggered the original report runs through `reportInternal → logger.error → console.error` in the host's runtime; the `sentori-core` fix closes the channel at the source for every downstream SDK.

- Updated dependencies [[`5f0fa5b`](https://github.com/goliajp/sentori/commit/5f0fa5b525158cf024b99fa952716b19f1e447f1)]:
  - @goliapkg/sentori-core@1.3.1

## 1.1.0

### Minor Changes

- [`4022db4`](https://github.com/goliajp/sentori/commit/4022db4fcff42568412158948c513851d099e0e0) Thanks [@doracawl](https://github.com/doracawl)! - v2.12 — HCM + MiPush server providers + framework push hooks + sentori-cli push commands. Closes the v2.7→v2.12 Push rollout.

  Sixth and final phase of the multi-version Push capability. v2.7
  shipped the server foundation, v2.8-v2.11 lit Web Push / RN iOS /
  RN Android / Expo plugin + dashboard. v2.12 wraps the series with
  the Chinese-market provider impls + framework wrappers + CLI.

  **Server — `hcm.rs` (Huawei HMS Push Kit)**

  - OAuth `client_credentials` token mint via
    `oauth-login.cloud.huawei.com/oauth2/v3/token`; cached per app_id
    for `expires_in - 60s`.
  - POST `push-api.cloud.huawei.com/v1/<app_id>/messages:send` with
    `Bearer <access_token>`. Message envelope packs `token: [reg_id]`,
    `notification: { title, body }`, and HMS's required-string-encoded
    `data` field. Android urgency mapped from NativeMessage priority.
  - Outcome classifier: 80000000=Sent / 80200001 + 80200003 =
    PermanentlyInvalidToken / 80300008 = MessageTooBig / 80100003 =
    Transient / 401 / 429 / 5xx all handled per HMS docs.
  - 6 unit tests cover the classifier matrix + HMS message build.

  **Server — `mipush.rs` (Xiaomi MiPush)**

  - `Authorization: key=<AppSecret>` auth (no OAuth dance — much
    simpler than HCM).
  - Form-encoded POST to `api.xmpush.xiaomi.com/v3/message/regid`
    (CN) or `.global.xmpush.xiaomi.com` (global). Body fields:
    registration_id / payload / restricted_package_name /
    pass_through / notify_type / title / description / time_to_live.
  - Outcome classifier: 200+code=0+result=ok→Sent / 22000 =
    PermanentlyInvalidToken / 22020 = Transient / 22021 = MessageTooBig
    / 401 / 429 / 5xx.
  - 5 unit tests cover the classifier matrix.

  **Framework hooks**

  - `@goliapkg/sentori-react` — `useSentoriPush({ vapidPublicKey })`
    hook returning `{ ipt, permission, error, register, unregister }`.
    Reactive over the cached ipt + Notification.permission. Hosts
    bind UI to the returned state idiomatically.
  - `@goliapkg/sentori-vue` / `@goliapkg/sentori-svelte` /
    `@goliapkg/sentori-solid` — passthrough re-exports of
    `registerWeb` / `unregisterWeb` / `readCachedIpt` / push types
    from `@goliapkg/sentori-javascript` + `@goliapkg/sentori-core`.
    Each framework's idiomatic state wrapper (composable / store /
    signal) is host-shaped enough that we ship the primitives + types
    and stop short of bundling one for everyone.

  **`@goliapkg/sentori-cli` push commands**

  Five subcommands wrapping the v2.7 admin REST + ingest endpoints:

  - `sentori push send -p <proj> --to <ipt> --title --body [--priority high|normal] [--ttl <s>] [--data @json] [--idempotency-key <s>]`
  - `sentori push receipt -p <proj> <send-id>`
  - `sentori push creds list -p <proj>`
  - `sentori push creds set <provider> -p <proj> --config @config.json --secret @secret.json`
  - `sentori push creds delete <provider> -p <proj>`

  Same admin Bearer auth as the existing `issue` subcommand;
  SENTORI_ADMIN_TOKEN env var + SENTORI_PROJECT_ID env var picked up
  automatically.

  `@file.json` shorthand for `--config` / `--data` / `--secret` reads
  the file from disk + parses as JSON. Plain JSON literals also
  accepted for one-off ad-hoc sends.

  **Series close**

  v2.7→v2.12 ships an end-to-end push capability: 5 providers (APNs

  - FCM + Web Push + HCM + MiPush) on the server side, opt-in browser
  - RN-iOS + RN-Android SDKs, Expo config plugin auto-injecting the
    host setup, dashboard credential management, and CLI for operator
    workflows. 167 server lib tests, 186 RN tests, full SDK matrix
    clean. Wire shape held stable across all six versions — customers
    who integrated against the v2.7 raw REST stay working with no
    changes through v2.12.

### Patch Changes

- Updated dependencies [[`d8e38b2`](https://github.com/goliajp/sentori/commit/d8e38b222a4a5b1d76362514e637bc996c805cc2)]:
  - @goliapkg/sentori-core@1.3.0
  - @goliapkg/sentori-javascript@1.3.0

## 1.1.0

### Minor Changes

- [`4022db4`](https://github.com/goliajp/sentori/commit/4022db4fcff42568412158948c513851d099e0e0) Thanks [@doracawl](https://github.com/doracawl)! - v2.12 — HCM + MiPush server providers + framework push hooks + sentori-cli push commands. Closes the v2.7→v2.12 Push rollout.

  Sixth and final phase of the multi-version Push capability. v2.7
  shipped the server foundation, v2.8-v2.11 lit Web Push / RN iOS /
  RN Android / Expo plugin + dashboard. v2.12 wraps the series with
  the Chinese-market provider impls + framework wrappers + CLI.

  **Server — `hcm.rs` (Huawei HMS Push Kit)**

  - OAuth `client_credentials` token mint via
    `oauth-login.cloud.huawei.com/oauth2/v3/token`; cached per app_id
    for `expires_in - 60s`.
  - POST `push-api.cloud.huawei.com/v1/<app_id>/messages:send` with
    `Bearer <access_token>`. Message envelope packs `token: [reg_id]`,
    `notification: { title, body }`, and HMS's required-string-encoded
    `data` field. Android urgency mapped from NativeMessage priority.
  - Outcome classifier: 80000000=Sent / 80200001 + 80200003 =
    PermanentlyInvalidToken / 80300008 = MessageTooBig / 80100003 =
    Transient / 401 / 429 / 5xx all handled per HMS docs.
  - 6 unit tests cover the classifier matrix + HMS message build.

  **Server — `mipush.rs` (Xiaomi MiPush)**

  - `Authorization: key=<AppSecret>` auth (no OAuth dance — much
    simpler than HCM).
  - Form-encoded POST to `api.xmpush.xiaomi.com/v3/message/regid`
    (CN) or `.global.xmpush.xiaomi.com` (global). Body fields:
    registration_id / payload / restricted_package_name /
    pass_through / notify_type / title / description / time_to_live.
  - Outcome classifier: 200+code=0+result=ok→Sent / 22000 =
    PermanentlyInvalidToken / 22020 = Transient / 22021 = MessageTooBig
    / 401 / 429 / 5xx.
  - 5 unit tests cover the classifier matrix.

  **Framework hooks**

  - `@goliapkg/sentori-react` — `useSentoriPush({ vapidPublicKey })`
    hook returning `{ ipt, permission, error, register, unregister }`.
    Reactive over the cached ipt + Notification.permission. Hosts
    bind UI to the returned state idiomatically.
  - `@goliapkg/sentori-vue` / `@goliapkg/sentori-svelte` /
    `@goliapkg/sentori-solid` — passthrough re-exports of
    `registerWeb` / `unregisterWeb` / `readCachedIpt` / push types
    from `@goliapkg/sentori-javascript` + `@goliapkg/sentori-core`.
    Each framework's idiomatic state wrapper (composable / store /
    signal) is host-shaped enough that we ship the primitives + types
    and stop short of bundling one for everyone.

  **`@goliapkg/sentori-cli` push commands**

  Five subcommands wrapping the v2.7 admin REST + ingest endpoints:

  - `sentori push send -p <proj> --to <ipt> --title --body [--priority high|normal] [--ttl <s>] [--data @json] [--idempotency-key <s>]`
  - `sentori push receipt -p <proj> <send-id>`
  - `sentori push creds list -p <proj>`
  - `sentori push creds set <provider> -p <proj> --config @config.json --secret @secret.json`
  - `sentori push creds delete <provider> -p <proj>`

  Same admin Bearer auth as the existing `issue` subcommand;
  SENTORI_ADMIN_TOKEN env var + SENTORI_PROJECT_ID env var picked up
  automatically.

  `@file.json` shorthand for `--config` / `--data` / `--secret` reads
  the file from disk + parses as JSON. Plain JSON literals also
  accepted for one-off ad-hoc sends.

  **Series close**

  v2.7→v2.12 ships an end-to-end push capability: 5 providers (APNs

  - FCM + Web Push + HCM + MiPush) on the server side, opt-in browser
  - RN-iOS + RN-Android SDKs, Expo config plugin auto-injecting the
    host setup, dashboard credential management, and CLI for operator
    workflows. 167 server lib tests, 186 RN tests, full SDK matrix
    clean. Wire shape held stable across all six versions — customers
    who integrated against the v2.7 raw REST stay working with no
    changes through v2.12.

### Patch Changes

- Updated dependencies [[`d8e38b2`](https://github.com/goliajp/sentori/commit/d8e38b222a4a5b1d76362514e637bc996c805cc2)]:
  - @goliapkg/sentori-core@1.3.0
  - @goliapkg/sentori-javascript@1.3.0

## 1.1.0

### Minor Changes

- [`4022db4`](https://github.com/goliajp/sentori/commit/4022db4fcff42568412158948c513851d099e0e0) Thanks [@doracawl](https://github.com/doracawl)! - v2.12 — HCM + MiPush server providers + framework push hooks + sentori-cli push commands. Closes the v2.7→v2.12 Push rollout.

  Sixth and final phase of the multi-version Push capability. v2.7
  shipped the server foundation, v2.8-v2.11 lit Web Push / RN iOS /
  RN Android / Expo plugin + dashboard. v2.12 wraps the series with
  the Chinese-market provider impls + framework wrappers + CLI.

  **Server — `hcm.rs` (Huawei HMS Push Kit)**

  - OAuth `client_credentials` token mint via
    `oauth-login.cloud.huawei.com/oauth2/v3/token`; cached per app_id
    for `expires_in - 60s`.
  - POST `push-api.cloud.huawei.com/v1/<app_id>/messages:send` with
    `Bearer <access_token>`. Message envelope packs `token: [reg_id]`,
    `notification: { title, body }`, and HMS's required-string-encoded
    `data` field. Android urgency mapped from NativeMessage priority.
  - Outcome classifier: 80000000=Sent / 80200001 + 80200003 =
    PermanentlyInvalidToken / 80300008 = MessageTooBig / 80100003 =
    Transient / 401 / 429 / 5xx all handled per HMS docs.
  - 6 unit tests cover the classifier matrix + HMS message build.

  **Server — `mipush.rs` (Xiaomi MiPush)**

  - `Authorization: key=<AppSecret>` auth (no OAuth dance — much
    simpler than HCM).
  - Form-encoded POST to `api.xmpush.xiaomi.com/v3/message/regid`
    (CN) or `.global.xmpush.xiaomi.com` (global). Body fields:
    registration_id / payload / restricted_package_name /
    pass_through / notify_type / title / description / time_to_live.
  - Outcome classifier: 200+code=0+result=ok→Sent / 22000 =
    PermanentlyInvalidToken / 22020 = Transient / 22021 = MessageTooBig
    / 401 / 429 / 5xx.
  - 5 unit tests cover the classifier matrix.

  **Framework hooks**

  - `@goliapkg/sentori-react` — `useSentoriPush({ vapidPublicKey })`
    hook returning `{ ipt, permission, error, register, unregister }`.
    Reactive over the cached ipt + Notification.permission. Hosts
    bind UI to the returned state idiomatically.
  - `@goliapkg/sentori-vue` / `@goliapkg/sentori-svelte` /
    `@goliapkg/sentori-solid` — passthrough re-exports of
    `registerWeb` / `unregisterWeb` / `readCachedIpt` / push types
    from `@goliapkg/sentori-javascript` + `@goliapkg/sentori-core`.
    Each framework's idiomatic state wrapper (composable / store /
    signal) is host-shaped enough that we ship the primitives + types
    and stop short of bundling one for everyone.

  **`@goliapkg/sentori-cli` push commands**

  Five subcommands wrapping the v2.7 admin REST + ingest endpoints:

  - `sentori push send -p <proj> --to <ipt> --title --body [--priority high|normal] [--ttl <s>] [--data @json] [--idempotency-key <s>]`
  - `sentori push receipt -p <proj> <send-id>`
  - `sentori push creds list -p <proj>`
  - `sentori push creds set <provider> -p <proj> --config @config.json --secret @secret.json`
  - `sentori push creds delete <provider> -p <proj>`

  Same admin Bearer auth as the existing `issue` subcommand;
  SENTORI_ADMIN_TOKEN env var + SENTORI_PROJECT_ID env var picked up
  automatically.

  `@file.json` shorthand for `--config` / `--data` / `--secret` reads
  the file from disk + parses as JSON. Plain JSON literals also
  accepted for one-off ad-hoc sends.

  **Series close**

  v2.7→v2.12 ships an end-to-end push capability: 5 providers (APNs

  - FCM + Web Push + HCM + MiPush) on the server side, opt-in browser
  - RN-iOS + RN-Android SDKs, Expo config plugin auto-injecting the
    host setup, dashboard credential management, and CLI for operator
    workflows. 167 server lib tests, 186 RN tests, full SDK matrix
    clean. Wire shape held stable across all six versions — customers
    who integrated against the v2.7 raw REST stay working with no
    changes through v2.12.

### Patch Changes

- Updated dependencies [[`d8e38b2`](https://github.com/goliajp/sentori/commit/d8e38b222a4a5b1d76362514e637bc996c805cc2)]:
  - @goliapkg/sentori-core@1.3.0
  - @goliapkg/sentori-javascript@1.3.0

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
  - @goliapkg/sentori-javascript@1.0.0

## 0.5.0

### Minor Changes

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
  - @goliapkg/sentori-javascript@0.6.0

## 0.4.10

### Patch Changes

- Updated dependencies [[`09c823f`](https://github.com/goliajp/sentori/commit/09c823f4bcc9216f7c14943480dff390bef7d9de), [`cdddae4`](https://github.com/goliajp/sentori/commit/cdddae448347fe6fdb7ceeb87c9818b13a9844d0)]:
  - @goliapkg/sentori-core@0.9.0
  - @goliapkg/sentori-javascript@0.5.0

## 0.4.9

### Patch Changes

- [`2e611cb`](https://github.com/goliajp/sentori/commit/2e611cbf7b3751d8a7c93e15dfef1bafa53f523c) Thanks [@doracawl](https://github.com/doracawl)! - v1.x final polish: loosen inter-package dependency ranges from exact pins to caret ranges, plus refresh `@goliapkg/sentori-expo`'s peer range on `@goliapkg/sentori-react-native`.

  Previously every SDK's `dependencies` listed sibling packages with exact pins (e.g. `"@goliapkg/sentori-core": "0.8.3"`), which forced peer-dep resolution conflicts the moment any individual package moved. The same `core` package would be requested at two different exact versions simultaneously from two sibling adapters, and npm/bun would surface a warning or pick one arbitrarily.

  These dependencies now use caret ranges (e.g. `"@goliapkg/sentori-core": "^0.8.3"`). For pre-1.0 packages caret restricts to the same minor (`>=0.8.3 <0.9.0`), so the behavioral envelope is unchanged from a SemVer standpoint while patch-level updates flow through normally.

  `@goliapkg/sentori-expo`'s peer dependency on `@goliapkg/sentori-react-native` was stuck at `">=0.2.0"` (an artefact from when RN was on 0.2.x); now updated to `">=1.0.0-rc"` to reflect the current RN line.

- Updated dependencies [[`2e611cb`](https://github.com/goliajp/sentori/commit/2e611cbf7b3751d8a7c93e15dfef1bafa53f523c)]:
  - @goliapkg/sentori-javascript@0.4.5

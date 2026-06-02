# @goliapkg/sentori-javascript

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

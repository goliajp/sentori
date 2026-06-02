# Manual instrumentation v2 — API spec, schema, dashboard

> Companion to `docs/roadmap/v2.0.md`. The roadmap says **what**
> and **why**; this doc says **how exactly**.
> Lives under `docs/design/` next to `analytics-v1.md` /
> `security-posture-v1.md` — design specs that pre-date their work.

Audience: maintainers picking up W1–W4 and reviewers.

---

## Design principles

These are the rails this whole work runs on. Anything proposed in a
W1–W4 PR that breaks one of these has to either re-justify it here
or drop the change.

### −1. NEVER harm the host app. (Highest priority, beats everything.)

Sentori has to be **a pure addition** to the host app's value. Any
failure inside Sentori — a malformed event, a network outage, an
unexpected null, a stack overflow in our serialiser, an OOM in the
ring buffer, a thrown Error in our async chain — **must never** be
observable to the host app's users:

- **Never propagate errors out of any public API.** Every entry
  point on `sentori.*` wraps its body in a try/catch; on internal
  failure it silently no-ops. The host's `await sentori.flush()`
  never rejects. The host's `sentori.captureException(err)` never
  throws. A bug in our queue, our base64 encoder, our reflection
  fallback, our schema serialiser — **always swallowed**.
- **Never block the JS thread observably.** Per CLAUDE.md's
  performance budgets — `< 1 %` main-thread CPU, `< 5 ms` per tick.
  See `docs/performance/sdk-host-app-impact.md`.
- **Never make a network call the host would notice failing.**
  Sentori transport is fire-and-forget with bounded retries; a 500
  from our ingest never surfaces as a thrown promise rejection or a
  thrown error in user code. If our ingest is dead, host app behaves
  exactly as if Sentori weren't installed.
- **Never cause a render-loop / re-render storm.** Any state we
  expose (`getFeatureFlags`, `getInstallId`) returns synchronously
  from a memoised cache; no React state shape we hand back triggers
  recursion.
- **Optional self-report** is allowed: if we catch an internal
  failure we *may* enqueue a diagnostic event tagged
  `kind: nearCrash` with `tags.source = 'sdk.internal'` — but
  **only via a circuit-breaker** that disables itself after N
  failures-per-minute. The host app must never see Sentori
  recursively explode by trying to self-report.

This is **NEVER class** — strictly higher priority than LLM
friendliness, API elegance, feature coverage, or anything else in
this doc. The reason Sentori exists is to be a free upgrade.
**A free upgrade that sometimes breaks your app is a net loss.**

Concretely, every public API in this design specifies its silent-fail
shape in its implementation note. Code review for v2.0 PRs explicitly
checks: "does this function's try/catch cover every path that could
throw?"

### 0. API simple, internals powerful.

Every public surface should be the smallest signature that handles
the intent. Complexity goes **behind** the API, never in front of
it. `captureException(err)` is one positional arg + one optional
options object — that's the API. Behind it: stack normalisation,
sourcemap support, breadcrumb sealing, sampling, transport, native
integration. Devs see one method; the SDK does six things.

Two corollaries:

- **No overload soup.** One fn per intent. `startSpan` returns a
  Span; `withSpan` runs a scoped callback. Don't merge them with
  an optional fn second arg.
- **Power via composition of primitives, not via flag bloat.**
  `sentori.startSpan({...}).setAttribute(...).end()` is more
  powerful than a hypothetical `sentori.recordTimedOperation({...,
  attributes, autoFinish, ... })` that tries to do everything.

### 1a. Reference Sentry, then improve on it.

LLM-friendliness is one of v2.0's primary goals, and the public
training corpus is heavy on Sentry / OpenTelemetry / Datadog — so by
default we align with what the model has already seen. *But* the
reason Sentori exists is that existing tools feel dated and
unprofessional. Sentry carries real historical cruft (DSN URL
encoding, the `Scope` abstraction, four overlapping context setters,
the transaction-vs-span split, `log` as a severity level, PII-heavy
`User` defaults). **We don't have those bags. That's our biggest
advantage.**

Where Sentry's shape is good, copy it; where it's cruft, design what
should have been there from the start. The "Where we improve on
Sentry" section enumerates every deliberate divergence.

### 1b. Server back-compat is sacred; v2 SDK is a clean redesign.

The wire protocol the server accepts is **forward-only**:

- v1 SDK requests (`POST /v1/events` / `/v1/track:batch` / `/v1/spans:batch`
  with v1 wire shape) keep working **forever**.
- v2 server adds fields (`events.level`, `events.message`, `EventKind::Message`),
  but every new field is optional and v1 SDK requests parse cleanly with
  those fields absent / NULL.
- Self-hosted customers upgrade the server first; their v1 SDK clients
  keep working unchanged.

The v2 **SDK** has no such constraint:

- The v1.x packages on npm are frozen — customers who want to stay on
  the v1.x surface just don't upgrade.
- The v2.0 packages are a fresh redesign: aliases removed, type names
  cleaned, method names aligned with industry, signatures simplified.
- A migration guide spells out the renames and codemods.

This is the right shape for both audiences: existing customers don't
have to change anything if they don't want to; new customers / the
ones who upgrade get a clean modern surface that LLMs autocomplete
correctly.

### 2. LLM-friendly via Sentry alignment when alignment improves the API.

Adding a Sentry-aligned shape isn't automatic — it has to also be
correct for Sentori. Where Sentry's shape is broken (overlapping
setters, severity-level inflation, scope/hub complexity), we deviate.

### 3. One verb per signal.

`capture*` for issues, `start*` for spans, `record*` for data points,
`add*` for buffer push, `set*` for context state, `with*` for scoped
execution. No drift in v2.

### 4. One canonical way per intent.

v2 SDK is the chance to remove dual exports + alias soup that
accumulated in v0.x → v1.x. One function name per intent, one type
name per concept.

### 5. Performance budget stays.

Per CLAUDE.md: `< 1 %` main-thread, `< 5 ms` single-tick. Manual
instrumentation must be cheap to call from a render hook.

### 6. Subpath modules for advanced surface.

Top-level stays small (≤ 15). Niche surfaces (`/feedback`, `/replay`,
`/security`, `/mask`, `/state`, `/feature-flags`) move to subpath
imports for tree-shaking + namespace clarity.

---

## Failure semantics — the NEVER rule in code

Every public API in `sentori.*` is wrapped in this pattern. Code
review for v2.0 PRs explicitly checks for it.

```ts
// sdk/core/src/safe.ts (new utility)

import { reportInternal } from './self-report.js'

/**
 * Wrap a public API body so it can never throw, never reject, never
 * propagate an error to the host app.
 *
 *   export const captureMessage = safeFn('captureMessage', (msg, opts) => {
 *     // … original body — may throw internally, doesn't matter …
 *   })
 *
 * On any thrown error, the wrapper:
 *  1. swallows the error completely
 *  2. (optionally) enqueues a self-report event, gated by the
 *     internal circuit breaker so we can't recurse
 *  3. returns undefined (sync) or a resolved Promise<void> (async)
 */
export function safeFn<TArgs extends unknown[], R>(
  name: string,
  fn: (...args: TArgs) => R,
): (...args: TArgs) => R | undefined {
  return (...args: TArgs) => {
    try {
      return fn(...args)
    } catch (err) {
      reportInternal(name, err)  // circuit-breaker'd
      return undefined
    }
  }
}

/** Async variant — never rejects. */
export function safeAsync<TArgs extends unknown[], R>(
  name: string,
  fn: (...args: TArgs) => Promise<R>,
): (...args: TArgs) => Promise<R | undefined> {
  return async (...args: TArgs) => {
    try {
      return await fn(...args)
    } catch (err) {
      reportInternal(name, err)
      return undefined
    }
  }
}
```

```ts
// sdk/core/src/self-report.ts (new)

let _failuresThisMinute = 0
let _windowStart = Date.now()
const FAILURE_BUDGET_PER_MIN = 10  // hard cap to prevent recursion storms

/**
 * Try to enqueue a `kind: nearCrash` event tagged
 * `tags.source = 'sdk.internal'` so we have observability when the
 * SDK itself breaks in customer apps. Gated by a leaky-bucket
 * circuit breaker — beyond 10 failures/min, we just go silent.
 *
 * The enqueue itself is wrapped in another try/catch — recursive
 * failure during self-report is also silent. The host app NEVER
 * sees anything.
 */
export function reportInternal(api: string, err: unknown): void {
  try {
    const now = Date.now()
    if (now - _windowStart > 60_000) {
      _failuresThisMinute = 0
      _windowStart = now
    }
    if (_failuresThisMinute >= FAILURE_BUDGET_PER_MIN) return  // circuit open
    _failuresThisMinute += 1

    // dev-mode console hint; never in prod
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.warn(`[sentori] internal failure in ${api}:`, err)
    }

    // Best-effort enqueue with NO retry on failure. If transport
    // itself is broken, we don't try harder.
    enqueueRaw({
      kind: 'nearCrash',
      tags: { source: 'sdk.internal', api },
      error: coerceErrorSafe(err),
      // … minimal payload …
    })
  } catch {
    // recursive failure during self-report — silent. The contract
    // says NEVER affect host app; even our self-observability
    // doesn't get to recurse.
  }
}
```

### What this looks like in practice

Every public API in this design uses `safeFn` / `safeAsync`. The
pseudo-code in the W1–W3 sections below shows the **business logic**
of each function — at code-review time, every PR confirms the
wrapper is in place.

```ts
// Concrete W1 example:
export const captureMessage = safeFn('captureMessage',
  (message: string, opts: CaptureMessageOptions = {}): void => {
    if (!isInitialized()) return
    if (!shouldSample(getConfig().sampling?.messages ?? 1.0)) return

    const scope = getScope()
    const event: SentoriEvent = { …build event… }
    enqueue(event)
  }
)
```

### Test coverage for the NEVER rule

Every public API gets a test of this shape:

```ts
test('captureMessage never throws on internal failure', () => {
  // Set up: force the internal builder to throw.
  __testInjectFailure('buildMessageEvent', new Error('boom'))

  expect(() => {
    sentori.captureMessage('hi', { tags: { x: '1' } })
  }).not.toThrow()
})
```

Per-API coverage required:

- `captureException`, `captureMessage`
- `startSpan`, `startTrace`, `withSpan`
- `track`, `recordMetric`, `addBreadcrumb`
- `setTag`, `setTags`, `setUser`
- `flush`, `close`
- `startMoment`
- Native bindings (`captureScreenshot`, `captureWireframe`, etc.) —
  via existing `probeNative*` diagnostics

A failing NEVER-rule test is a code-review **stop-ship**.

---

## Where we improve on Sentry

Each row is a deliberate divergence; design rationale spelled out so
maintainers know the call was considered, not accidental.

| Sentry shape | Sentry's problem | Sentori v2 |
|---|---|---|
| `Sentry.captureMessage(msg, level\|opts?)` overload | Two-arg overload (string vs object) confuses both TS inference and the LLM | `sentori.captureMessage(msg, opts?)` — single signature, `opts.level` typed |
| Severity: `'fatal' \| 'error' \| 'warning' \| 'log' \| 'info' \| 'debug'` (6 levels) | `'log'` overlaps `'info'`; nobody can tell when to use which | 5 levels: `'fatal' \| 'error' \| 'warning' \| 'info' \| 'debug'` (RFC 5424 / syslog alignment) |
| `Sentry.startSpan(opts, fn?)` overload | `fn?` makes the function "manual mode or scoped mode" depending on second arg — confusing | Two functions: `sentori.startSpan(opts)` (returns Span, manual lifecycle) + `sentori.withSpan(opts, fn)` (scoped, auto-finish) |
| `Scope`, `withScope`, `configureScope`, `Hub` | Multi-layer state model 90% of apps don't need | No scope, no hub — flat global state via `setTag` / `setUser`. Per-call options layer over the global. |
| `setTag` / `setTags` / `setContext` / `setExtra` (4 setters) | Distinctions are weak; devs always wonder which one to use | Two: `setTag(k, v)` / `setTags(record)`. `setUser` separate (PII discipline). |
| `User` defaults include `email` / `ip_address` / `username` | PII-heavy by default | `{ id, anonymous? }` only — Phase 16 sub-D rule, kept |
| Breadcrumb has both `category` (free string) and `type` (enum) | Two ways to classify; dashboard filtering ambiguous | One way: `type` enum |
| `transaction` distinct from `span` | OTel-conformant SDKs already collapsed this; Sentry SDK still carries the split | Span only. Root span = trace start. No "transaction" concept. |
| All signals share `/v1/events` endpoint | Issue triage drowns in analytics noise | Three pipelines: `/v1/events` (issues), `/v1/track:batch` (analytics), `/v1/metrics:batch` (numeric). v2.0 doesn't change this. |
| DSN URL-encoded as `https://<key>@host/<project>` | Token leaks through logs; URL changes when token rotates | Two fields: `token: 'st_pk_…'` + `ingestUrl: 'https://ingest.sentori.golia.jp'`. v1.x already does this. Kept. |

These divergences are why Sentori exists. They go in the migration
guide so v2 adopters see what's changed and why.

---

## Breaking changes (v2.0 SDK)

The v2 SDK redesign. Server stays back-compatible (v1 SDK requests
work forever); v1 SDK packages stay on npm at their last v1.x
versions; v2 SDK is opt-in by upgrading to `@goliapkg/sentori-*@2`.

Migration guide ships as `docs/recipes/v1-to-v2-migration.md` plus a
"Breaking changes" section in each v2.0 SDK's CHANGELOG.

### Type-level breaks

| # | v1.x | v2.0 | Why |
|---|---|---|---|
| B1 | `export type Event` | `export type SentoriEvent` | `Event` collides with `globalThis.Event` (DOM in web SDK, broader confusion in TS). |
| B2 | `export class SpanHandle` | `export class Span` | "Handle" is implementation noise. Sentry / OTel call it `Span`. |
| B3 | `export class MomentHandle` | `export class Moment` | Same. |

### Method-level breaks

| # | v1.x | v2.0 | Why |
|---|---|---|---|
| B4 | `span.finish({ status })` | `span.end({ status })` | Sentry / OTel parity. |
| B5 | `addBreadcrumb(type, data)` (positional) | `addBreadcrumb({ message, type?, level?, data? })` (object) | Sentry shape; richer surface; type now optional with sensible default. |
| B6 | `captureMessage` did not exist | `captureMessage(message, opts?)` (single signature, no overload) | New API; deliberately no `(message, level)` Sentry-style overload. |

### Alias removals

| # | v1.x | v2.0 | Why |
|---|---|---|---|
| B7 | `captureError` (alias of `captureException`) | only `captureException` | One canonical name. |
| B8 | RN `initSentori` (alias of `init`) | only `init` (callable as `sentori.init`) | One canonical name. |

### Span class — new methods alongside `end()`

Not breaking — additive on the new `Span` class. Listed here because
docs lead with these:

```ts
span.end(opts?)
span.setAttribute(key, value)
span.setAttributes(record)
span.setStatus(code: 'ok' | 'error', message?: string)
span.recordException(error)
span.isRecording(): boolean
```

### Sampling

Additive: `SamplingConfig.messages?: number | null` (default 1.0).

### Lifecycle

Additive: `flush(timeoutMs?)`, `close()`.

### Scope

Additive: `setTag(k, v)`, `setTags(record)`, `setUser(user)` (existing).

### Subpath imports

Top-level package re-exports the 15 canonical APIs. Advanced
surfaces move to subpaths:

```
@goliapkg/sentori-react-native              ← canonical (init, capture*, start*, set*, etc)
@goliapkg/sentori-react-native/feedback     ← FeedbackButton + sendUserFeedback
@goliapkg/sentori-react-native/replay       ← captureWireframe, replay control
@goliapkg/sentori-react-native/screenshot   ← captureScreenshot (manual)
@goliapkg/sentori-react-native/security     ← reportSecurity, queryTrustScore, reportPinMismatch
@goliapkg/sentori-react-native/mask         ← registerMaskQuery, clearMaskQuery
@goliapkg/sentori-react-native/state        ← bindState / recordState / unbindState
@goliapkg/sentori-react-native/feature-flags ← featureFlag setters
```

These were previously top-level on RN; in v2 SDK they move. Existing
top-level imports still resolve via the package's `exports` map, but
docs lead with the subpath form.

---

## W1 — `captureMessage` end-to-end

### v2 SDK API

```ts
// sdk/core/src/types.ts (v2)

/**
 * The canonical event shape sent over the wire. Renamed from `Event`
 * to avoid collision with DOM / Node `Event` globals.
 */
export type SentoriEvent = {
  id: string
  kind: EventKind
  level?: MessageLevel       // required when kind === 'message'
  message?: string           // required when kind === 'message'
  error?: SentoriError       // present for kind ∈ {'error','anr','nearCrash'}
  release: string
  environment: string
  timestamp: string
  breadcrumbs: Breadcrumb[]
  tags: Tags
  user: User | null
  data: Record<string, unknown>
  sessionId?: string
  installId?: string
  attachments?: AttachmentMeta[]
}

export type EventKind = 'anr' | 'error' | 'message' | 'nearCrash'

/**
 * 5 levels — RFC 5424 / syslog-aligned. We do NOT include Sentry's
 * `'log'` level (it overlaps `'info'` and confuses callers).
 */
export type MessageLevel = 'debug' | 'error' | 'fatal' | 'info' | 'warning'

/**
 * Second argument to `captureMessage`. Single typed shape — no
 * (message, level) overload. The level lives in `opts.level`.
 */
export type CaptureMessageOptions = {
  level?: MessageLevel       // default 'info'
  tags?: Tags
  user?: User | null
  data?: Record<string, unknown>
  // Optional: attach pre-collected breadcrumbs. If omitted, the
  // current buffer is sealed and used.
  breadcrumbs?: Breadcrumb[]
}
```

```ts
// sdk/react-native/src/capture.ts (v2)

const DEFAULT_LEVEL: MessageLevel = 'info'

/**
 * Manually report an issue without an Error instance. Routes to the
 * Issues module in the dashboard (not Audience / track).
 *
 *   sentori.captureMessage('Payment provider returned 500, used fallback')
 *   sentori.captureMessage('Detected impossible state in session reducer', {
 *     level: 'error',
 *     tags: { reducer: 'session' },
 *   })
 */
export function captureMessage(
  message: string,
  opts: CaptureMessageOptions = {},
): void {
  if (!isInitialized()) return
  if (!shouldSample(getConfig().sampling?.messages ?? 1.0)) return

  const scope = getScope()  // global tags / user from setTag / setUser
  const event: SentoriEvent = {
    id: uuidV7(),
    kind: 'message',
    level: opts.level ?? DEFAULT_LEVEL,
    message,
    release: getConfig().release,
    environment: getConfig().environment,
    timestamp: new Date().toISOString(),
    breadcrumbs: opts.breadcrumbs ?? getBreadcrumbs(),
    tags: { ...scope.tags, ...(opts.tags ?? {}) },
    user: opts.user ?? scope.user,
    data: opts.data ?? {},
    sessionId: getCurrentSession()?.id,
    installId: peekInstallId(),
  }

  enqueue(event)
}
```

### Server schema

```sql
-- migrations/0064_events_level.sql
ALTER TABLE events
  ADD COLUMN level TEXT;

ALTER TABLE events
  ADD COLUMN message TEXT;

-- Filtered index for dashboard 'kind: message' queries.
CREATE INDEX idx_events_level_kind
  ON events (project_id, kind, level)
  WHERE kind = 'message';
```

```rust
// server/src/event.rs (additions)

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EventKind {
    Error,
    Anr,
    NearCrash,
    Message,  // ← new variant
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MessageLevel {
    Fatal,
    Error,
    Warning,
    Info,
    Debug,
}

pub struct Event {
    // … existing fields …
    pub level: Option<MessageLevel>,  // ← new
    pub message: Option<String>,      // ← new
}
```

`serde` deserialisation is forward-compatible: v1 SDK requests
without `level` / `message` deserialise with those fields `None`.
Validation enforces `kind == Message ⇒ level.is_some() && message.is_some()`.

### Ingestion validation

`server/src/api/events.rs`:

- `kind == "message"` requires non-empty `message` AND a `level`.
- `kind != "message"` may have `level` (ignored) and `message`
  (stored — preserves existing stack-less-error behaviour).
- v1 SDK requests with no `level` / `message` fields validate fine
  (`kind ∈ {error, anr, nearCrash}` ⇒ both optional).
- Returns `400 ErrorCode::EVENT_MESSAGE_REQUIRED` on missing fields
  for message-kind.

### Backward compatibility tests

`server/tests/v1_compat.rs` (new):

```rust
#[test]
fn v1_sdk_request_still_accepted() {
    // The exact request shape v1.0.0-rc.1 sent — no level field,
    // no message field, kind: 'error'.
    let body = serde_json::json!({
        "id": "01HZ…",
        "kind": "error",
        "error": { "type": "Error", "message": "boom", "frames": [] },
        "release": "myapp@1.0.0",
        "environment": "prod",
        "timestamp": "2026-05-22T00:00:00Z",
        "breadcrumbs": [],
        "tags": {},
        "user": null,
        "data": {},
    });
    let parsed: Event = serde_json::from_value(body).unwrap();
    assert_eq!(parsed.kind, EventKind::Error);
    assert!(parsed.level.is_none());
    assert!(parsed.message.is_none());
}
```

Goal: server CI fails any change that breaks v1 SDK ingest.

### Issue grouping

A message event's group fingerprint:

```
hash(release || normalize(message) || sorted(tags))
```

`normalize(message)` strips ISO timestamps, UUIDs, and digit runs
≥ 4 (same normalisation already applied to error messages).
Result: `User 12345 did X` and `User 67890 did X` group together.

Stored in `issues.fingerprint` — no separate table.

### Dashboard rendering

**Issues list (`web/src/modules/issues/view.tsx`):**

- Kind icon column: existing `•` for error, `⏱` for anr, `⚠` for
  near-crash; add `💬` for message.
- Level chip on the right of the title (muted for info/debug,
  accent for warning, danger for error/fatal).
- URL filter: `?kind=` and `?level=` (per [project-v05-direction]).
- **Default URL excludes messages** — `?kind=error,anr,nearCrash`
  is the default landing query. Otherwise a high-volume info log
  would drown the error triage view.

**Issue Detail (`web/src/modules/issues/detail-view.tsx`):**

When `kind === 'message'`:

```
┌─ Issue header ────────────────────────────────────────┐
│ <message body, larger type>                           │
│ <level chip>  <fingerprint>  <first / last seen>      │
├─ Tags ───────────────────────────────────────────────┤
├─ User / device / release ────────────────────────────┤
├─ Breadcrumbs ────────────────────────────────────────┤
├─ Attachments (if any) ───────────────────────────────┤
└───────────────────────────────────────────────────────┘
```

No stack tab. No "view source." No "Open in IDE." If a message
event somehow carries a stack, render it collapsed.

---

## W2 — Manual span / trace surface

### v2 Span class

```ts
// sdk/core/src/spans.ts (v2)

export class Span {
  end(opts?: { status?: SpanStatus; error?: SentoriError }): void { … }
  setAttribute(key: string, value: AttributeValue): void { … }
  setAttributes(record: Record<string, AttributeValue>): void { … }
  setStatus(code: 'ok' | 'error', message?: string): void { … }
  recordException(err: Error): void { … }    // adds a span event of type 'exception'
  isRecording(): boolean { … }                // true while not yet ended
}
```

No `finish()` method on `Span`. v1.x customers stay on `SpanHandle`
in the v1.x SDK; v2 customers use `Span.end()`.

### `startSpan` + `withSpan` (two distinct fns, no overload)

```ts
// sdk/core/src/spans.ts (v2)

/**
 * Open a span; caller is responsible for calling `.end()`.
 *
 *   const span = sentori.startSpan({ name: 'db.query users' })
 *   try {
 *     await db.query(…)
 *     span.end({ status: 'ok' })
 *   } catch (err) {
 *     span.recordException(err)
 *     span.end({ status: 'error' })
 *     throw err
 *   }
 *
 * Inherits trace/parent from `activeSpan()` if `opts.parent` is not
 * supplied. If neither active span nor explicit parent, opens a new
 * trace (root).
 */
export function startSpan(opts: StartSpanOptions): Span { … }

/**
 * Scoped span: opens, runs the callback, ends automatically.
 *
 *   const result = await sentori.withSpan({ name: 'db.query users' }, async () => {
 *     return await db.query(…)
 *   })
 *
 * - sync fn: span ends after fn returns; status 'ok' if no throw,
 *   'error' if throws (exception recorded).
 * - async fn: span ends on promise resolution; same status mapping.
 *
 * This is the function devs reach for 80 % of the time. `startSpan`
 * is the manual escape hatch for cases where the span outlives a
 * single function call.
 */
export function withSpan<T>(
  opts: StartSpanOptions,
  fn: (span: Span) => T,
): T extends Promise<infer R> ? Promise<R> : T { … }

/**
 * Explicitly start a NEW trace. Equivalent to:
 *   startSpan({ parent: null, name, ...opts })
 * with the root span auto-tagged `source: 'manual'` for dashboard
 * filtering.
 *
 * Use when the entry point of a workflow isn't covered by
 * auto-instrumentation (CLI command, worker tick, background task
 * deliberately detached from the current trace).
 */
export function startTrace(
  name: string,
  opts?: Omit<StartSpanOptions, 'parent' | 'name'>,
): Span { … }
```

### SamplingConfig

```ts
export type SamplingConfig = {
  errors?: null | number
  traces?: null | number
  messages?: null | number   // ← new; default 1.0
}
```

- `captureMessage` honours `sampling.messages`.
- `startSpan` / `withSpan` honour `sampling.traces` when they would
  create a new root.
- `startTrace` **always keeps** (manual root = explicit intent;
  sampling is for auto-instrumented noise reduction). Document the
  asymmetry.

---

## W3 — Track / metrics / breadcrumb cohesion

### Breadcrumb signature (v2 — single shape)

```ts
// sdk/core/src/breadcrumbs.ts (v2)

export type AddBreadcrumbInput = {
  message: string
  type?: BreadcrumbType   // 'user' | 'navigation' | 'http' | 'log' | 'track' | …
  level?: MessageLevel    // default 'info'
  data?: Record<string, unknown>
}

export function addBreadcrumb(input: AddBreadcrumbInput): void {
  _buf.push({
    timestamp: new Date().toISOString(),
    type: input.type ?? 'log',
    level: input.level ?? 'info',
    message: input.message,
    data: input.data ?? {},
  })
  while (_buf.length > _cap) _buf.shift()
}
```

No positional `addBreadcrumb(type, data)` form in v2.

### Track auto-breadcrumb

```ts
// sdk/react-native/src/track.ts (addition)

export function track(name: string, opts?: { props?: TrackProps }): void {
  // … existing validation + buffer push …

  if (getConfig().capture?.trackAutoBreadcrumb) {
    addBreadcrumb({
      message: name,
      type: 'track',
      data: opts?.props ? pickFirstN(opts.props, 3) : undefined,
    })
  }
}
```

`CommonInitOptions.capture` gains `trackAutoBreadcrumb?: boolean`
(default `false`). Docs lead with the opt-in flag enabled — it's
the recommended shape.

### `recordMetric` parent

```ts
// sdk/react-native/src/metrics.ts (v2)

export function recordMetric(
  name: string,
  value: number,
  opts?: {
    tags?: Record<string, string>
    parent?: SpanContext       // ties the metric to a span
  },
): void {
  // … existing validation …

  const finalTags: Record<string, string> = { ...(opts?.tags ?? {}) }
  if (opts?.parent) {
    finalTags.span_id = opts.parent.spanId
    finalTags.trace_id = opts.parent.traceId
  }

  _buf.push({ name, value, tags: finalTags, ts: new Date().toISOString() })
}
```

Dashboard span detail joins metric points by `tags.span_id`. Visible
as a "related metrics" row.

### `setTag` / `setTags` / `setUser`

```ts
// sdk/core/src/scope.ts (new)

let _tags: Tags = {}
let _user: User | null = null

export function setTag(key: string, value: string): void {
  _tags[key] = String(value)
}

export function setTags(record: Tags): void {
  for (const [k, v] of Object.entries(record)) _tags[k] = String(v)
}

export function setUser(user: User | null): void {
  _user = user
}

export function getScope(): { tags: Tags; user: User | null } {
  return { tags: { ..._tags }, user: _user }
}
```

Every `capture*` sources base tags + user from `getScope()` and
merges per-call options on top.

### `flush` / `close`

```ts
// sdk/react-native/src/lifecycle.ts (new)

/**
 * Force-flush every pending buffer (events, breadcrumbs, track,
 * metrics, replay). Returns when the flush completes or the timeout
 * fires. Use before short-lived process exit (CLI, Lambda, fixture).
 */
export async function flush(timeoutMs: number = 5_000): Promise<void> { … }

/**
 * Flush + shut down. After `close()`, further capture* calls are
 * silent no-ops. Idempotent.
 */
export async function close(timeoutMs?: number): Promise<void> { … }
```

---

## W4 — Recipes (table of contents)

Each recipe follows the template in `docs/runbook/release-sdks.md`:
motivation → code sample → expected dashboard view → links.

1. **`manual-issue.md`** — `captureMessage` vs `captureException`.
   Level choice. Tags strategy.
2. **`manual-trace.md`** — `startTrace` for self-contained workflows
   (CLI commands, background ticks).
3. **`manual-span.md`** — child spans + `withSpan` auto-finish.
4. **`manual-moment.md`** — `startMoment` for funnel /
   abandonment instrumentation. Checkpoint pattern.
5. **`track-and-metrics.md`** — when track vs when metric. The
   `trackAutoBreadcrumb` opt-in. The `recordMetric` `parent` link.
6. **`manual-breadcrumb.md`** — when to drop a breadcrumb directly
   vs let `track` emit one.
7. **`v1-to-v2-migration.md`** — every B1–B8 break with before /
   after snippet. Sed lines that catch 95 % of call-sites.

Plus a **landing page** (`/manual-instrumentation`) orienting the
reader on the **layering**:

```
moment      ← business funnel ("checkout flow")
trace       ← cross-component workflow root
span        ← unit of work inside a trace
breadcrumb  ← context line attached to next event
track       ← analytics event (own pipeline)
metric      ← numeric observation (own pipeline)
message     ← manual issue report
exception   ← caught Error → manual issue report
```

with one-paragraph "use X when …" guides.

### `apps/rn-example` Manual tab

```
Manual instrumentation
├─ [ Manual message ]   → captureMessage('Demo info')
├─ [ Manual error ]     → captureMessage('Demo error', { level: 'error' })
├─ [ Open trace ]       → startTrace('manual-flow')
├─ [ Span with auto-finish ] → withSpan({ name: 'demo' }, async () => { … })
├─ [ Track event ]      → track('demo.tap', { props: { source: 'manual-tab' }})
├─ [ Record metric ]    → recordMetric('demo.value', Math.random())
├─ [ Start moment ]     → startMoment('demo-moment', {...}).end()
├─ [ Set tag + user ]   → setTag('demo','manual'); setUser({ id: 'demo' })
├─ [ Flush + close ]    → await flush(); await close()
```

Each button updates an on-screen log with "what was emitted".

---

## Open questions — answered

1. **`level: 'fatal'` semantics.** Fatal-message routes to Issues
   alongside errors; no separate dashboard handling. Just a darker
   level chip.
2. **Message-event attachments.** Yes, fully supported — same
   `Event.attachments` field, same upload pipeline.
3. **Native captureMessage (iOS Swift, Android Kotlin).** Out of
   scope for v2.0 (JS-only). v2.1 candidate — expose
   `Sentori.captureMessage` on the native binding.
4. **Trace sampling vs explicit `startTrace`.** Manual traces
   always keep (no sampling). Documented in W2.
5. **PII scrubbing of message body.** Server-side scrubber runs the
   same regex set on `event.message` as it does on
   `event.error.message`. Callers don't need to pre-scrub.

---

## Non-goals (worth restating)

- OTLP / OpenTelemetry export. Future L2 (v2.1 candidate).
- Native iOS/Android `captureMessage` bindings. v2.1 candidate.
- Hooks into platform native logging (`os_log` / `Log.d`). Out.
- Customer-visible event filtering DSL on the dashboard. Out.
- Renaming `track` to `captureEvent`. Rejected — established verb,
  churn cost too high.
- Removing `track` entirely. Rejected — analytics signals belong on
  a dedicated pipeline; mixing into Issues is the design failure
  Sentory is showing.

---

## Acceptance tests for v2.0 close

The trigger gate v0.4 → closed (per `docs/roadmap/v2.0.md` L4):

```bash
# Test 1 — manual issue, message kind
curl -X POST $INGEST/v1/events \
  -H "x-sentori-token: $TOKEN" \
  -d '{"kind":"message","level":"warning","message":"acceptance test","release":"v2.0","environment":"test"}'

# Expected: 200; dashboard Issues list shows a 💬 row with level=warning

# Test 2 — server back-compat: v1 SDK shape still accepted
curl -X POST $INGEST/v1/events \
  -H "x-sentori-token: $TOKEN" \
  -d '{"kind":"error","error":{"type":"Error","message":"v1-shape","frames":[]},"release":"v2.0","environment":"test","breadcrumbs":[],"tags":{},"user":null,"data":{}}'

# Expected: 200; event lands as kind=error with level=NULL message=NULL

# Test 3 — v2 manual trace + scoped span
node -e "
const { sentori } = require('@goliapkg/sentori-javascript')
sentori.init({ token: '$TOKEN', release: 'v2.0', environment: 'test' })
await sentori.withSpan({ name: 'acceptance-root', parent: null }, async () => {
  await sentori.withSpan({ name: 'acceptance-child' }, () => {})
})
"

# Expected: dashboard Traces shows a 2-span trace with source=manual

# Test 4 — track + auto-breadcrumb
node -e "
const { sentori } = require('@goliapkg/sentori-javascript')
sentori.init({ token: '$TOKEN', release: 'v2.0', environment: 'test',
              capture: { trackAutoBreadcrumb: true } })
sentori.track('acceptance.tap', { props: { id: 1 } })
sentori.captureException(new Error('after track'))
"

# Expected: error event has a breadcrumb { type: 'track', message: 'acceptance.tap' }

# Test 5 — metric with parent span
node -e "
const { sentori } = require('@goliapkg/sentori-javascript')
sentori.init({ token: '$TOKEN', release: 'v2.0', environment: 'test' })
const s = sentori.startSpan({ name: 'acceptance-parent', parent: null })
sentori.recordMetric('acceptance.value', 42, { parent: s })
s.end({ status: 'ok' })
await sentori.flush()
"

# Expected: dashboard span detail shows 'related metrics' row with
#          acceptance.value=42

# Test 6 — context setters merge with capture
node -e "
const { sentori } = require('@goliapkg/sentori-javascript')
sentori.init({ token: '$TOKEN', release: 'v2.0', environment: 'test' })
sentori.setTag('rollout', 'dark-mode-v2')
sentori.setUser({ id: 'u_demo' })
sentori.captureMessage('feature toggled')
"

# Expected: the captureMessage event arrives with tags.rollout='dark-mode-v2'
#          and user.id='u_demo' merged from the scope.
```

All six green = v2.0 closes.

# Sentori SDK v2.3 — Design Spec

**Status**: design, awaiting sign-off.
**Author**: Claude + Lihao discussion, 2026-05-22 → 2026-05-23.
**Successor to**: ad-hoc evolution from v1.0 → v2.2.
**Replaces**: ?
**Implementation phases**: W6.0–W6.4 below.

---

## 0 — Why this doc exists

The SDK API has grown organically from v0.1 to v2.2. Each addition was
locally sensible; together they accumulated three classes of debt:

1. **Console noise.** `console.warn('[sentori] replay tick: FIRST INVOCATION')`
   and ~20 similar lines fire in normal operation. Host's metro reads
   like Sentori is broken when it isn't.

2. **Config-shape junk drawer.** `init({ capture: { … } })` collects every
   feature toggle that's been added since Phase 1. No grouping by
   "default-on (cheap)" vs "opt-in (expensive)". Sampling lives in three
   independent top-level fields. Discovery is by reading the type, not by
   reading the doc.

3. **Implicit Sentry-shape inheritance.** Some method names + shapes
   match Sentry verbatim (`captureException`, `addBreadcrumb`), some
   diverge (`startTrace` vs Sentry's `startTransaction`), and we
   inherited Sentry's `severity.log` level that we then quietly dropped
   in v2.0. No clear stance.

This redesign articulates a **deliberate stance** on all three, lays
out the v2.3 API surface, and prescribes a Sentry-compat layer for
migration.

It is the source of truth for SDK semantics. Code disagrees with this
doc → fix the code, then update the doc.

---

## 1 — Design tenets

These five constrain every API decision. When two tenets pull
opposite ways, the one earlier in the list wins.

### T1 — Sentori is the host's "free bonus"

The host integrates Sentori expecting **only additive value**. Sentori
must never:

- Force the host to think about Sentori at runtime (no console noise,
  no required upgrade path for minor releases, no unexpected
  side-effects on host state).
- Burden the host with privacy / compliance obligations Sentori
  itself can absorb (PII handling, hashing, scope boundaries).
- Introduce performance regressions on the host's hot paths (main
  thread budget < 1% on a mid-range device; per-tick spans < 5 ms).

Concretely: **default behaviour is silent + cheap + audit-safe**.
Anything beyond that is opt-in.

### T2 — NEVER rule (load-bearing)

Sentori SDK failures must **never** propagate to host code. This was
declared in v2.0 design and stands here. Implementation: `safeFn` /
`safeAsync` wrappers + circuit-breaker'd self-report. No new public
API is added without going through these.

### T3 — AI + human friendly

The API is consumed by both human developers and LLM agents reading
type definitions to generate calls. This implies:

- **Discoverable**: every option lives at one predictable path.
  `init({ sample: { traces } })`, not `init({ traceSampleRate })`.
- **Predictable shapes**: same option name means same thing across
  methods. `level: MessageLevel`, never `severity` in one place and
  `level` in another.
- **Self-documenting**: type names communicate intent. Prefer
  `'silent' | 'error' | 'warn' | 'info' | 'debug'` over `0 | 1 | 2`.
- **Minimum required knowledge**: `sentori.init({ token, release })`
  with all other defaults sane.
- **Single entry surface**: one package, one default export plus
  named exports. No "import from sub-path X" for common operations.

### T4 — Don't blindly copy Sentry

Sentori's native API is **our design**. Where Sentry's choice is good
(e.g. `captureException(err)` universal name), keep it. Where Sentry
shows historical scar tissue (Hub / Scope / Client public API; three
ways to start a span; `severity.log`), redesign.

But provide a **drop-in Sentry compat layer** at `…/sentry-compat`
that mirrors `@sentry/react-native` exactly, internally translating
to Sentori native. This means: any code an LLM has been trained on
that uses `Sentry.captureException(err)` works against Sentori.
Translation differences fire one-shot dev hints.

### T5 — Privacy is structural, not policy

PII never reaches the server in raw form, period. Hash on device.
Salt on server. No "we promise to delete after N days" handwaves —
the data physically cannot be recovered. See §5 for the identity
architecture.

---

## 2 — Native API

The Sentori-native API. Designed from scratch under T1–T5.

### 2.1 init

```ts
type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug'
type MessageLevel = 'fatal' | 'error' | 'warning' | 'info' | 'debug'

type ReadyInfo = {
  sdkVersion: string
  coldStartMs?: number
  native: { bound: boolean; methods: string[] }
}

type InitOptions = {
  // Required.
  token: string                    // 'st_pk_…'
  release: string                  // 'myapp@1.2.3' or '@1.2.3+456'

  // Environment.
  environment?: string             // default __DEV__ ? 'dev' : 'prod'
  ingestUrl?: string               // default 'https://ingest.sentori.golia.jp'

  // Sampling. All 0..1, all default 1 (keep everything).
  sample?: {
    errors?: number
    traces?: number
    messages?: number
  }

  // Capture toggles. Each shows its default below.
  // Cheap → default true.  Expensive → default false.
  capture?: {
    globalErrors?: boolean          // true
    promiseRejections?: boolean     // true
    network?: boolean | { graphql?: boolean }  // true
    sessions?: boolean              // true
    heartbeat?: boolean | { intervalMs?: number }  // true (1/min)

    replay?: false | 'wireframe' | { mode: 'wireframe'; hz?: number }
                                    // false
    screenshots?: boolean           // false
    sessionTrail?: boolean          // false
    longTaskMonitor?: boolean | { thresholdMs?: number }  // false
    sampleProfiler?: boolean | { sampleMs?: number; flushMs?: number }
                                    // false
    preCrashSentinel?: boolean | { channels?: string[] }  // false
    launchCrashGuard?: boolean | { rollback?: () => void }  // false
  }

  // Identity (v2.3 new). See §5.
  identity?: boolean                // default true

  // Diagnostics.
  logLevel?: LogLevel               // default 'warn'
  onReady?: (info: ReadyInfo) => void
}

declare function init(opts: InitOptions): void  // sync; ready signal via onReady
```

#### Defaults rationale

| Field | Default | Rationale |
|---|---|---|
| `environment` | `__DEV__ ? 'dev' : 'prod'` | Match the runtime expectation. |
| `sample.errors` | `1` | Errors are rare and high-value. Always send. |
| `sample.traces` | `0.1` | Traces volume can be huge; 10% gives signal without flood. |
| `sample.messages` | `1` | Manual messages are intentional, low volume. Always send. |
| `capture.globalErrors` | `true` | Cheap; the whole point of the SDK. |
| `capture.network` | `true` | Cheap (fetch wrapper); enables HTTP spans + breadcrumbs. |
| `capture.sessions` | `true` | Cheap (AppState listener); needed for crash-free rate. |
| `capture.heartbeat` | `true` | One ~200-byte request per minute foreground. Cheap. |
| `capture.replay` | `false` | Per-tick view-tree scan; opt-in. |
| `capture.screenshots` | `false` | Each shot ~50–200 KB upload. Opt-in. |
| `capture.sampleProfiler` | `false` | ~1–2% JS thread; opt-in. |
| `identity` | `true` | Default lookup works; users have a non-broken view. |
| `logLevel` | `'warn'` | Silent under normal operation. Real problems still surface. |

If the host doesn't pass anything beyond `token` + `release`, what
they get is **cheap and silent**: error capture + network spans +
session lifecycle + heartbeat presence. That is the "free bonus."

#### onReady contract

Fires once, after:
- `setConfig` is committed
- native module bind probe completed (success or refusal)
- transport is started
- cold-start measurement finalised
- initial drain of pending native crashes scheduled

It does **not** wait for those drains to complete; host gets the
ready signal so they can stop spinning a splash etc.

`ReadyInfo.native.bound = false` means the host forgot autolink /
the host is web — replay / screenshots / native ANR won't work but
JS-side capture still does. Useful for the host to surface.

### 2.2 Functional API

Top-level functions, named exports + default-export namespace:

```ts
// Capture
function captureException(err: unknown, opts?: CaptureExceptionOpts): void
function captureMessage(message: string, opts?: CaptureMessageOpts): void

// Scope (no Hub / Scope class exposed; just module functions)
function setUser(user: User | null): void
function setTag(key: string, value: string): void
function setTags(record: Record<string, string>): void
function clearTags(): void
function addBreadcrumb(crumb: BreadcrumbInput): void

// Tracing
function startSpan(opts: StartSpanOpts): Span
function withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>): T | Promise<T>
function startTrace(name: string, opts?: { tags?: Record<string, string> }): Span
function startMoment(name: string, props?: Record<string, unknown>): Moment

// Metrics + analytics
function recordMetric(
  name: string,
  value: number,
  opts?: { tags?: Record<string, string>; parent?: SpanContextLike }
): void
function track(name: string, opts?: { props?: Record<string, unknown> }): void

// Lifecycle
function flush(timeoutMs?: number): Promise<void>
function close(): Promise<void>
```

Argument shapes:

```ts
type CaptureExceptionOpts = {
  tags?: Record<string, string>
  level?: MessageLevel              // default 'error'
  fingerprint?: string[]            // override grouping
}

type CaptureMessageOpts = {
  level?: MessageLevel              // default 'info'
  tags?: Record<string, string>
}

type User = {
  id?: string                       // raw, opaque to Sentori
  name?: string                     // raw, display only
  anonymous?: boolean
  linkBy?: Record<string, string>   // hashed client-side, see §5
}

type BreadcrumbInput = {
  message: string
  type?: 'user' | 'navigation' | 'http' | 'log' | 'track' | 'custom'
  level?: MessageLevel
  data?: Record<string, unknown>
}

type StartSpanOpts = {
  name: string
  parent?: Span | null              // null = new root; undefined = inherit active
  tags?: Record<string, string>
  startNowMs?: number               // override start timestamp
}
```

Span interface (chainable, LLM-friendly):

```ts
interface Span {
  // mutation
  setAttribute(key: string, value: AttributeValue): Span
  setAttributes(record: Record<string, AttributeValue>): Span
  setStatus(code: 'ok' | 'error', message?: string): Span
  recordException(err: unknown): Span

  // lifecycle
  end(opts?: { status?: 'ok' | 'error'; endNowMs?: number }): void
  isRecording(): boolean

  // identity (read-only)
  readonly spanId: string
  readonly traceId: string
}

type AttributeValue = string | number | boolean | null
```

Moment interface (Sentori-specific, kept):

```ts
interface Moment {
  checkpoint(label: string): Moment
  fail(reason?: string): void
  abandon(reason?: string): void
  end(): void
  readonly status: 'open' | 'completed' | 'abandoned' | 'failed'
  readonly span: Span
}
```

### 2.3 Why this shape (not Sentry's)

| Decision | Sentry's choice | Sentori's choice | Reason |
|---|---|---|---|
| Span entrypoints | `startSpan` + `startTransaction` + `startInactiveSpan` | `startSpan` + `withSpan` | One mechanism. `withSpan` is the wrap helper. Three was historical. |
| Scope mutation | `withScope(s => { s.setTag(...); … })` | `setTag(k, v)` + `addBreadcrumb({...})` direct | Hub/Scope class is Sentry-internal abstraction leaked to public API. We hide it. |
| Message level | `Severity.Log/Debug/Info/Warning/Error/Fatal/Critical` | `'fatal'|'error'|'warning'|'info'|'debug'` (5) | Sentry has 7 with `Log` and `Critical` redundant. We chose syslog-5. |
| `captureException` opts | nested `{ contexts, extra, tags, level, fingerprint }` | `{ tags, level, fingerprint }` flat | `contexts` and `extra` are Sentry-internal partitions. We expose only `tags`. |
| Breadcrumb category | `category` + `type` (two fields, overlapping) | only `type` | One axis is enough. Type already discriminates source. |
| Span "active parent" | implicit via Hub | `parent: Span ⏐ null ⏐ undefined` explicit | Hub is invisible; explicit parent is clearer. `undefined` = inherit active. |
| Async-context | OpenTelemetry-style via `setupHooks` | implicit AsyncLocalStorage on Node, sync chain on RN | Right answer per platform; user doesn't configure it. |

---

## 3 — Logger + log level

Defined in `sdk/core/src/logger.ts`. Same module shared by all SDKs.

```ts
const ORDER = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 }

const logger = {
  error(tag, ...args): void   // ORDER >= 1
  warn(tag, ...args): void    // ORDER >= 2
  info(tag, ...args): void    // ORDER >= 3
  debug(tag, ...args): void   // ORDER >= 4
}
```

`tag` is a subsystem prefix: `'native'`, `'replay'`, `'transport'`,
`'init'`, …  Final line format:

    [sentori/replay] tick threw: TypeError: …

### Routing rule

| Used today (mostly `console.warn`) | New level |
|---|---|
| `'native module bound; exposed methods: …'` | `debug` |
| `'replay: starting bound=true hasCaptureWireframe=true'` | `debug` |
| `'replay: scheduled tick period=500 ms keyframe=4000 ms'` | `debug` |
| `'replay tick: FIRST INVOCATION'` | `debug` |
| `'replay tick: first ok — nodes=19 sizeBytes=1674'` | `debug` |
| `'breadcrumb: …'` | `debug` |
| `'heartbeat failed (best-effort)'` | `warn` |
| `'screenshot capture threw'` | `warn` |
| `'replay tick: threw'` | `warn` |
| `'transport failed: …'` | `warn` |
| `'native screenshot threw'` | `warn` |
| `'sentori: initialized (dev) · cold N ms'` | **removed**. Surface via `onReady` instead. |
| `'requireNativeModule("Sentori") threw'` | `error` |
| internal `reportInternal()` dev hints | `error` |

After this routing, `logLevel: 'warn'` (default) gives:

- Zero noise when nothing is wrong
- Real problems still surface

`logLevel: 'silent'` for CI smoke runs / hosts that absolutely never
want Sentori in console.

### Production override

`logLevel` can be overridden at any time via:

```ts
import { setLogLevel } from '@goliapkg/sentori-react-native'
setLogLevel('debug')   // host devs debugging Sentori live
```

---

## 4 — Sentry compat layer

Sub-module: `@goliapkg/sentori-react-native/sentry-compat`.

```ts
import * as Sentry from '@goliapkg/sentori-react-native/sentry-compat'
```

Sentory native and sentry-compat **share state** (same scope, same
transport, same identity layer). They're just two API surfaces over
the same internals.

### 4.1 DSN parsing

```ts
Sentry.init({ dsn: 'https://<key>@<host>/<projectId>', ...sentryOpts })
```

`dsn` is parsed:
- `<key>` → `token` if it matches `st_pk_…`; else refuses with a
  clear error
- `<host>` → `ingestUrl` (e.g. `ingest.sentori.golia.jp`)
- `<projectId>` segment of Sentry DSN — Sentori uses `token` to scope
  to project, so ignored. Hint logged.

Other Sentry init opts:
- `environment` → Sentori `environment`
- `release` → Sentori `release`
- `tracesSampleRate` → Sentori `sample.traces`
- `sampleRate` → Sentori `sample.errors`
- `attachStacktrace`, `autoSessionTracking`, etc. → mapped or ignored
  with hint

### 4.2 Translation table

For each Sentry call, exactly one Sentori-native call. Same wire
result. If a Sentry parameter has no Sentori equivalent (e.g. `ip_address`
in `setUser`), we **drop it silently in prod, hint at `info` level**
in dev.

| Sentry call | Sentori native call | Translation |
|---|---|---|
| `Sentry.captureException(err)` | `sentori.captureException(err)` | identity |
| `Sentry.captureException(err, hint)` | `sentori.captureException(err, mapHint(hint))` | extract `tags`, `level`, `fingerprint` from `hint.captureContext` |
| `Sentry.captureMessage(msg)` | `sentori.captureMessage(msg)` | identity |
| `Sentry.captureMessage(msg, Sentry.Severity.Warning)` | `sentori.captureMessage(msg, { level: 'warning' })` | enum → string; `Severity.Critical` → `'fatal'`; `Severity.Log` → `'info'` + dev hint "Sentori 5-level syslog model" |
| `Sentry.setUser({ id, email, username, ip_address })` | `sentori.setUser({ id, linkBy: { email, username } })` | `email` → `linkBy.email`; `username` → `linkBy.username`; **`ip_address` dropped + hint**; `name` → `name` if present |
| `Sentry.setTag(k, v)` | `sentori.setTag(k, v)` | identity |
| `Sentry.setTags(rec)` | `sentori.setTags(rec)` | identity |
| `Sentry.addBreadcrumb({ category, message, level, data, type })` | `sentori.addBreadcrumb({ message, type: type ?? mapCategory(category), level, data })` | `category` → `type` via well-known map (`auth`→`user`, `fetch`→`http`, ...); else `tags.category` |
| `Sentry.startTransaction({ op, name })` | `sentori.startTrace(name)` | returns Span. If host calls `.startChild()` on it, redirect to `sentori.startSpan({ parent: this })` |
| `Sentry.startSpan({ op, name }, fn)` | `sentori.withSpan(name, fn)` | newer Sentry v8+ API maps directly |
| `Sentry.startInactiveSpan({ name })` | `sentori.startSpan({ name })` | doesn't auto-activate |
| `Sentry.withScope(fn)` | internal push/pop scope; calls `fn(proxyScope)` | proxyScope exposes `setTag` etc. that funnel to module functions |
| `Sentry.configureScope(fn)` | same as `withScope` minus push/pop | hint: prefer `withScope` |
| `Sentry.flush(timeoutMs)` | `sentori.flush(timeoutMs)` | identity |
| `Sentry.close()` | `sentori.close()` | identity |

### 4.3 Warning policy

Each translation that drops or remaps host-supplied data fires
**once per (host session, distinct shape)** at `info` level:

```
[sentori/compat] Sentry.setUser({ ip_address })
  → ip_address dropped: Sentori does not store IP (privacy by design).
  → use: sentori.setUser({ id, linkBy: { email } })
  → docs: https://docs.sentori.dev/sentry-compat#setuser
```

The dedup key is `(api_name, dropped_or_remapped_field)`. Subsequent
identical translations don't re-warn. Reset on `close()` / next session.

If `logLevel` is `'silent'`, no hints fire even on the first call.

### 4.4 What we do NOT support

- `Sentry.Integrations.*` registration — Sentori's feature toggles are
  in `init({ capture })`. Sentry users register integrations as
  classes; we refuse with a clear error pointing at the equivalent
  `capture` flag.
- Custom transports — Sentory has a single internal transport; replacing
  it is out-of-scope.
- Sentry's `BeforeSend` hook in its full generality — partial support
  for `event.user.email` redaction is automatic via `linkBy`. Custom
  scrubbing → use Sentori native `init({ capture })` filter (TBD;
  v2.4).

---

## 5 — Identity layer

The cross-project user-lookup story.

### 5.1 Concepts

- **Identity**: a `(key_type, value)` pair the host knows about its
  user. `key_type` is freeform: `email`, `phone`, `googleSub`,
  `appleSub`, `metaSub`, `username`, `employeeId`, …
- **Scope**: a privacy boundary. Events within a scope hash their
  identity keys against the same salt; events across scopes don't
  correlate.
- **Fingerprint**: the stored hash, computed server-side as
  `sha256(scope.salt || key_type || ':' || client_hash)`. Stored in
  `identity_fingerprints` denorm table; indexed for lookup.

### 5.2 SDK side

```ts
sentori.setUser({
  id?: string                       // raw, opaque
  name?: string                     // raw, display only
  anonymous?: boolean
  linkBy?: {                        // hashed client-side before send
    email?: string
    phone?: string
    googleSub?: string
    appleSub?: string
    metaSub?: string
    username?: string
    [custom: string]: string
  }
})
```

For each `linkBy` entry:

1. Normalise per well-known type (email lowercase+trim, phone E.164,
   ...) — runs client-side in SDK
2. Compute `clientHash = sha256(normalised)` using `crypto.subtle.digest`
   (WebCrypto). 64-hex-char output.
3. Discard raw value. Scope state stores `{ id, name, linkHashes:
   {key: clientHash} }`.

Wire payload:

```json
{
  "user": {
    "id": "usr_123",
    "name": "Lihao",
    "linkHashes": { "email": "a3f8…", "googleSub": "b2c1…" }
  }
}
```

Raw email **never** leaves the device. The wire-format field name is
`linkHashes` (not `linkBy`) so any malformed payload carrying raw
values gets server-side rejected.

### 5.3 Server side

Schema migrations (one-time, v2.3):

```sql
CREATE TABLE identity_scopes (
  id          UUID PK
  name        TEXT
  salt        BYTEA(32)
  created_at  TIMESTAMPTZ
)

ALTER TABLE orgs
  ADD COLUMN default_identity_scope_id UUID REFERENCES identity_scopes(id)

CREATE TABLE identity_fingerprints (
  event_id    UUID
  scope_id    UUID
  key_type    TEXT
  fingerprint BYTEA(32)
  PRIMARY KEY (event_id, scope_id, key_type)
)
CREATE INDEX ON identity_fingerprints (scope_id, key_type, fingerprint)
```

Bootstrap (one-shot): every existing `org` gets a default
`identity_scope` named after its slug with a random 32-byte salt.
New orgs auto-create theirs on first project creation.

On event ingest:

```rust
let scope = resolve_scope_for_project(project_id);  // org's default in v2.3
for (key, client_hash) in event.user.link_hashes {
    let fp = sha256(scope.salt || key || ":" || client_hash);
    INSERT identity_fingerprints (event_id, scope.id, key, fp);
}
```

The `User` struct schema:

```rust
pub struct User {
    pub id: Option<String>,
    pub name: Option<String>,
    pub anonymous: Option<bool>,
    pub link_hashes: Option<HashMap<String, String>>,
}
```

Server-side validation: every `link_hashes` value must match
`/^[a-f0-9]{64}$/`. Malformed → 400. (Defence against a buggy
client sending raw values.)

### 5.4 Server-side strip + log discipline

- `event.payload.user.email` / `phone` / `mail` / similar
  unknown-but-suspicious fields are stripped at ingest with a
  tracing-side metric increment. Event still accepted; identity
  field cleared.
- Server tracing logs **never** print `link_hashes` values (even though
  they're already hashed — defence in depth).
- Server `/admin/api/.../events` endpoint exposes `link_hashes` to
  authenticated operators (already-stored hashes); never returns raw
  email-like strings.

### 5.5 Lookup endpoint

```
POST /admin/api/identity-scopes/{scope_id}/lookup
  body: { keyType: "email", clientHash: "a3f8…" }

server:
  stored = sha256(scope.salt || keyType || ":" || clientHash)
  SELECT events.* FROM events e
  JOIN identity_fingerprints f ON f.event_id = e.id
  WHERE f.scope_id = ? AND f.key_type = ? AND f.fingerprint = stored
  ORDER BY received_at DESC
  LIMIT N
```

Rate limit: 60/min per operator session. Same response shape for
match vs no-match (don't leak existence to enumeration attacks). No
logging of input hash.

### 5.6 Dashboard "Users" view

- Operator types `(key_type, raw_value)` (raw_value never leaves the
  browser): `email` + `lihao@golia.jp`
- Browser computes `clientHash = sha256(normalised)` via
  `crypto.subtle.digest`
- URL becomes `/users?type=email&hash=<clientHash>` (only the hash;
  raw value never in URL / history / browser storage)
- POSTs to lookup endpoint
- Renders cross-project events / issues / first-seen / last-seen / counts
- Input field clears on blur

Issue Detail per-event display:
- ✓ raw `user.id` and `user.name` (host's choice)
- ✓ identity types present: `[email, googleSub]` (just the keys)
- ✓ fingerprint prefix `link:a3f8c92d` (8-char hex; opaque to
  operator without the original value)
- ✗ never display raw email / phone / sub
- ✓ "🔍 look up across projects →" button → `/users?type=...&hash=...`

### 5.7 Audit posture

Worst case: full server DB dump leaks.
- `id` + `name`: exposed (host's choice if those are PII; document
  warning that they're stored raw and recommend host treat as
  pseudonyms).
- `link_hashes` (table `identity_fingerprints`): exposed as 64-char
  hex strings. Without scope salt, no rainbow-table reversal works
  against well-distributed email/phone sets unless an attacker also
  obtains the salt table (separate physical location, easier to
  isolate).

Sentori never stores IP, geolocation finer than country code,
device fingerprint, or browser fingerprint by default.

### 5.8 GDPR / privacy obligations

- Sentori's data-controller posture: pseudonymous data with cryptographic
  separation; not "personal data" under most modern interpretations.
- DSR (data subject request) workflow: operator types user's email →
  hash → server purges all events with matching fingerprint. v2.4
  endpoint, architecturally supported in v2.3.

---

## 6 — Performance budgets

Per [CLAUDE.md](../../CLAUDE.md) "几乎不能造成 host app 的性能抖动" rule.

| Subsystem | Default | Main-thread budget | Network |
|---|---|---|---|
| globalErrors | on | ~ free (catches unhandled) | per error |
| network capture | on | < 0.5 ms per fetch wrapper call | unchanged (same request) |
| sessions / lifecycle | on | < 0.1 ms per AppState change | per session start/end |
| heartbeat | on | < 1 ms per minute | ~ 200 B/min foreground |
| identity hash | on (per setUser) | < 5 ms for 1–3 keys (SubtleCrypto) | included in next event |
| replay wireframe | **off** | < 5 ms per 500 ms tick on mid Android | ~ 2 KB diff / tick |
| screenshots | off | < 50 ms per capture (background-thread) | ~ 50–200 KB per upload |
| sample profiler | off | ~ 1–2% JS thread overhead | ~ 1 KB / sec |
| long task monitor | off | < 1 ms per long-task callback | per detection |

Verify rig (sim-sentori + Pixel 10 Pro AVD) is the v2.4 hard
deliverable — perf-honesty rule.

---

## 7 — LLM-friendliness notes

Concrete patterns that help LLM agents generate correct calls:

- **Single import**: `import sentori from '@goliapkg/sentori-react-native'`
  exposes the full API as object methods. LLMs autocomplete from one
  surface.
- **Type files** are flat and grep-able: every type lives at
  `sdk/react-native/src/types.ts` re-exported from `src/index.ts`.
- **Discriminated unions** for variants: `replay: false | 'wireframe'
  | { mode: 'wireframe'; hz?: number }` — LLM can see all three
  shapes inline.
- **Method names are verbs**: `capture*`, `set*`, `start*`, `with*`,
  `record*`, `track*`, `flush`, `close`. Predictable.
- **Argument shapes follow `(target, opts?)` pattern** consistently:
  `recordMetric(name, value, opts?)`, `captureMessage(msg, opts?)`.
- **No ambient context required**: every method works as a one-liner.
  LLM doesn't need to grok Hub / Scope / async-context to call.
- **Error feedback**: bad init values throw with a `[sentori/init]
  …` prefixed message saying exactly which option is wrong.

For the Sentry-compat layer:
- The `Sentry.*` namespace lives at a known sub-path; LLM trained on
  Sentry can write to it.
- Translation hints surface in console (when `logLevel >= info`),
  giving LLMs a follow-up signal for "use native equivalent."

---

## 8 — Implementation phases

### W6.0 — Logger + onReady hotfix (≤ 2 hours)

Goal: stop console noise NOW. No native API redesign yet.

- `sdk/core/src/logger.ts` + `setLogLevel` + `getLogLevel`
- `sdk/react-native/src/config.ts` + `logLevel` + `onReady` fields
- `sdk/react-native/src/init.ts` reads them, removes the
  `console.log('sentori: initialized …')` line, calls `onReady` after
  startup work settles
- Replace every `[sentori]` console.warn/log in `sdk/react-native/src/`
  with `logger.<level>('<subsystem>', ...)` per the routing table in §3
- Same sweep on `sdk/javascript/src/`

Ship as v2.3.0 SDK (or as a v1.2.0 in current track if we're not
ready for 2.3 bump). No behaviour change beyond log silence + new
init fields.

### W6.1 — Native API polish (1 day)

- Flatten `init` config per §2.1 (move sampling under `sample`)
- Backward-compat: accept legacy `errorSampleRate` etc. + warn-once
  + map to new shape
- Rename `withScopedSpan` → `withSpan`; keep `withScopedSpan` as
  re-export alias for one version
- Audit `capture.*` defaults match §2.1 table; fix divergences
- Drop `severity.log`-equivalent if any code paths still produce it
- Tests for each renamed surface

### W6.2 — Identity layer (2–3 days)

- Server: migrations `0065_identity_scopes` (per §5.3)
- Server: ingest path computes scope fingerprints
- Server: validation of `link_hashes` format (sha256 hex regex)
- Server: lookup endpoint
- Server: defensive strip of suspicious raw PII fields
- SDK: `User.linkBy` API + client-side hash via SubtleCrypto
- Dashboard: Users view + Issue Detail "look up" button

### W6.3 — Sentry compat layer (2–3 days)

- Sub-module `sdk/react-native/src/sentry-compat/index.ts`
- DSN parser + token validator
- Translation table per §4.2
- One-shot warn dedup
- Tests against representative Sentry-using sample apps (Storybook
  shim?)

### W6.4 — Documentation (1 day)

- Public docs at `docs-site/src/content/docs/`:
  - `getting-started.md` (Sentori native first)
  - `sentry-compat.md` (drop-in migration guide)
  - `privacy/identity.md` (the audit-safe explanation for legal)
  - `api/init.md` + `api/capture.md` + `api/scope.md` + `api/tracing.md`
  - `api/sentry-compat.md` (one page per translated method)
- LLM-friendly format: tables, complete code snippets, no marketing

### Out of v2.3 scope (defer to v2.4+)

- Project-level identity-scope carve (today: org default only)
- Operator-driven identity merge ("these two fingerprints are the
  same person")
- GDPR DSR delete endpoint
- Verify rig run for perf numbers (perf-honesty rule)
- Region scope (data residency)
- Native API for in-SDK PII scrub hook (`beforeSend`)
- Salt rotation

---

## 9 — Resolutions (locked 2026-05-23)

1. **`sample.traces` default = `0.1` (10%)**. Rationale anchored on
   T1 perf/net budget: a typical RN app with 5 fetches per minute
   per user × 1000 active users = 5000 spans/min. At 100% sampling
   that's a 90 KB/min steady ingest baseline; at 10% it's 9 KB/min.
   The lower number stays well inside the heartbeat-class budget and
   gives statistically usable p50/p95 from a few thousand samples
   per release. Hosts on a small user base (< 100 DAU) should
   explicitly raise to 1.0; document this in `api/init.md`.

2. **`Severity.Log → 'info'`** is the canonical map. One-way
   collapse; `Log` < `Info` distinction is lost. Sentory's 5-level
   syslog model is documented in the compat hint.

3. **`identity: false` semantics** — when `identity: false` and host
   calls `setUser({ linkBy })`, Sentori drops `linkBy` and emits a
   one-shot warn at `info` level (same dedup-by-shape policy as
   the Sentry compat translation hints, §4.3). Rationale: silent
   drop hides a real config / intent mismatch; one-shot warn-info
   is dev-visible without polluting prod.

4. **Compat path = `/compat`**, generic. Named export `Sentry`:

   ```ts
   import { Sentry } from '@goliapkg/sentori-react-native/compat'
   ```

   The generic path leaves room for future drop-in compat exports
   (`Bugsnag`, `Rollbar`, etc.) co-located. Sub-module keeps the
   main package's bundle lean for hosts that don't migrate.

5. **Logger transport hook** — yes. New top-level export:

   ```ts
   import { setLogTransport } from '@goliapkg/sentori-react-native'

   setLogTransport((level, tag, args) => {
     // route to host's own logger
     myDatadogLogger.log({ source: `sentori/${tag}`, level, args })
   })
   ```

   When a transport is set, **console output is suppressed** and the
   transport receives every call ≥ active `logLevel`. Pass `null`
   to restore console output. Document the signal contract in
   `api/logger.md`.

---

## 10 — Sign-off

This spec is the source of truth. Code follows; deviations require
updates here first.

When you (Lihao) approve, I'll start at W6.0 and march down the
phase list. Each phase has explicit deliverables; each delivery
gets a commit citing this doc.

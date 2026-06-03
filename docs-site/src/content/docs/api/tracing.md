---
title: Tracing API
description: startSpan / withSpan / startTrace / startMoment — record what your app did and how long it took.
---

Sentori's tracing surface is intentionally small:

- **`startSpan(op, opts?)`** — open a span, mutate it as work happens, `.finish()` to seal.
- **`withSpan(name, fn)`** — wrap helper. Opens a span, runs `fn`, ends the span.
- **`startTrace(name, opts?)`** — start a *root* span (a new trace).
- **`startMoment(name, props?)`** — Sentori-specific. A semantically-named user journey with optional checkpoints.

There's one explicit name (`startSpan`) and one wrap helper
(`withSpan`). No `startTransaction`, no `startInactiveSpan` —
both Sentry-historical concepts that we collapsed.

## startSpan

```ts
const span = sentori.startSpan('db.query', {
  name: 'load user profile',
  tags: { table: 'users' },
})
try {
  await db.query(...)
  span.setStatus('ok')
} finally {
  span.end()
}
```

Returns a `Span` handle. Mutate it as work progresses:

```ts
interface Span {
  setAttribute(key: string, value: AttributeValue): Span
  setAttributes(record: Record<string, AttributeValue>): Span
  setStatus(code: 'ok' | 'error', message?: string): Span
  recordException(err: unknown): Span
  end(opts?: { status?: 'ok' | 'error'; endNowMs?: number }): void
  isRecording(): boolean
  readonly spanId: string
  readonly traceId: string
}
```

### `StartSpanOptions`

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Human-readable label. Defaults to `op`. |
| `parent` | `Span \| SpanContextLike \| null` | `null` → new root span (start a new trace). Omitted → inherit active span context. |
| `tags` | `Record<string, string>` | Searchable in the dashboard. |
| `startNowMs` | `number` | Override the start wall-clock (back-dating a span). |
| `traceId` | `string` | Force the trace id (for continuing a distributed trace from an upstream `traceparent`). |

## withSpan — the wrap helper

`withSpan` has two overloads, dispatched by first-argument type:

```ts
// High-level: open + run + auto-end. Errors auto-record + status='error'.
function withSpan<T>(name: string, fn: (span: Span) => T | Promise<T>, opts?: StartSpanOptions): T | Promise<T>

// Low-level: push an existing span onto the active-context stack
// for the duration of `fn` so child spans inherit it as parent.
function withSpan<T>(span: SpanContextLike, fn: () => T): T
```

The high-level form is the LLM-friendly pattern:

```ts
const profile = await sentori.withSpan('db.query', async (span) => {
  span.setAttribute('table', 'users')
  return await db.query(...)
})
```

The low-level form lets a piece of middleware activate an
existing root span for the rest of the request:

```ts
import { startSpan, withSpan } from '@goliapkg/sentori-core'

app.use((req, res, next) => {
  const root = startSpan('http.server', { name: `${req.method} ${req.path}` })
  withSpan(root, () => next())
  // Children created inside next() pick up `root` as their parent.
})
```

The explicit name for the low-level form is `withActiveSpan` —
it's the same function, re-exported for clarity.

## startTrace

Same as `startSpan(op, { parent: null })` — semantic sugar for
"this is the root of a new trace":

```ts
const root = sentori.startTrace('checkout-flow', {
  tags: { user_id: '42' },
})
// ... child spans created without explicit parent inherit root.
root.end()
```

## startMoment

Sentori-specific: a `Moment` is a named user journey with
explicit completion states. Backed by a span underneath (`op =
'sentori.moment'`) so it shows up in the dashboard like any
other span, but with richer state semantics:

```ts
const onboarding = sentori.startMoment('onboarding', { ab: 'wave-3' })

onboarding.checkpoint('verified-email')
onboarding.checkpoint('connected-bank')
// Three terminal states:
onboarding.end()         // completed
// onboarding.fail('card-declined')
// onboarding.abandon('left-app')
```

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

The dashboard's Moments view (currently `hidden: true`, to be
opened under the find-user lens in v2.4) surfaces completion-rate
funnels keyed by moment `name`.

## Why these four, not three or seven

| Sentry | Sentori | Reason |
|---|---|---|
| `startTransaction` | `startTrace` | "Transaction" is Sentry-historical jargon; "trace" is the OpenTelemetry term. |
| `startSpan` + `startInactiveSpan` | `startSpan` (parent: `undefined` inherits, `null` doesn't) | Two functions for the same shape was Sentry historical. Explicit parent param is clearer. |
| `Sentry.startSpan({op,name}, fn)` | `withSpan(name, fn)` | The wrap pattern as a named function instead of an overload of `startSpan`. |
| — | `startMoment` | Sentori addition. Named journey + state machine on top of a span. |

## Related

- [`api/init`](./init.md) — `sample.traces` controls trace sampling
- [`api/capture`](./capture.md) — `captureException` inside a span records on the span
- [`recipes/manual-span`](../recipes/manual-span.md) — when to open one manually
- [`recipes/manual-trace`](../recipes/manual-trace.md) — when to start a fresh trace
- [`recipes/manual-moment`](../recipes/manual-moment.md) — when to use `startMoment`
- [`recipes/distributed-tracing`](../recipes/distributed-tracing.md) — `traceparent` interop

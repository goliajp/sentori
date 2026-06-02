---
title: Manual trace + span
description: Open a fresh trace with sentori.startTrace, add child spans manually, or auto-finish with withScopedSpan.
---

# Manual trace + span

Sentori auto-instruments fetch / react-navigation / server middleware so most traces appear without you having to do anything. This recipe is for the cases where you need to **open your own trace** — a CLI command, a worker tick, a background task deliberately detached from the current request.

```ts
const trace = sentori.startTrace('checkout-flow', { tags: { flow: 'checkout' } })

const child = sentori.startSpan('validate-cart', { parent: trace })
// ... work ...
child.end({ status: 'ok' })

trace.end({ status: 'ok' })
```

The trace shows up in the dashboard `Traces` module like any auto-instrumented trace; the root span is auto-tagged `source: 'manual'` so you can filter manual-rooted traces from the noise.

## Auto-finish: `withScopedSpan`

Most spans wrap a single function call. `withScopedSpan` opens the span, runs the callback, and ends with the right status based on the outcome — `'ok'` on resolve, `'error'` on throw (the exception is also `recordException`-d on the span).

```ts
const users = await sentori.withScopedSpan(
  'db.query users',
  async () => {
    return await db.query('SELECT * FROM users WHERE active = $1', [true])
  },
  { parent: trace }   // optional — defaults to active span
)
```

Sync callbacks work too:

```ts
const total = sentori.withScopedSpan('cart.total', () => {
  return items.reduce((sum, x) => sum + x.price, 0)
})
```

If the callback throws, the exception bubbles up to the caller as normal — Sentori never swallows host code errors. But the span is sealed with `status: 'error'` and the exception is attached so the dashboard can show it alongside the span context.

## Span attributes + status

`SpanHandle` (returned from `startSpan` / `startTrace`) supports Sentry / OTel-aligned ergonomics:

```ts
const span = sentori.startSpan('db.query users')
span.setAttribute('db.query', 'SELECT * FROM users WHERE active = $1')
span.setAttribute('db.rows_examined', 1024)
span.setStatus('error', 'timeout')   // stashed; applied at end()
span.recordException(err)             // attaches err to span.data.exception
span.end()                            // honours pending status
```

`setAttribute` accepts any value type — non-strings go through `String()`. Use `setAttributes(record)` for bulk:

```ts
span.setAttributes({
  'db.system': 'postgresql',
  'db.rows_returned': '500',
  'cache_hit': 'true',
})
```

`isRecording()` returns `true` while the span has not been ended — useful when conditionally instrumenting expensive attribute fetches:

```ts
if (span.isRecording()) {
  span.setAttribute('expensive', await computeAttribute())
}
```

## Sampling

`startSpan` / `withScopedSpan` honour `init({ sampling: { traces: 0.1 } })` when they would create a new root span — chained child spans inherit the root's decision.

**`startTrace` is exempt from sampling.** A manual `startTrace` call is an explicit intent — sampling is for auto-instrumented noise reduction, not for filtering out things the developer specifically asked for. Document the asymmetry so you don't go looking for missing manual traces.

## Adding metrics to a span

`recordMetric` accepts a `parent` option that joins the metric point to a specific span via `tags.span_id` / `tags.trace_id`. Visible in the dashboard span-detail "related metrics" row.

```ts
const span = sentori.startSpan('db.query users')
const start = Date.now()
try {
  const result = await db.query(...)
  sentori.recordMetric('db.query.duration_ms', Date.now() - start, undefined, { parent: span })
  span.end({ status: 'ok' })
  return result
} catch (err) {
  span.recordException(err)
  span.end({ status: 'error' })
  throw err
}
```

## Related

- [`captureMessage`](./manual-issue.md) — manual issue reporting (no trace).
- [`track` + `recordMetric`](./track-and-metrics.md) — analytics + numeric data points (separate pipelines).
- [Distributed tracing](./distributed-tracing.md) — cross-service trace propagation via `traceparent` headers.

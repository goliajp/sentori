---
title: Manual span (child) + withScopedSpan
description: Add a child span to an existing auto-instrumented trace, or use withScopedSpan for one-shot scoped work.
---

# Manual span (child)

Sentori auto-instruments fetch / react-navigation / server middleware, so most spans appear without you having to do anything. This recipe is for the cases where you **want a child span** on an existing trace — to mark out a chunk of work inside an auto-instrumented request, or to measure a specific function call.

This is distinct from [`startTrace`](./manual-trace.md), which opens a brand-new top-level trace. Use `startSpan` when there's already a trace in flight (auto- or manual-rooted) and you want to add depth.

## Add a child span to the active trace

```ts
// inside a fetch handler that Sentori already auto-instrumented:
const span = sentori.startSpan({ name: 'parse-csv' })
const rows = parseCSV(payload)
span.setAttribute('rows', rows.length)
span.end({ status: 'ok' })
```

`startSpan` with no explicit `parent` inherits the active span from the call stack (Node's AsyncLocalStorage / RN's synchronous module variable). So inside a fetch handler — already wrapped in an HTTP span — the new `parse-csv` span becomes a child of that span automatically.

If you need to attach to a specific parent rather than whatever's active:

```ts
const trace = sentori.startTrace('background-job')
const sub = sentori.startSpan({ name: 'db.fetch', parent: trace })
// ... work ...
sub.end({ status: 'ok' })
trace.end({ status: 'ok' })
```

## `withScopedSpan` — auto-finish on the way out

The vast majority of manual spans wrap a single function call. `withScopedSpan` opens the span, runs the callback, and ends with the right status based on the outcome — `'ok'` on resolve, `'error'` on throw (the exception is `recordException`-d on the span before it seals).

```ts
const users = await sentori.withScopedSpan('db.query users', async () => {
  return await db.query('SELECT * FROM users WHERE active = $1', [true])
})
```

Sync callbacks work too:

```ts
const total = sentori.withScopedSpan('cart.total', () => {
  return items.reduce((sum, x) => sum + x.price, 0)
})
```

If the callback throws, the exception bubbles up to the caller as normal — Sentori never swallows host code errors. But the span is sealed with `status: 'error'` and the exception is attached.

`withScopedSpan` is preferred over `startSpan` + manual `.end()` because:

- You can't forget to call `.end()` (a common bug that leaks orphan spans into the dashboard).
- The status is set correctly even when the callback throws and execution returns via the catch path.

Reach for `startSpan` directly only when the span needs to **outlive a single function call** — e.g. starting it in one event handler and ending it in another.

## Span attributes + status

`SpanHandle` returned from `startSpan` / `withScopedSpan` / `startTrace` supports Sentry / OTel-aligned ergonomics:

```ts
const span = sentori.startSpan({ name: 'db.query users' })
span.setAttribute('db.query', 'SELECT * FROM users WHERE active = $1')
span.setAttribute('db.rows_examined', 1024)
span.setStatus('error', 'timeout')   // stashed; applied at end()
span.recordException(err)             // attaches err to span.data.exception
span.end()                            // honours the pending status
```

- `setAttribute(k, v)` — single attribute. Non-strings go through `String()`.
- `setAttributes(record)` — bulk.
- `setStatus(code, message?)` — `'ok'` / `'error'`. Stashed until `end()` is called; if you pass an explicit `opts.status` to `end()` that wins.
- `recordException(err)` — attaches `{ type, message, stack }` to `span.data.exception`. Dashboard renders it alongside the span's other context.
- `isRecording()` — `true` while not yet ended. Use to short-circuit expensive attribute computation:

```ts
if (span.isRecording()) {
  span.setAttribute('expensive', await computeAttribute())
}
```

## Sampling

`startSpan` / `withScopedSpan` honour `init({ sampling: { traces: 0.1 } })` when they would create a **new root** (no active parent). Chained child spans inherit the root's decision — sampling is a per-trace verdict, not per-span.

`startTrace` is exempt — see the [manual trace recipe](./manual-trace.md).

## Related

- [`startTrace`](./manual-trace.md) — open a new top-level trace.
- [`startMoment`](./manual-moment.md) — span with funnel / abandonment semantics.
- [`recordMetric` with `parent`](./track-and-metrics.md) — attach numeric measurements to a specific span.

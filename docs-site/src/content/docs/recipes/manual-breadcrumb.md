---
title: Manual breadcrumb — context for the next event
description: Use addBreadcrumb to leave a context trail that rides along with the next captureException / captureMessage.
---

# Manual breadcrumb

A breadcrumb is a context line that **rides along with the next captured event**. The dashboard's Issue Detail view shows the last 100 breadcrumbs from before the exception fired — so an on-call engineer can read the trail of "what happened in the 30 seconds before this crash".

Breadcrumbs are the difference between an issue page that says "TypeError on line 42" and one that says "user clicked Buy → POST /checkout 500 → switched provider → POST /checkout 200 → TypeError on line 42". The trail makes triage minutes instead of hours.

```ts
sentori.addBreadcrumb({
  message: 'switched to payment provider B after primary 500',
  type: 'log',
  level: 'warning',
})

// somewhere later, this crash inherits the breadcrumb above:
sentori.captureException(err)
```

## Anatomy

```ts
type AddBreadcrumbInput = {
  message: string             // required — the human-readable line
  type?: 'user' | 'navigation' | 'http' | 'log' | 'track' | 'custom'
  level?: 'fatal' | 'error' | 'warning' | 'info' | 'debug'  // default 'info'
  data?: Record<string, unknown>
}
```

The dashboard renders breadcrumbs grouped by `type` so you can scan a long trail by category. Use the type that best matches the breadcrumb's source:

- **`user`** — user action ("clicked Buy", "swiped to dismiss")
- **`navigation`** — route change ("`/cart` → `/checkout`")
- **`http`** — outbound HTTP request ("POST /api/charge → 500")
- **`log`** — application log line ("retrying with provider B")
- **`track`** — auto-emitted by the `track` API when `trackAutoBreadcrumb: true` is set (see [track + metrics](./track-and-metrics.md))
- **`custom`** — anything else

You generally don't need to call `addBreadcrumb({ type: 'http', ... })` yourself — Sentori auto-instruments fetch / XHR and emits these. Same for `'navigation'` on auto-instrumented routers.

## When to drop a breadcrumb directly vs let `track` emit one

If you already call `sentori.track('button.clicked', { sku })` for analytics, **don't also `addBreadcrumb({...})` for the same event** — it's redundant. Instead, enable `trackAutoBreadcrumb` in `init`:

```ts
sentori.init({
  // …
  capture: { trackAutoBreadcrumb: true },
})
```

Now every `track` call also drops a breadcrumb of type `'track'` with the event name. One call, two destinations: the analytics pipeline gets the data point, the issue pipeline gets the context line.

Reach for `addBreadcrumb` directly when:

- The signal isn't analytics-worthy (one-off "fallback fired" / "cache miss")
- The signal needs more nuance than a flat name (`message` is free-form)
- You want a different `type` than `'track'` (e.g. `'http'` for an outbound call your fetch wrapper didn't see)

## Ring buffer + sealing

Breadcrumbs live in a 100-slot ring buffer at the SDK. Oldest is evicted as new ones come in. When `captureException` or `captureMessage` fires, the current buffer state is **sealed** onto that event — subsequent breadcrumbs join the next event's seal.

This is why the trail you see on an Issue Detail is "the last N before the crash" and not "all breadcrumbs ever". The ring shape keeps memory bounded — even an app emitting 10 breadcrumbs per second uses < 5 KB of buffer.

## Don't put PII in `data`

Breadcrumb `data` is the equivalent of `event.tags` — it gets PII-scrubbed server-side using the same regex set. But don't deliberately put email addresses, tokens, or personal identifiers in there hoping the scrubber catches them. Sanitise at the call site.

```ts
// no:
sentori.addBreadcrumb({
  message: 'user submitted form',
  data: { email: form.email, password: form.password },  // 🚫 PII + secret
})

// yes:
sentori.addBreadcrumb({
  message: 'user submitted form',
  data: { hasEmail: !!form.email, formFields: Object.keys(form) },
})
```

## Cost / perf

`addBreadcrumb` is one of the cheapest APIs in the SDK:

- Single object push to a fixed-size array. Sub-microsecond.
- No network IO until a parent event fires.
- No allocation churn — the eviction is `Array#shift` on overflow.

You can call it from a render hook. The cost dominates the captured event's payload size only when crumbs are unusually long (multi-kB JSON `data` blobs). Keep `data` small + structured.

## When NOT to use breadcrumbs

- **For metrics / numeric data** — use [`recordMetric`](./track-and-metrics.md).
- **For analytics events** — use [`track`](./track-and-metrics.md).
- **For standalone reports** (no parent error / message expected) — use [`captureMessage`](./manual-issue.md). A breadcrumb without a parent event will eventually be evicted and never lands anywhere.

## Related

- [`captureException` / `captureMessage`](./manual-issue.md) — the parent events breadcrumbs ride on.
- [`track`](./track-and-metrics.md) — the auto-breadcrumb path.
- [Manual trace + span](./manual-trace.md) — when you want timing, not just context.

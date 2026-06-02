---
title: Track + recordMetric — analytics and numeric observations
description: Sentori has dedicated analytics and metrics pipelines, distinct from the Issues / Traces flows. When to use which.
---

# Track + recordMetric

Sentori ships two non-issue signal types most observability stacks bolt on with a separate vendor:

- **`sentori.track(name, opts?)`** — discrete analytics events. Lands in the **Audience** dashboard. Like Mixpanel `track`, like Amplitude events. Distinct pipeline from issues.
- **`sentori.recordMetric(name, value, opts?)`** — numeric observations. Lands in **Metrics**. Like Datadog StatsD counters / gauges.

Both are bounded, batched, fire-and-forget. Neither blocks the JS thread. Both honour the NEVER rule — internal failures self-report via the circuit-breaker and never propagate to host code.

This recipe is about **when to reach for which**.

## `track` — analytics events

```ts
sentori.track('product.viewed', { props: { sku: 'A-123', price: 99.99 } })
sentori.track('cart.add', { props: { sku, qty } })
sentori.track('checkout.completed', { props: { revenue: 99.99 } })
sentori.track('feature.toggled', { props: { feature: 'dark-mode', value: true } })
```

What `track` is for:

- DAU / WAU / MAU rollup
- Conversion funnels (`product.viewed` → `cart.add` → `checkout.completed`)
- Per-route dwell + drop-off
- Feature-flag exposure tracking

`track` events ride a **500-event ring buffer, flushed every 30 s** to `/v1/track:batch`. Cheap to call from a render hook — the JS-thread cost of `track('foo')` is dominated by the props serialisation, which is one `JSON.stringify` on first flush. No per-call HTTP request.

### Dashboard

`track` events land in the **Audience** module:

- Live view: concurrent users + by-country / by-OS / by-route slices.
- Metrics view: DAU + top-pageview + error-overlay over 7d.
- Behavior view: top routes + drop-off.
- User detail: merged track + error timeline for a specific user id.

The data is rolled up hourly. You won't see a `track` call land instantly — it takes up to 60 seconds for batched events + rollup pass.

### Track auto-breadcrumb

The v2 SDK offers an optional bridge: every `track` call can also `addBreadcrumb({ type: 'track', message: name })`. Opt in:

```ts
sentori.init({
  // …
  capture: { trackAutoBreadcrumb: true },
})
```

Now when a `captureException` later fires, its breadcrumb trail includes every recent `track` event. The dashboard's Issue Detail breadcrumbs show the user journey — `product.viewed` → `cart.add` → `error` — without you having to wire issue + analytics together by hand.

Off by default to preserve existing breadcrumb shape; new integrations should turn it on.

## `recordMetric` — numeric observations

```ts
sentori.recordMetric('cart.size', cart.length)
sentori.recordMetric('db.query.duration_ms', 42)
sentori.recordMetric('image.upload.bytes', file.size, { tags: { type: 'avatar' } })
```

What `recordMetric` is for:

- Time-series (latency, sizes, counts)
- Histogram-shaped data
- Per-route / per-feature counters

Points go to a **500-point ring buffer, flushed every 30 s** to `/v1/metrics:batch`. Same JS-thread budget as `track`.

### Attaching a metric to a span

`recordMetric` accepts an optional `parent: SpanContextLike` so a metric can be correlated to a span:

```ts
const span = sentori.startSpan({ name: 'db.query users' })
const start = Date.now()
const rows = await db.query(...)
sentori.recordMetric('db.query.duration_ms', Date.now() - start, {
  parent: span,
})
span.end({ status: 'ok' })
```

The metric point lands with `tags.span_id` + `tags.trace_id`. Dashboard span detail joins these into a "related metrics" row, so a slow trace can be examined with its numeric context inline.

## The decision table

| Signal | Use |
|---|---|
| "user clicked Buy" | `track('cart.add', { props: { sku } })` |
| "feature flag flipped" | `track('feature.toggled', { props })` |
| "request took 850 ms" | `recordMetric('http.duration_ms', 850, { parent: span })` |
| "cart has 5 items" | `recordMetric('cart.size', 5)` |
| "payment provider returned 500" | `captureMessage('payment 500, fallback fired', { level: 'warning' })` — see [manual-issue](./manual-issue.md) |
| "took these N steps in checkout" | `startMoment('checkout')` — see [manual-moment](./manual-moment.md) |

## Cost / perf

Both APIs are cheap by design:

- 500-slot ring, evicts oldest if full (no memory leak under load)
- 30 s flush cadence (one HTTP request per 30 s per signal type, not per event)
- Per-call work: validation + ring push + occasional flush trigger. Sub-microsecond on modern devices.
- NEVER rule applies — wrapped via `safeFn`. Internal failure → silent fail + circuit-breaker'd self-report.

See [`docs/performance/sdk-host-app-impact.md`](https://github.com/goliajp/sentori/blob/main/docs/performance/sdk-host-app-impact.md) for the budget breakdown.

## What `track` and `recordMetric` are NOT

- **Not for issue reporting.** A failed payment retry is a `captureMessage`, not a `track('error.payment')`. The Issues pipeline is the on-call's view; the analytics pipeline is the PM's view.
- **Not for stack-traced errors.** Use `captureException(err)`.
- **Not for ad-hoc debug.** Use `addBreadcrumb` for context that should ride along with the next captured event.

Keep the pipelines distinct and each one's signal stays clean.

## Related

- [`captureMessage`](./manual-issue.md) — manual issue reporting (different pipeline).
- [Manual trace + span](./manual-trace.md) — engineering timing.
- [Manual breadcrumb](./manual-breadcrumb.md) — when to drop a breadcrumb directly vs let `track` emit one.

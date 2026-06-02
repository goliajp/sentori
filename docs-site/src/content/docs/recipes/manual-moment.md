---
title: Manual moment — business funnels + abandonment
description: Use sentori.startMoment to track multi-step business flows (signup, checkout) with checkpoint and abandonment status.
---

# Manual moment

A **moment** is a span with funnel semantics. Use it when you want to track a multi-step user flow ("signup", "checkout", "first-time onboarding") and see in the dashboard:

- How many users started the flow vs completed.
- How long each step took.
- Where users **abandoned** mid-flow.

Spans (from `startSpan`) measure code execution time; moments measure **user intent** across multiple steps.

```ts
import { startMoment } from '@goliapkg/sentori-react-native'

const m = startMoment('signup', { plan: 'pro', source: 'landing-cta' })

// later:
m.checkpoint('email-confirmed')
// later again:
m.checkpoint('first-app-opened')
// happy path:
m.end()
```

Each `startMoment` call opens a span tagged `op = 'sentori.moment'` with `moment.name = 'signup'` and your `{ plan, source }` props as `moment.prop.*` tags. The dashboard indexes on `moment.name` so all signups land on one funnel view.

## Checkpoint pattern

Most flows have intermediate steps you want timestamped. `m.checkpoint(label)` records a step without ending the moment:

```ts
const m = startMoment('checkout', { sku })

m.checkpoint('cart-validated')
await chargePayment()

m.checkpoint('payment-succeeded')
await shipNotification()

m.checkpoint('email-sent')
m.end()
```

The dashboard renders a step-by-step timeline of each moment with deltas between checkpoints.

## Abandonment — the unique part

```ts
const m = startMoment('checkout', { sku })

window.addEventListener('beforeunload', () => {
  if (m.status === 'open') m.abandon('navigation-away')
})

router.on('cancel', () => m.abandon('explicit-cancel'))
```

`abandon(reason?)` marks the moment as `abandoned` and tags the span `abandoned=true` so the dashboard's **funnel view** can break out by reason. This is the difference between a real funnel tool (Mixpanel / Amplitude — separate analytics pipeline) and a developer-shaped one (Sentori — one pipeline, one dashboard, traces ride along).

## Failure path

```ts
const m = startMoment('checkout', { sku })

try {
  await chargePayment()
  m.end()
} catch (err) {
  m.fail(err.message)
  throw err
}
```

`fail(reason)` is shorthand for `m.span.setStatus('error', reason)` + `m.span.end({ status: 'error' })`. The dashboard renders it red on the funnel view.

## What `startMoment` adds vs raw `startSpan`

Both open a span. The difference is **dashboard rendering**:

- A regular `startSpan` lands in **Traces** — engineering's view.
- A moment lands additionally on the **Moments / Funnels** view — PM / growth / on-call's view of "are users completing key flows".

The conventional tags (`op = 'sentori.moment'`, `moment.name`, `moment.prop.*`, `abandoned=true|false`) are what the funnel view filters on. You could replicate this with `startSpan` + manual tags, but `startMoment` is the one-line ergonomic shape.

## Use the right tool

| Tool | Signal | Dashboard module |
|---|---|---|
| `captureException` / `captureMessage` | "something broke" | Issues |
| `startTrace` + `startSpan` | engineering timing | Traces |
| **`startMoment`** | **user flow completion / abandonment** | **Moments** |
| `track(name, props)` | discrete analytics events (`product.viewed`, `button.clicked`) | Audience |
| `recordMetric` | numeric time-series | Metrics |
| `addBreadcrumb` | context attached to the next event | Issue Detail breadcrumbs |

When in doubt: **moment if it's a flow with multiple steps + abandonment; track if it's a single discrete event; span if it's a unit of code execution.**

## Related

- [Manual trace](./manual-trace.md) — `startTrace` for top-level workflow span.
- [Manual span](./manual-span.md) — `startSpan` / `withScopedSpan` for inner units.
- [Track + metrics](./track-and-metrics.md) — discrete analytics + numeric data points.

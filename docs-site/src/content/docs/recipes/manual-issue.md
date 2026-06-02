---
title: Manual issue reporting
description: When and how to use sentori.captureMessage — the missing piece for "operator should look at this" signals.
---

# Manual issue reporting

`sentori.captureException(err)` covers thrown errors. `sentori.captureMessage(msg, opts?)` covers the other half: when your code knows something interesting happened, the operator should hear about it, but there's no `Error` to throw.

```ts
sentori.captureMessage('Payment provider returned 500, used fallback', {
  level: 'warning',
  tags: { feature: 'checkout' },
})
```

These land in the **Issues** module alongside thrown errors — same grouping, same triage tools (resolve / silence / link to Linear), same Slack / Jira / GitHub integration alerts. The dashboard distinguishes them with a 💬 icon and a level chip.

## When to reach for `captureMessage`

| Scenario | Why it's a message, not an exception |
|---|---|
| Payment provider 500 → used fallback | Code recovered. No `Error` to throw. But the operator should know provider B is acting up. |
| Feature flag rollout reached 100 % | Successful state change. Worth logging for posture / audit. |
| Detected impossible state in a reducer | The codepath shouldn't be possible. Throwing here would *also* be reasonable; `captureMessage('Impossible state: …', { level: 'error' })` lets the app keep running while still flagging the bug. |
| SDK upgrade required (semver gap) | `{ level: 'fatal' }` so the alert wakes someone, but no `Error` to construct. |
| User denied a permission | `{ level: 'info' }` — context for usage analytics; not an alert. |

The shape `captureMessage` does NOT fit:

- **Analytics** — `sentori.track('cart.add', { sku })`. Different pipeline, different dashboard module (Audience), different retention.
- **Numeric measurements** — `sentori.recordMetric('cart.size', 5)`. Goes into a time-series, not an issue list.
- **Breadcrumbs for context** — `sentori.addBreadcrumb('user clicked Buy')`. These ride along on the *next* captured event, not on their own.

## Level guide

Sentori uses 5 levels (syslog / RFC 5424 — deliberately drops Sentry's redundant `'log'`):

```ts
'fatal'    // page someone immediately
'error'    // a real bug — should resolve before next release
'warning'  // degraded but functioning — fallback fired, retry succeeded
'info'     // normal operation worth logging — feature flag hit
'debug'    // verbose; usually suppressed in prod
```

Default level is `'info'` when omitted.

## Tags strategy

Tags are how you slice messages on the dashboard. Two patterns:

**Per-call tags** — situational:

```ts
sentori.captureMessage('Stripe webhook took 8 s', {
  level: 'warning',
  tags: { provider: 'stripe', webhook: 'subscription.updated' },
})
```

**Scope tags** — apply to everything emitted from a request / session:

```ts
// One-shot setup at request start
sentori.setTag('request_id', headers['x-request-id'])
sentori.setTag('rollout', 'dark-mode-v2')

// Every captureException + captureMessage below carries those tags.
sentori.captureMessage('Cache hit ratio < 50 %')
```

Per-call tags win on conflict. Global tags persist until `setTag` overrides them.

## Sampling

`captureMessage` honours `init({ sampling: { messages: 0.1 } })` — drop 90 % of message-kind events at the SDK before they ship. Defaults to `1.0` (keep all). Use this when an `info`-level message could turn into a high-volume log line at scale.

`captureException` has its own `sampling.errors` rate, independent.

## Privacy

Message bodies go through the same server-side PII scrubber as `captureException` error messages — ISO timestamps, UUIDs, and long digit runs are normalised at grouping time so "User 12345 fell back" and "User 67890 fell back" land on the same issue.

## Dashboard rendering

A message-kind issue in the list looks like:

```
💬  user denied location permission                       2m ago
    info · sentori-example · 12 events
    tags: feature=maps
```

versus a thrown error:

```
●   TypeError: Cannot read property 'foo' of undefined    2m ago
    error · sentori-example · 12 events  ·  3.4 KB attached
    ts/auth/login.ts:42 → ts/index.ts:7
```

Issue Detail renders the same shape as error issues (tags / breadcrumbs / device / release / attachments) minus the stack panel. The message body becomes the page headline.

## Related

- [`captureException`](../sdk-react-native.md) — for thrown errors with a stack.
- [`track`](./track-and-metrics.md) — for analytics events.
- [`recordMetric`](./track-and-metrics.md) — for numeric observations.
- [`addBreadcrumb`](./manual-breadcrumb.md) — for context attached to the next event.

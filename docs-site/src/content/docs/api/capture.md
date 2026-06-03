---
title: captureException / captureMessage
description: Send an event to Sentori. captureException for thrown values, captureMessage for intentional one-off reports.
---

Sentori has two top-level functions to ship a single event:

- **`sentori.captureException(err, extras?)`** — for anything thrown.
- **`sentori.captureMessage(msg, opts?)`** — for "operator should
  look at this" signals that aren't an error: a fallback fired, an
  unexpected state, a feature-flag rollout that crossed a threshold.

Both run under the NEVER rule — any internal SDK failure is
swallowed by the surrounding `safeFn` wrapper. The host's call
site never throws.

## captureException

```ts
sentori.captureException(err: unknown, extras?: CaptureExtras): void
```

Auto-fires on uncaught exceptions when `init.capture.globalErrors:
true` (the default). Call it manually when you've caught + want to
report:

```ts
try {
  await refreshToken()
} catch (err) {
  sentori.captureException(err, {
    tags: { feature: 'auth' },
    fingerprint: ['auth.refresh-failed'],
  })
  // Continue with the fallback path.
}
```

### `extras`

| Field | Type | Notes |
|---|---|---|
| `tags` | `Record<string, string>` | Merged onto the current scope tags. Searchable + groupable in the dashboard. |
| `level` | `'fatal' \| 'error' \| 'warning' \| 'info' \| 'debug'` | Override the default `'error'`. |
| `fingerprint` | `string[]` | Force grouping. Same fingerprint → same issue regardless of stack-trace differences. |
| `user` | `User \| null` | Per-call user override. Falls back to the scope's current `setUser` value. |
| `screenshot` | `boolean` | Force off (`false`) even when `init.capture.screenshot: true`. Useful on a sensitive screen. |

## captureMessage

```ts
sentori.captureMessage(message: string, opts?: CaptureMessageOptions): void
```

Routes to the dashboard's Issues module under `kind: 'message'`.
Use for events that aren't an error but still warrant operator
attention.

```ts
sentori.captureMessage('Payment provider returned 500, used fallback')

sentori.captureMessage('Detected impossible state in session reducer', {
  level: 'error',
  tags: { reducer: 'session' },
})
```

### `opts`

| Field | Type | Default | Notes |
|---|---|---|---|
| `level` | `MessageLevel` | `'info'` | Sentori uses RFC 5424 / syslog 5 levels: `fatal`/`error`/`warning`/`info`/`debug`. No separate `log` level (Sentry's `Log` maps to `'info'` here). |
| `tags` | `Record<string, string>` | — | Per-call tags merged with scope tags. |
| `data` | `Record<string, unknown>` | — | Free-form payload attached to the event. |
| `user` | `User \| null` | scope value | Per-call user override. |
| `breadcrumbs` | `Breadcrumb[]` | scope ring snapshot | Override the captured breadcrumb list. Almost never needed. |

### Why two functions?

Sentry has one `captureException` that you sometimes pass a
string to. We split because the API for "I have a real Error
with a stack" and "I have a string to surface" wants different
defaults (level, fingerprint shape, attachment behaviour). One
function per intent is easier for LLMs to generate calls for too.

## What both share

- The current scope's `user`, `tags`, and `breadcrumbs` ring are
  snapshotted onto the event automatically. Use the
  [scope APIs](./scope.md) to set them.
- Both run through any configured
  [`init.beforeSend`](./before-send.md) hook before transport
  enqueue.
- Both fire-and-forget: they return immediately and the SDK
  transports the event in the background. Hosts that need a
  flush gate (e.g. before process exit) call
  `await sentori.flush(timeoutMs)`.

## Related

- [`api/scope`](./scope.md) — `setUser` / `setTag` / `addBreadcrumb`
- [`api/before-send`](./before-send.md) — host PII scrub hook
- [`api/tracing`](./tracing.md) — for "this operation took N ms"
- [`recipes/manual-issue`](../recipes/manual-issue.md) — when to use which

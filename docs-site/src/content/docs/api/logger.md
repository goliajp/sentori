---
title: SDK logger
description: setLogLevel / setLogTransport / logger — gate Sentori's own console output.
---

Sentori's SDK is **silent by default**. A healthy install adds
zero `[sentori]` lines to your metro / browser console — anything
the host sees prefixed `[sentori/...]` should mean Sentori has
an *actual* problem (transport sustained failure, native module
unbound, internal SDK exception), not "Sentori is doing its job."

Default level is `'warn'`. Cranked up via `init.logLevel` or the
runtime `setLogLevel` export.

## init-time

```ts
sentori.init({
  token: 'st_pk_…',
  release: '1.0.0',
  logLevel: 'debug',   // see every internal SDK action
})
```

## Runtime override

```ts
import { setLogLevel } from '@goliapkg/sentori-react-native'

// e.g. wired to your in-app dev menu
setLogLevel('debug')
```

`getLogLevel()` returns the current setting; useful for an
in-app toggle UI.

## Levels

| Value | What surfaces |
|---|---|
| `'silent'` | Nothing. Use in CI smoke runs / hosts that absolutely never want Sentori in console. |
| `'error'` | SDK internal failure (`reportInternal` fired, native module not found, transport circuit-broke). |
| `'warn'` (default) | The above + transient anomalies that recovered (transport retry exhausted, screenshot capture threw, replay tick threw). |
| `'info'` | The above + lifecycle moments (flush done on close, etc.). Sentry-compat hints fire at this level. |
| `'debug'` | Everything: per-tick replay logs, breadcrumb additions, native method enumeration, transport retry counts. Off by default. |

## Routing internal lines to your own logger

`setLogTransport(fn)` lets a host route every SDK line into
their own log aggregator (Datadog, OpenTelemetry, etc.) instead
of `console.*`.

```ts
import { setLogTransport, type LogTransport } from '@goliapkg/sentori-react-native'

const sentoriToDatadog: LogTransport = (level, tag, args) => {
  // tag = subsystem, e.g. 'native', 'replay', 'transport'
  myDatadogLogger.log({
    source: `sentori/${tag}`,
    level,
    args,
  })
}

setLogTransport(sentoriToDatadog)
// Pass null to restore console:
// setLogTransport(null)
```

When a transport is set:

- Console output is **suppressed**.
- Every line at or above the active `logLevel` is dispatched to
  the transport.
- If the transport itself throws, the SDK catches the throw, logs
  a one-shot fallback warning to `console.warn`, and continues
  with the original line on console — the NEVER rule applies to
  the logger too.

## What about `init.beforeSend`?

Different concern: `beforeSend` is host control over the *content*
of outbound *events*. `setLogLevel` / `setLogTransport` is host
control over Sentori's *internal diagnostics*. They don't overlap.

See [`api/before-send`](./before-send.md) for the event hook.

## Why this isn't just "I can do my own console.log"

Hosts that want to log their *own* SDK debugging messages should
keep doing that with their own logger. The reason Sentori ships a
logger is so:

1. SDK-internal lines have a consistent `[sentori/<subsystem>]`
   prefix you can grep for / filter in your aggregator.
2. The default-warn gate cuts the v2.2 SDK's ~20 lines/init down
   to zero on healthy operation, so host console stays clean.
3. Hosts can route every SDK line into their existing
   observability pipeline without monkey-patching `console.*`.

## Perf

The logger fast-path (gated-out level check) is < 1 µs/op on
M-class Apple Silicon — verified in
`sdk/core/src/__tests__/perf.bench.ts`. Net SDK contribution from
the logger module at default `'warn'` level is essentially free.

## Related

- [`api/init`](./init.md) — `logLevel` + `onReady` init fields
- [`api/before-send`](./before-send.md) — event content hook (separate concern)

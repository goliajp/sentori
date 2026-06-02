---
title: Sentry-compatible API
description: Drop-in support for code written against @sentry/react-native. Sentori translates each Sentry call into its native equivalent and warns on differences.
---

If you have an app that already uses Sentry (or a code-generating
LLM that knows Sentry's API), Sentori's compat layer lets the
same syntax work against Sentori. No re-learning, no rewrites.

```ts
import * as Sentry from '@goliapkg/sentori-react-native/compat'

Sentry.init({
  dsn: 'https://st_pk_yourtoken@ingest.sentori.golia.jp/your-project',
  release: 'myapp@1.2.3',
  environment: 'prod',
  tracesSampleRate: 0.1,
})

Sentry.captureException(new Error('something broke'))

Sentry.setUser({ id: 'usr_123', email: 'lihao@golia.jp' })
// → SDK hashes email client-side; Sentori sees only the hash.
```

## What gets translated

Under the hood, every `Sentry.*` call maps to exactly one
Sentori-native call. When the mapping is lossless (same name,
same shape) it's silent. When the mapping needs to drop or
remap a field (e.g. Sentry's `ip_address` doesn't exist in
Sentori), a **one-shot console hint at `info` level** fires
explaining what happened. Subsequent calls of the same shape are
silent.

### Lossless mappings

| Sentry | Sentori native | Notes |
|---|---|---|
| `Sentry.captureException(err)` | `sentori.captureException(err)` | identical |
| `Sentry.captureMessage(msg)` | `sentori.captureMessage(msg)` | identical |
| `Sentry.setTag(k, v)` | `sentori.setTag(k, v)` | identical |
| `Sentry.setTags(rec)` | `sentori.setTags(rec)` | identical |
| `Sentry.flush(ms)` | `sentori.flush(ms)` | identical |
| `Sentry.close()` | `sentori.close()` | identical |

### Mappings that hint

| Sentry | Sentori | Hint |
|---|---|---|
| `Sentry.init({ dsn })` | Parses `st_pk_<token>@<host>` from DSN | Refuses non-Sentori tokens (must start `st_pk_`) |
| `Sentry.setUser({ email })` | `sentori.setUser({ linkBy: { email } })` | Email hashed client-side; raw never sent |
| `Sentry.setUser({ ip_address })` | dropped | Sentori never stores IP — privacy by design |
| `Sentry.setUser({ segment })` | mapped to tag `user.segment` | Native equivalent: `setTag('user.segment', …)` |
| `Sentry.Severity.Log` / `Sentry.Severity.Critical` | `'info'` / `'fatal'` | Sentori uses 5-level syslog scale |
| `Sentry.captureException(err, { extra })` | `sentori.captureException(err, { tags: { ...extra } })` | Sentori has one tag namespace, not separate `extra` |
| `Sentry.startTransaction({ op, name })` | `sentori.startSpan(...)` | Returns a Sentori Span exposing partial Sentry API (`.finish`, `.setStatus`, `.startChild`) |
| `Sentry.withScope(s => s.setTag(...))` | `sentori.setTag(...)` (no auto-revert) | Sentori has no Hub — for strict isolation use explicit `clearTags` |
| `Sentry.addBreadcrumb({ category })` | `sentori.addBreadcrumb({ type })` | `category` maps to `type` via well-known table; original preserved in `data.category` |

### Ignored fields

These are accepted (don't throw) but warn-once on first use:

| Sentry init field | Why ignored |
|---|---|
| `attachStacktrace` | Sentori always sends stack traces — no toggle |
| `autoSessionTracking` | Sessions on by default; toggle via `init({ capture: { sessions } })` |
| `integrations` | Sentori uses `init({ capture: {...} })` toggles; integration classes not supported |
| `beforeSend` / `beforeBreadcrumb` | Not supported; server-side PII scrubbing is automatic |
| `maxBreadcrumbs` | Fixed 100-slot ring buffer |

## Mixing native and compat

Sentori-native and Sentry-compat share state — same scope, same
transport, same identity layer. Mixing them is fine:

```ts
import sentori from '@goliapkg/sentori-react-native'
import * as Sentry from '@goliapkg/sentori-react-native/compat'

Sentry.init({ dsn: '…' })

// Use whichever syntax you prefer:
sentori.captureException(err)
Sentry.captureException(err)

sentori.setTag('feature.flag', 'on')
Sentry.setTag('feature.flag', 'on')
```

## When to migrate to native

You can stay on the compat layer indefinitely. The reason to
migrate to native:

- **You want `linkBy` for cross-project user lookup** — the
  compat layer maps `Sentry.setUser({ email })` to it, but native
  gives you the full multi-identity surface (`linkBy: { email,
  phone, googleSub, ... }`).
- **You want `startMoment`** — Sentori-specific funnel + abandonment
  semantics; no Sentry equivalent.
- **You want explicit `withScopedSpan`** — Sentry's `startSpan` v8
  shape works but Sentori's is cleaner.

There's no rush. Each compat hint cites the native equivalent at
the call site so you can migrate gradually.

## What's NOT supported

- Custom transports — Sentori has a single internal transport
- Hub manipulation (`getCurrentHub`, `setCurrentHub`) — Sentori
  doesn't expose Hub publicly
- `Sentry.Integrations.*` registration — use `init({ capture })` toggles
- `Sentry.Replay` integration — Sentori has its own `capture.replay: 'wireframe'`

If your existing Sentry code hits one of these, the compat
function throws a clear error pointing at the Sentori equivalent.

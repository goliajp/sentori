---
title: Scope API
description: setUser / setTag / setTags / addBreadcrumb — the ambient context every capture call carries.
---

The "scope" is the ambient context every `captureException` /
`captureMessage` snapshots onto the event it ships. Sentori does
not expose a `Hub` or `Scope` class — scope is module-scoped state
and the functions below mutate it directly.

```ts
import sentori from '@goliapkg/sentori-react-native'

sentori.setUser({ id: 'usr_42', linkBy: { email: 'a@b.com' } })
sentori.setTag('plan', 'pro')
sentori.addBreadcrumb({ type: 'nav', message: '/dashboard' })
```

## setUser

```ts
type User = {
  id?: string
  name?: string
  anonymous?: boolean
  linkBy?: Record<string, string>
}

function setUser(user: User | null): void
```

Identifies the current user. Pass `null` to clear (e.g. on
logout). `id` and `name` are stored raw — host's choice whether
to put real PII there. `linkBy` is the [identity layer](../privacy/identity.md):
each value is normalised + SubtleCrypto SHA-256 hashed on the
device; only the hash leaves the SDK.

Common shapes:

```ts
// Anonymous user with a stable client id.
sentori.setUser({ id: anonymousDeviceId, anonymous: true })

// Identified user with a cross-project lookup key.
sentori.setUser({
  id: 'usr_42',
  name: 'Lihao',
  linkBy: { email: user.email },
})

// Logout — clear the scope.
sentori.setUser(null)
```

### Well-known `linkBy` types

The SDK applies type-specific normalisation before hashing so the
same identity hashes to the same fingerprint regardless of casing
/ formatting:

| Key | Normalisation |
|---|---|
| `email` | Lowercase + trim. |
| `phone` | Strip non-digits, prefix `+`. (E.164 internalisation; passes any input format.) |
| `username` | Lowercase + trim. |
| `googleSub` / `appleSub` / `metaSub` | Trim only — sub claims are opaque. |
| Custom | Pass-through (host responsible for stability). |

## setTag / setTags

```ts
function setTag(key: string, value: string): void
function setTags(record: Record<string, string>): void
function clearTags(): void
```

Tags are scope-level key/value strings that ride along on every
subsequent event. They're indexed server-side for filtering +
grouping; keep cardinality reasonable.

```ts
sentori.setTag('plan', 'pro')
sentori.setTags({ feature: 'maps', rollout: 'wave-3' })
```

## addBreadcrumb

```ts
type BreadcrumbType = 'custom' | 'log' | 'nav' | 'net' | 'track' | 'user'

type BreadcrumbInput = {
  message?: string
  type?: BreadcrumbType
  level?: MessageLevel
  data?: Record<string, unknown>
}

function addBreadcrumb(crumb: BreadcrumbInput): void
function getBreadcrumbs(): Breadcrumb[]
function clearBreadcrumbs(): void
```

Breadcrumbs are a ring buffer of recent steps. The current snapshot
is sealed onto every captured event so the dashboard renders a
"leading up to" timeline.

Default ring capacity: 100. Buffer is FIFO — the oldest drops as
new ones land.

```ts
sentori.addBreadcrumb({
  type: 'nav',
  message: '/dashboard',
})

sentori.addBreadcrumb({
  type: 'user',
  message: 'tapped "Refresh"',
  data: { source: 'header-button' },
})

sentori.addBreadcrumb({
  type: 'net',
  message: 'GET /api/profile 200',
  data: { method: 'GET', status: 200, durationMs: 142 },
})
```

`type` axis is one of six well-known values; pick the closest fit.
Custom data lives on `data`, not on a parallel "category" axis
(Sentry's `category`+`type` overlap collapsed into one).

### Auto breadcrumbs

When the relevant `init.capture.*` flag is on, these breadcrumbs
fire automatically:

| Source | Type | Trigger |
|---|---|---|
| `init.capture.network` | `net` | every `fetch` / `xhr` round-trip |
| `init.capture.sessions` | `user` | app `active`/`background` transition |
| `useTraceNavigation` | `nav` | react-navigation route change |
| `sentori.track()` w/ `trackAutoBreadcrumb: true` | `track` | every `track()` call |

Host code can layer custom ones on top via `addBreadcrumb`.

## Why no `withScope(fn)` or `configureScope(fn)` (in native API)

Sentry's `Hub` / `Scope` abstraction is internal plumbing that
leaked into the public API. We hide it: `setTag(k, v)` /
`addBreadcrumb({...})` mutate the current (only) scope directly.

The Sentry-compat sub-package
(`@goliapkg/sentori-react-native/compat`) does expose
`Sentry.withScope(fn => fn.setTag(...))` for code an LLM has been
trained on — see [Sentry compat](../sentry-compat.md). The
`withScope`-style push/pop is implemented internally by the
compat layer.

## Related

- [`api/init`](./init.md) — `identity: true|false` toggle for the linkBy layer
- [`api/capture`](./capture.md) — what scope feeds into
- [`privacy/identity`](../privacy/identity.md) — `linkBy` audit

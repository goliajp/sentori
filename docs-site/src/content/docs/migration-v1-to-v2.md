---
title: Migrating to v2.3
description: SDK changes from v1.x → v2.x. Everything is additive — no required code changes.
---

# Migrating to v2.3

**TL;DR**: nothing in your existing v1.x code needs to change.
v2.x is strictly additive on the SDK surface. You can upgrade
the npm package and ship without touching app code.

This page documents what's *new* if you want to use the new
features.

## What's strictly additive

- `init({ logLevel, onReady })` — new optional fields; existing
  callers ignored them anyway because they didn't exist.
- `setUser({ linkBy, name })` — new optional fields; existing
  `setUser({ id, anonymous })` callers keep working unchanged.
- `captureMessage(msg, opts)` — new method; was not available in v1.x.
- `startTrace(name)` / `startSpan` / `withScopedSpan` /
  `startMoment` — new methods; v1.x had only auto-instrumented
  spans.
- `recordMetric`, `track`, `addBreadcrumb` — new methods.
- `flush()` / `close()` — new lifecycle methods. Returning
  promises; if your old code didn't await them, ignore.
- `@goliapkg/sentori-react-native/compat` — new sub-module, opt-in.

You do not need to do ANY of this on upgrade. Pick what's useful.

## What changed (without breaking your code)

### Default behaviour: silent

v1.x SDKs emitted `[sentori]` console.warn lines on init,
per-replay-tick, on breadcrumbs in dev mode. v2.3 is silent
unless something is genuinely broken (`logLevel: 'warn'` default
gates them out).

If you want the old verbose behaviour for debugging:

```ts
sentori.init({ ..., logLevel: 'debug' })
```

If your tests depended on seeing those lines, switch them to
test the actual behaviour rather than the console output.

### Sampling field renamed (alias kept)

```ts
// v1.x (still works, no deprecation)
sentori.init({ sampling: { traces: 0.1 } })

// v2.x canonical
sentori.init({ sample: { traces: 0.1 } })
```

If both fields are passed, `sample` wins. The `sampling` alias
stays accepted indefinitely.

### Identity fields on `setUser` are now hashed

The v1.x `User` type was strictly `{ id, anonymous }`. v2.x adds:

```ts
setUser({
  id: 'usr_123',                          // unchanged
  name: 'Lihao',                          // NEW — display only
  linkBy: {                               // NEW — hashed client-side
    email: 'lihao@example.com',
    googleSub: '108293…',
  },
})
```

Anything in `linkBy` is SHA-256 hashed by the SDK before any
network send. Raw values never leave the device. See
[Privacy & identity](./privacy/identity.md) for the full contract.

If you previously stored email in `id` (a few teams do this),
move it to `linkBy.email`:

```ts
// before (raw email stored on server)
setUser({ id: user.email })

// after (hashed; cross-project lookup works)
setUser({ id: `usr_${user.dbId}`, linkBy: { email: user.email } })
```

This is the only change in this guide that benefits from a
deliberate code update. Sentori never breaks the old shape;
moving emails out of `id` is a privacy upgrade you do when ready.

### Server-side back-compat

v1.x events keep ingesting verbatim. The server's `User` schema
gained optional `name` and `linkHashes` fields but kept
back-compat with v1.x clients sending only `id`/`anonymous`. v1
test suite (`server/tests/v1_compat.rs`) covers 11+ legacy
payload shapes; they all still parse to events.

## What's removed

Nothing. v2.x ships every v1.x method with the same signature.
The `withScopedSpan` rename to `withSpan` mentioned in the
intermediate v2.0 design was reverted (name collision with
internal trace-context helper).

## What's *deprecated* but still works

Nothing yet. v2.x marks no v1 surface as deprecated. The
intent is to keep additive expansion for the foreseeable future
— any future hard breaks will be v3 with a separate migration
guide and a 6-month overlap.

## Recommended upgrade order

For most apps:

```bash
bun install @goliapkg/sentori-react-native@latest
# or @goliapkg/sentori-react / -next / -vue / etc.
```

That's it. Deploy. Done.

For apps wanting v2.3's new surfaces:

1. Add `logLevel: 'warn'` to `init` (it's the default; this is
   just explicit). If you were debugging via console.warn lines
   in dev, switch to `logLevel: 'debug'` there.

2. Move PII identifiers from `id` to `linkBy`:

   ```ts
   setUser({ id: `usr_${dbId}`, linkBy: { email, googleSub } })
   ```

3. (Optional) Wire `onReady` instead of scanning the console:

   ```ts
   sentori.init({
     token, release,
     onReady: (info) => {
       analytics.track('sentori_live', { sdk: info.sdkVersion })
     },
   })
   ```

4. (Optional) Use the new `captureMessage` for non-exception
   reports:

   ```ts
   sentori.captureMessage('cold start finished', { level: 'info' })
   ```

5. (Optional) Manual traces / spans for business-flow timing:

   ```ts
   await sentori.withScopedSpan('checkout', async () => {
     await chargePayment()
     await shipNotification()
   })
   ```

Each step is independent. Cherry-pick.

## Migrating from Sentry (not from v1 Sentori)

If you're coming from `@sentry/react-native`, the v2.3 compat
layer is a drop-in:

```ts
// before:
import * as Sentry from '@sentry/react-native'

// after:
import * as Sentry from '@goliapkg/sentori-react-native/compat'
```

Most calls work unchanged. See [Sentry compat](./sentry-compat.md)
for the translation table + the privacy implications of
`setUser({ email })` (Sentori hashes it; Sentry stored raw).

## After upgrading

- Dashboard's Users page (new in v2.3) takes raw value → hashes
  → cross-project lookup. See [Privacy & identity](./privacy/identity.md).
- Sidebar footer shows `vX.Y.Z · <git-sha>`; if you see `rc`
  strings, the deploy didn't pick up the new bundle (clear CDN
  cache).
- Server version (Overview "build N") and dashboard version
  bump in lockstep — same version after a deploy.

## Questions

File an issue at github.com/goliajp/sentori with a concrete
shape. We track migration friction explicitly.

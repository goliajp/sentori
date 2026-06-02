---
title: v1 → v2 migration
description: Upgrade from @goliapkg/sentori-*@1.x to 2.x — what renamed, what moved, what's new, and what you can safely leave alone.
---

# v1 → v2 migration

v2 is a clean redesign of the SDK surface. The wire format and server are forever back-compat — your v1 SDK keeps reporting against a v2 server, and a v2 SDK reports against a v1 server. Migrating to the v2 SDK is purely about adopting nicer APIs.

There are no behavior surprises: every change in this guide is **syntactic** (renaming, dropping aliases, moving advanced surfaces behind subpaths) plus three **additive** new APIs (`captureMessage`, the formal `startSpan` / `withSpan` / `startTrace` surface, and `recordMetric(..., { parent })`).

## TL;DR

```bash
bun add @goliapkg/sentori-react-native@^2.0
# or: npm install @goliapkg/sentori-react-native@^2.0
```

…then run the codemod section below — six search-replaces total — and you're done. Estimated effort for a typical app: **15 minutes**.

## Renamed APIs (the hard breaks)

`@goliapkg/sentori-*@1.x` exported a few v0-era aliases. v2 removes them.

| v1 callsite | v2 callsite | Why |
|---|---|---|
| `sentori.captureError(err)` | `sentori.captureException(err)` | `captureException` matches the verb every other SDK in the industry uses; `captureError` was a v0 holdover. |
| `sentori.initSentori({ ... })` | `sentori.init({ ... })` | The `Sentori` prefix is redundant inside the `sentori.*` namespace. |
| `span.finish()` | `span.end()` | OTel-aligned. v2 `Span` also gains `.setAttribute()` / `.setStatus()` / `.recordException()` / `.isRecording()`. |
| `sentori.addBreadcrumb('user clicked Buy', { route: 'cart' })` | `sentori.addBreadcrumb({ type: 'user', data: { message: 'clicked Buy', route: 'cart' } })` | Positional form silently muddled `type` and `data`. v2 takes a single object so the breadcrumb shape is explicit. |
| `Event` type import | `SentoriEvent` type import | `Event` collides with the DOM `Event` interface — TypeScript users couldn't import both. |
| `SpanHandle` / `MomentHandle` types | `Span` / `Moment` (returned by `startSpan` / `startMoment`) | The `Handle` suffix was internal vocabulary that leaked. |

### Codemod

For most repos this is six `find`/`replace`-all commands:

```bash
# From the repo root:
git ls-files '*.ts' '*.tsx' '*.js' '*.jsx' | xargs sed -i.bak -E \
  -e 's/\bsentori\.captureError\b/sentori.captureException/g' \
  -e 's/\bsentori\.initSentori\b/sentori.init/g' \
  -e 's/\.finish\(\)/.end()/g'
git ls-files '*.ts' '*.tsx' | xargs sed -i.bak -E \
  -e 's/\bSpanHandle\b/Span/g' \
  -e 's/\bMomentHandle\b/Moment/g'
# Event → SentoriEvent ONLY if you actually import the SDK's Event:
# manual review recommended (the DOM has its own `Event`).
```

`.finish()` is unsafe to mass-rename if your code calls `.finish()` on non-Sentori objects (e.g. a third-party stream). Review the resulting diff before committing.

The positional-`addBreadcrumb` rewrite has no clean regex form — every callsite has its own shape. v2 throws a TypeScript error at the old shape, so the compile will tell you exactly which lines to fix. Expect 1–3 minutes per callsite.

## Moved APIs (subpath imports)

Advanced surfaces that pulled in a component tree or pulled in a Sentry-shaped compat layer now live behind subpath imports. Importing them via the top-level barrel still works for one more release cycle (so you can upgrade without a code change), but new code should reach for the subpath so the bundle only pays for what it uses.

```diff
- import { FeedbackButton } from '@goliapkg/sentori-react-native'
+ import { FeedbackButton } from '@goliapkg/sentori-react-native/feedback'

- import { Sentry } from '@goliapkg/sentori-react-native'
+ import { Sentry } from '@goliapkg/sentori-react-native/compat'
```

Both subpaths are TypeScript- and bundler-resolved (Metro / Vite / Webpack / esbuild all honor the `exports` map in `package.json`).

## Additive — new in v2

Three new APIs you didn't have before. All optional; ignoring them is fine, but each one closes a gap v1 customers complained about.

### `captureMessage` — issues without a thrown `Error`

```ts
sentori.captureMessage('Payment provider returned 500, used fallback', {
  level: 'warning',
  tags: { feature: 'checkout' },
})
```

Lands in the dashboard's **Issues** module alongside thrown errors. See `recipes/manual-issue.md` for the full level guide.

### Formal `Span` / `Trace` surface

```ts
const trace = sentori.startTrace('checkout-flow')
const span = sentori.startSpan({ name: 'db.query users', parent: trace })
try {
  await queryUsers()
  span.setStatus('ok')
} finally {
  span.end()
  trace.end()
}

// or, scoped:
await sentori.withSpan({ name: 'db.query users' }, async () => {
  return queryUsers()
})
```

v1 had ad-hoc helpers (`sentori.measure(...)`, `sentori.traceFetch(...)`) — those still work and now compose with `Span`. See `recipes/manual-span.md` and `recipes/manual-trace.md`.

### `recordMetric(..., { parent })` — tie a metric to its emitting span

```ts
await sentori.withSpan({ name: 'db.query users' }, async (span) => {
  const t0 = performance.now()
  const rows = await queryUsers()
  sentori.recordMetric('db.users.row_count', rows.length, undefined, { parent: span })
  sentori.recordMetric('db.users.duration_ms', performance.now() - t0, undefined, { parent: span })
  return rows
})
```

The dashboard's trace detail view renders these as a **related metrics row** under the span that emitted them — see `recipes/track-and-metrics.md`.

## Behaviour change — `track` auto-breadcrumb

v2 adds one **opt-in** behaviour upgrade you'll probably want on:

```diff
  sentori.init({
    token, release, environment, ingestUrl,
+   capture: {
+     trackAutoBreadcrumb: true,
+   },
  })
```

With this on, every `sentori.track(name, props)` call also pushes a `{ type: 'track', data: { name, props } }` breadcrumb. When a `captureException` fires shortly after, you see the customer's last N tracked actions in the issue detail — the journey leading up to the failure.

It defaults `false` to preserve v1 breadcrumb shape on upgrade (your existing customer breadcrumb dashboards keep their counts and ratios). Set it `true` for new integrations and during migration windows where you can stomach a breadcrumb-volume bump.

## What you can safely leave alone

- **`sentori.captureException(err, opts?)`** — same signature, same payload, same dashboard treatment.
- **`sentori.init({ ... })` options** — every v1 option still works. v2 adds `capture.trackAutoBreadcrumb` and a few more capture toggles (`longTaskMonitor`, `replay`, `preCrashSentinel` were already in v1.x).
- **The wire format.** Every event you posted under v1 still parses and lands on a v2 server unchanged. Mixed-version fleets are supported.
- **Breadcrumb buffer** — same bounded ring, same default cap (100), same FIFO eviction. The drop-in `BreadcrumbBuffer` class is still exported from `@goliapkg/sentori-core` for hosts that want per-instance buffers.
- **`sentori.setUser` / `setTag` / `setTags`** — same shape; same global-scope merge into every subsequent capture.
- **`sentori.flush(ms?)` / `sentori.close()`** — same shape. v2 just makes them more reliable on CLI / Lambda shutdown.

## Per-package quick reference

| Package | v2 version | Notable changes besides the renamings above |
|---|---|---|
| `@goliapkg/sentori-core` | 2.0.0 | Exports `addBreadcrumb` / `BreadcrumbBuffer` / `clearBreadcrumbs` / `getBreadcrumbs` from the namespace (v1 was internal-only). |
| `@goliapkg/sentori-react-native` | 2.0.0 | `./feedback` subpath. `track` auto-breadcrumb knob in `init`. `recordMetric` accepts `{ parent }`. |
| `@goliapkg/sentori-javascript` | 2.0.0 | Same renamings; `addBreadcrumb` already in v1 surface. |
| `@goliapkg/sentori-react` / `-vue` / `-svelte` / `-solid` / `-next` / `-expo` | 2.0.0 | Re-export of the above. No framework-specific renamings. |

## Rolling out

We deploy our own dogfood SDK on the SaaS dashboard following this exact plan:

1. **Stage 1 (lockstep upgrade):** `npm install @goliapkg/sentori-*@^2.0` across the matrix; run the codemod; ship to staging. Run the regression suite. Time: 30 min.
2. **Stage 2 (opt into trackAutoBreadcrumb):** add `capture: { trackAutoBreadcrumb: true }` to `sentori.init`. Watch the issue detail "breadcrumb count" stat — typical bump is +10–30 % per event, well within the 100-breadcrumb cap.
3. **Stage 3 (adopt new APIs):** start emitting `captureMessage` for the "operator should know" cases that previously didn't fit anywhere. Adopt `withSpan` + `recordMetric({ parent })` for the hot codepaths you've been wanting tracing on.

If anything breaks during stage 1 we want to know — file an issue at <https://github.com/goliajp/sentori/issues> with the `v2-migration` label.

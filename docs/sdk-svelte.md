---
title: Svelte SDK
description: SvelteKit handleError hook + navigation tracing
---

# Sentori Svelte SDK

`@goliapkg/sentori-svelte` is the Svelte / SvelteKit adapter on top of
`@goliapkg/sentori-javascript`. It is intentionally small — most of
your needs map to two SvelteKit-native primitives we hook into:

- `initSentori(opts)` — thin wrapper over the JS SDK init.
- `sentoriHandleError()` — returns a `HandleClientError`-shaped
  function you assign to `export const handleError` in
  `hooks.client.ts` (or `hooks.server.ts`).
- `traceNavigation($navigating)` — pass SvelteKit's `$navigating`
  store value and we open / finish `svelte.navigation` spans per
  route transition.

```bash
bun add @goliapkg/sentori-svelte
# or
npm install @goliapkg/sentori-svelte
```

Peer dep: `svelte >= 4`. SvelteKit is **not** a hard peer dep —
the adapter only relies on the shape of `$navigating` and the
`HandleClientError` callback contract, both of which are stable
back to SvelteKit 1.x.

## SvelteKit setup

```ts
// src/hooks.client.ts
import { initSentori, sentoriHandleError } from '@goliapkg/sentori-svelte'
import { PUBLIC_SENTORI_TOKEN, PUBLIC_RELEASE } from '$env/static/public'

initSentori({
  token: PUBLIC_SENTORI_TOKEN,
  release: PUBLIC_RELEASE,
  ingestUrl: 'https://ingest.sentori.golia.jp',
})

export const handleError = sentoriHandleError()
```

For server hooks (`hooks.server.ts`) you can call `initSentori` the
same way; Node and the browser share the JS SDK, so the same shape
works in both.

### Navigation tracing

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
  import { navigating } from '$app/stores'
  import { traceNavigation } from '@goliapkg/sentori-svelte'
  $: traceNavigation($navigating)
</script>

<slot />
```

When `$navigating` becomes non-null (a route is about to load) we
open a span; when it returns to `null` (load finished) we close it.
Spans are tagged with `nav.from` / `nav.to`.

## Vanilla Svelte (no SvelteKit)

Call `initSentori` from your app's entry, then use Svelte 5's
built-in `<svelte:boundary>`:

```svelte
<svelte:boundary onerror={(e) => captureException(e)}>
  <App />
</svelte:boundary>
```

For Svelte 4 wrap your top-level component with a try / catch around
event handlers and forward to `captureException` explicitly.

## Imperative capture

The package re-exports the imperative surface from
`@goliapkg/sentori-javascript`:

```ts
import { captureException, addBreadcrumb, setUser } from '@goliapkg/sentori-svelte'
```

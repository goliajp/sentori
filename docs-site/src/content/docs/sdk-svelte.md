---
title: SDK — Svelte (planned)
description: Svelte 5 / runes API surface design — TBD v0.3+
---

# Svelte SDK — design preview

Status: **planned for v0.3+**. Surface locked here so the eventual
implementation stays minimal.

Svelte 5 with runes is the target. The SDK will adapt
`@goliapkg/sentori-javascript` for SvelteKit's mixed
client / server / edge runtime story.

## Package shape

```
@goliapkg/sentori-svelte
  peer: svelte ≥ 5
        @sveltejs/kit ≥ 2 (optional, for the SvelteKit hooks)
  dep:  @goliapkg/sentori-javascript
        @goliapkg/sentori-core
```

## Public API

### Vanilla Svelte 5

```svelte
<script lang="ts">
  import { initSentori, setUser } from '@goliapkg/sentori-svelte'

  initSentori({
    token: import.meta.env.VITE_SENTORI_TOKEN,
    release: 'myapp@1.2.3',
    environment: 'prod',
  })
</script>
```

`initSentori` is a thin re-export of the JS SDK's init; the package
exports the same `setUser` / `addBreadcrumb` / `captureError`
helpers verbatim so a single import gets you everything.

### Error boundary component

```svelte
<script lang="ts">
  import { SentoriErrorBoundary } from '@goliapkg/sentori-svelte'
</script>

<SentoriErrorBoundary>
  {#snippet fallback({ error, reset })}
    <p>oops: {error.message}</p>
    <button onclick={reset}>retry</button>
  {/snippet}
  <App />
</SentoriErrorBoundary>
```

Uses Svelte 5's snippet API for the fallback. The boundary catches
errors thrown in child components by listening to the `error` event
on a wrapping `<svelte:boundary>` and forwards them to `captureError`
with `tags: { source: 'svelte.errorBoundary' }`.

### SvelteKit integration

Both `hooks.server.ts` and `hooks.client.ts` get one-line wiring:

```ts
// hooks.server.ts
export { handleError } from '@goliapkg/sentori-svelte/sveltekit-server'

// hooks.client.ts
export { handleError } from '@goliapkg/sentori-svelte/sveltekit-client'
```

Each `handleError` follows SvelteKit's signature
(`{ error, event, status, message }`) and forwards the error to
`captureError` with route + status tags.

## Notes / considerations

- **Action errors**: SvelteKit's form actions return errors as part
  of the response shape; we don't auto-capture those because they're
  often domain-level "expected" failures. Users can manually
  `captureError(err, { tags: { stage: 'action' } })` from the action
  body when they want.
- **Stores breadcrumbs**: opt-in plugin
  `@goliapkg/sentori-svelte/store-breadcrumbs` that emits a
  breadcrumb on every store update. Tree-shakable side import.
- **Edge runtime**: SvelteKit edge has `globalThis.fetch` but no
  `process.on(...)`. The SDK detects this and skips Node hooks the
  same way `sentori-next/server` does on the edge.

Track v0.3 progress in the [ROADMAP](https://github.com/goliajp/sentori/blob/main/ROADMAP.md).

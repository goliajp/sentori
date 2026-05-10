---
title: SDK — Vue (planned)
description: Vue 3 / Composition API surface design — TBD v0.3+
---

# Vue SDK — design preview

Status: **planned for v0.3+**. This page locks the public surface so
the implementation stays small when it lands.

The Vue SDK will be a thin adapter on top of
`@goliapkg/sentori-javascript` (same pattern as
`@goliapkg/sentori-react`): all the heavy lifting lives in the JS
SDK; the Vue package adds a plugin, a global error handler, and
composable hooks.

## Package shape

```
@goliapkg/sentori-vue
  peer: vue ≥ 3.4
  dep:  @goliapkg/sentori-javascript
        @goliapkg/sentori-core
```

## Public API

```ts
import { createApp } from 'vue'
import { sentoriPlugin } from '@goliapkg/sentori-vue'

const app = createApp(App)

app.use(sentoriPlugin, {
  token: import.meta.env.VITE_SENTORI_TOKEN,
  release: 'myapp@1.2.3',
  environment: 'prod',
  // ingestUrl, enableGlobalHooks — same options as JS SDK
})
```

`sentoriPlugin` does three things:

1. Calls `initSentori(options)` once.
2. Sets `app.config.errorHandler` to forward render-time errors to
   `captureError` with `tags: { source: 'vue.errorHandler' }`. If the
   user already set one, ours wraps it (calls theirs after capture).
3. Provides a `Symbol` injection key so composables below can pull
   the SDK without re-importing.

### Composables

```ts
import { useSentori, useCaptureError } from '@goliapkg/sentori-vue'

const { captureError, addBreadcrumb, setUser } = useSentori()

const checkout = useCaptureError(
  async (order: Order) => api.checkout(order),
  { tags: { stage: 'checkout' } },
)
```

- `useSentori()` — equivalent of the React hook; returns the same
  context value.
- `useCaptureError(fn, extras?)` — async wrapper. Same semantics as
  React: captures + rethrows.

### Component

```vue
<template>
  <SentoriErrorBoundary>
    <template #fallback="{ error, reset }">
      <p>oops: {{ error.message }}</p>
      <button @click="reset">retry</button>
    </template>
    <App />
  </SentoriErrorBoundary>
</template>
```

The component uses Vue's `errorCaptured` lifecycle hook (return
`false` to swallow), captures the error, and switches to the named
slot. `reset` is a function that clears the captured state.

## What's left to design

- **Nuxt 3 module**: similar to `@goliapkg/sentori-next`. Likely
  ships as `@goliapkg/sentori-nuxt` with a single `nuxt.config.ts`
  module entry that wires both server and client. Defer to v0.3+
  alongside the Vue SDK.
- **Pinia integration**: opt-in plugin that emits a breadcrumb on
  every mutation. Probably a separate `@goliapkg/sentori-pinia`
  package to keep it tree-shakable.
- **Router error capture**: hook into `vueRouter.onError` so
  navigation guard failures land too. Lives in the Vue SDK directly.

Track v0.3 progress in the [ROADMAP](https://github.com/goliajp/sentori/blob/main/ROADMAP.md).

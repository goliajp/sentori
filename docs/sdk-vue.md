---
title: Vue SDK
description: Vue 3 plugin, errorHandler, router tracing, and ErrorBoundary
---

# Sentori Vue SDK

`@goliapkg/sentori-vue` is the Vue 3 adapter on top of
`@goliapkg/sentori-javascript`. It exposes:

- A Vue plugin you mount once via `app.use(sentori, opts)` — boots the
  JS SDK and wires `app.config.errorHandler` for render-phase errors.
- `<SentoriErrorBoundary>` — `errorCaptured`-based wrapper that
  forwards thrown errors into Sentori and renders a `fallback` slot.
- `setupTraceNavigation(router)` — Vue Router integration that opens
  one `vue.navigation` span per route transition.

```bash
bun add @goliapkg/sentori-vue
# or
npm install @goliapkg/sentori-vue
```

Peer deps: `vue >= 3.4`. `vue-router >= 4` is optional and only needed
if you use `setupTraceNavigation`.

## Plugin

```ts
import { createApp } from 'vue'
import sentori from '@goliapkg/sentori-vue'
import App from './App.vue'

const app = createApp(App)
app.use(sentori, {
  token: import.meta.env.VITE_SENTORI_TOKEN,
  release: `myapp@${import.meta.env.VITE_RELEASE}`,
  environment: import.meta.env.MODE,
  ingestUrl: 'https://ingest.sentori.golia.jp',
  sampling: { errors: 1.0, traces: 0.2 },
})
app.mount('#app')
```

`app.use(sentori, opts)`:

1. Forwards `opts` to `initSentori` from `@goliapkg/sentori-javascript`.
2. Wraps the existing `app.config.errorHandler` so any error thrown
   in a render / lifecycle hook reaches `captureException`.
3. Tags every Sentori event with `tags.vue.component` and
   `tags.vue.errorInfo` so the dashboard can show *where* in your
   component tree the error originated.

The wrapper chains to any handler already on `app.config.errorHandler`,
so other plugins keep working.

## `<SentoriErrorBoundary>`

```vue
<script setup lang="ts">
import { SentoriErrorBoundary } from '@goliapkg/sentori-vue'
</script>

<template>
  <SentoriErrorBoundary :ignore="['NavigationDuplicated']">
    <template #default>
      <RouterView />
    </template>
    <template #fallback="{ error, reset }">
      <section class="error">
        <h2>Something broke.</h2>
        <pre>{{ error.message }}</pre>
        <button @click="reset">Retry</button>
      </section>
    </template>
  </SentoriErrorBoundary>
</template>
```

Props:

| Prop | Type | Notes |
|---|---|---|
| `ignore` | `readonly string[]` | List of `error.name` values that bubble up to a parent boundary unchanged (handy for routing errors like `NavigationDuplicated`). |

Slots:

| Slot | Payload | Notes |
|---|---|---|
| `default` | — | The guarded subtree. |
| `fallback` | `{ error, reset }` | Rendered after a capture. Call `reset()` to clear the caught error and re-render the default slot. |

When no `fallback` slot is provided the boundary renders an empty
`<span data-sentori-boundary-error="true">` placeholder so the rest
of the app keeps running while the crashed subtree is hidden.

## Vue Router tracing

```ts
import { createRouter, createWebHistory } from 'vue-router'
import { setupTraceNavigation } from '@goliapkg/sentori-vue/router'

const router = createRouter({ history: createWebHistory(), routes })
setupTraceNavigation(router)
```

`setupTraceNavigation` opens a `vue.navigation` span on `beforeEach`
and finishes it on `afterEach`, tagging it with `nav.from` / `nav.to`
paths. Pair it with `sampling.traces` to keep the volume in check on
large apps.

## Imperative capture

The package re-exports the imperative surface from
`@goliapkg/sentori-javascript`:

```ts
import { captureException, addBreadcrumb, setUser } from '@goliapkg/sentori-vue'
```

Use these for non-render-phase errors (async actions, store mutations
inside Pinia, etc.) — `app.config.errorHandler` only catches errors
that propagate up the render / lifecycle path.

---
title: SolidJS SDK
description: ErrorBoundary onCatch helper + solid-router tracing
---

# Sentori SolidJS SDK

`@goliapkg/sentori-solid` is the SolidJS adapter on top of
`@goliapkg/sentori-javascript`. Solid is small enough that the
adapter only ships two helpers on top of the JS SDK:

- `initSentori(opts)` — thin wrapper over the JS SDK init.
- `sentoriOnCatch(err)` — pass to Solid's built-in
  `<ErrorBoundary onCatch={...}>`.
- `traceSolidRouter(pathname)` — call from a `createEffect` whenever
  `useLocation().pathname` changes; opens one `solid.navigation`
  span per route transition.

```bash
bun add @goliapkg/sentori-solid
# or
npm install @goliapkg/sentori-solid
```

Peer dep: `solid-js >= 1.8` (optional — only needed if you use
`<ErrorBoundary>`).

## App setup

```tsx
import { ErrorBoundary, render } from 'solid-js/web'
import { initSentori, sentoriOnCatch } from '@goliapkg/sentori-solid'
import App from './App'

initSentori({
  token: import.meta.env.VITE_SENTORI_TOKEN,
  release: `myapp@${import.meta.env.VITE_RELEASE}`,
  ingestUrl: 'https://ingest.sentori.golia.jp',
})

render(
  () => (
    <ErrorBoundary
      fallback={(err, reset) => (
        <section>
          <h2>Something broke.</h2>
          <pre>{err.message}</pre>
          <button onClick={reset}>Retry</button>
        </section>
      )}
      onCatch={sentoriOnCatch}
    >
      <App />
    </ErrorBoundary>
  ),
  document.getElementById('root')!,
)
```

`sentoriOnCatch` normalises non-`Error` throws (strings, plain
objects) before forwarding to `captureException`, so you do not need
to wrap them yourself.

## solid-router navigation tracing

```tsx
import { useLocation } from '@solidjs/router'
import { createEffect } from 'solid-js'
import { traceSolidRouter } from '@goliapkg/sentori-solid'

export function AppShell() {
  const loc = useLocation()
  createEffect(() => traceSolidRouter(loc.pathname))
  return <Outlet />
}
```

The effect re-runs whenever `loc.pathname` changes, which is the
SolidJS-idiomatic way to wire a navigation event. The adapter
short-circuits when the new pathname matches the previous one, so
re-running the effect during HMR or in a Suspense boundary does not
double-span.

## Imperative capture

The package re-exports the imperative surface from
`@goliapkg/sentori-javascript`:

```ts
import { captureException, addBreadcrumb, setUser } from '@goliapkg/sentori-solid'
```

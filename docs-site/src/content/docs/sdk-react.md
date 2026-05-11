---
title: React SDK
description: Provider, ErrorBoundary, and hooks for React 18+
---

# Sentori React SDK

`@goliapkg/sentori-react` is the React adapter on top of
`@goliapkg/sentori-javascript`. It exposes:

- `<SentoriProvider>` — drop near the root, initialises the JS SDK
- `<SentoriErrorBoundary>` — class boundary wired to `captureError`
- `useSentori()` / `useCaptureError()` — hooks for imperative capture

```bash
bun add @goliapkg/sentori-react
# or
npm install @goliapkg/sentori-react
```

Peer dependency: `react >= 18`.

## Provider

```tsx
import { SentoriProvider } from '@goliapkg/sentori-react'

export function Root() {
  return (
    <SentoriProvider
      config={{
        token: import.meta.env.VITE_SENTORI_TOKEN,
        release: `myapp@${import.meta.env.VITE_RELEASE}`,
        environment: import.meta.env.MODE,
        ingestUrl: 'https://ingest.sentori.golia.jp',
      }}
    >
      <App />
    </SentoriProvider>
  )
}
```

The provider is idempotent under React `StrictMode` double-mount.

## `<SentoriErrorBoundary>`

Class component that catches render-phase errors in its subtree,
forwards them to `captureError`, and renders a fallback.

### Props

| Prop | Type | Required | Notes |
|---|---|---|---|
| `fallback` | `ReactNode \| (props: { error, reset }) => ReactNode` | ✅ | Static node or render-prop. Use the render-prop form when you need access to `error` / `reset`. |
| `onError` | `(error, info) => void` | — | Runs **after** Sentori capture. Use for app-side logging, never for capture (the boundary already captures). |
| `resetKeys` | `unknown[]` | — | Shallow-compared on update. Any change clears the caught error so children re-render. Use a route path, a query key, or a user id. |
| `children` | `ReactNode` | ✅ | The subtree to guard. |

### Recipe 1 — Per-route fallback

Wrap each route so a thrown error scoped to that route doesn't kill
the whole app shell.

```tsx
import { Route, Routes, useLocation } from 'react-router'
import { SentoriErrorBoundary } from '@goliapkg/sentori-react'

function RouteBoundary({ children }: { children: React.ReactNode }) {
  const location = useLocation()
  return (
    <SentoriErrorBoundary
      fallback={<RouteErrorScreen />}
      resetKeys={[location.pathname]}
    >
      {children}
    </SentoriErrorBoundary>
  )
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RouteBoundary><Home /></RouteBoundary>} />
      <Route path="/orders" element={<RouteBoundary><Orders /></RouteBoundary>} />
    </Routes>
  )
}
```

`resetKeys={[location.pathname]}` makes navigating away from the
broken page clear the boundary automatically — the user doesn't have
to click a retry button.

### Recipe 2 — Retry button

Use the render-prop form to surface `reset` to the user.

```tsx
<SentoriErrorBoundary
  fallback={({ error, reset }) => (
    <div className="error-card">
      <h2>Something went wrong.</h2>
      <p>{error.message}</p>
      <button onClick={reset} type="button">
        Try again
      </button>
    </div>
  )}
>
  <DataTable />
</SentoriErrorBoundary>
```

For a flaky data fetch, pair this with `resetKeys={[queryKey]}` so
a fresh query also recovers the boundary even without the click.

### Recipe 3 — "Report this" feedback button

`onError` runs after Sentori has already captured the event, so you
can grab a correlation id and offer a feedback hook.

```tsx
import { useState } from 'react'

function ReportableBoundary({ children }: { children: React.ReactNode }) {
  const [eventId, setEventId] = useState<string | null>(null)

  return (
    <SentoriErrorBoundary
      fallback={({ error, reset }) => (
        <div className="error-card">
          <h2>{error.message}</h2>
          {eventId && <small>Report id: {eventId}</small>}
          <button
            onClick={() => openFeedbackModal(eventId)}
            type="button"
          >
            Report this
          </button>
          <button onClick={reset} type="button">Dismiss</button>
        </div>
      )}
      onError={(_err, _info) => {
        // crypto.randomUUID is supported in every browser Sentori targets.
        setEventId(crypto.randomUUID())
      }}
    >
      {children}
    </SentoriErrorBoundary>
  )
}
```

The "report id" is a client-side correlation id you generate; pair
it with a server-side feedback endpoint or paste it directly into a
support ticket so engineering can correlate against the captured
event.

## Hooks

```tsx
import { useCaptureError, useSentori } from '@goliapkg/sentori-react'

function PayButton() {
  const capture = useCaptureError()
  const { addBreadcrumb } = useSentori()

  return (
    <button
      onClick={async () => {
        addBreadcrumb('user', { action: 'pay.click' })
        try {
          await pay()
        } catch (err) {
          capture(err as Error, { tags: { feature: 'checkout' } })
        }
      }}
      type="button"
    >
      Pay
    </button>
  )
}
```

`useSentori()` returns the full context value (capture, breadcrumb,
setUser, setTags). `useCaptureError()` is a shortcut for the common
case.

## What this SDK is not

It is not a `Suspense` wrapper, not a router integration, and not a
profiler. Those are tracked separately:

- Router auto-breadcrumbs → see [`react-router` integration](#) (added in Phase 31 sub-B)
- Suspense / RSC error capture → see [`<SentoriSuspense>`](#) (added in Phase 31 sub-C)

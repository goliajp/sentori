---
title: Suspense, RSC, and streaming
description: Error capture across React 19's data-fetching surfaces
---

# Suspense, RSC, and streaming

React 19's data fetching has three error surfaces: classic
`<Suspense>` on the client, React Server Components on the server,
and streaming SSR (Next.js's `loading.tsx` + `error.tsx` pair).
Sentori captures all three; the difference is where the boundary
lives.

## Client-side Suspense

Use `<SentoriSuspense>` — it composes `<Suspense>` with
`<SentoriErrorBoundary>`. A synchronous throw or a rejected
`use(promise)` from inside is caught and forwarded to
`captureError`.

```tsx
import { SentoriSuspense } from '@goliapkg/sentori-react'

<SentoriSuspense
  errorFallback={<ErrorCard />}
  fallback={<Skeleton />}
>
  <UserProfile />
</SentoriSuspense>
```

Without the wrapper:

```tsx
<SentoriErrorBoundary fallback={<ErrorCard />}>
  <Suspense fallback={<Skeleton />}>
    <UserProfile />
  </Suspense>
</SentoriErrorBoundary>
```

## React Server Components

RSC throws happen on the server. They never reach a React boundary
on the client — they're surfaced through Next's `instrumentation.ts`
`onRequestError` hook instead.

```ts
// instrumentation.ts
export { register, onRequestError } from '@goliapkg/sentori-next/instrumentation'
```

`onRequestError` attaches:

- `next.route` (the failing route's path)
- `next.method` (HTTP method)
- `next.runtime` (`nodejs` | `edge`)
- `source = 'next.requestError'`

A server-side throw inside a `<UserProfile />` RSC shows up in the
dashboard with the original (already-symbolicated) stack — no
source map upload needed for server code, because the server bundle
keeps its sources by default.

## Streaming SSR — loading.tsx + error.tsx

Next.js streams the response as RSC subtrees resolve. If a subtree
inside `<Suspense>` rejects mid-stream, Next replaces it with the
nearest `error.tsx`.

```tsx
// app/dashboard/loading.tsx
export default function Loading() {
  return <Skeleton />
}

// app/dashboard/error.tsx
'use client'
import { useReportNextError } from '@goliapkg/sentori-next/app-router'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useReportNextError(error)
  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={reset} type="button">Try again</button>
    </div>
  )
}
```

`useReportNextError` picks up `error.digest` (Next's correlation id
between the server-side stack and the client report) and attaches
it as a tag. On the dashboard, the server event (captured by
`onRequestError`) and the client event (captured by
`useReportNextError`) carry the same `next.digest` value, so you
can pivot between them.

## Where each surface lands

| Surface | Caught by | Tags |
|---|---|---|
| Client `<Suspense>` throw | `<SentoriSuspense>` / `<SentoriErrorBoundary>` | `source=react.errorBoundary` |
| `use(rejectedPromise)` | same | same |
| RSC throw (server) | `instrumentation.ts:onRequestError` | `source=next.requestError`, `next.runtime`, `next.route` |
| Streaming subtree reject | server side as above + client `error.tsx` → `useReportNextError` | both, correlated by `next.digest` |
| Loader / route handler | `onRequestError` | as above |

## Don't put Sentori inside Suspense fallback

The Provider must be **outside** the Suspense boundary, in a stable
location. Don't do this:

```tsx
// 🚫 SentoriProvider unmounts every time the boundary suspends
<Suspense fallback={<Spinner />}>
  <SentoriProvider config={config}>
    <App />
  </SentoriProvider>
</Suspense>
```

```tsx
// ✅
<SentoriProvider config={config}>
  <Suspense fallback={<Spinner />}>
    <App />
  </Suspense>
</SentoriProvider>
```

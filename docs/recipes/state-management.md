---
title: State management
description: Wrap captureError around Redux, Zustand, and TanStack Query
---

# State management

Three idiomatic ways to wire `captureError` into the most common
state libraries in the React ecosystem. None require library forks.

## Redux

Drop a middleware between your reducer and your action dispatch.
Catches any throw from a reducer **or** from a thunk, attaches the
action's `type` as a tag, and re-throws so the rest of the stack
still sees the error.

```ts
import { captureError } from '@goliapkg/sentori-javascript'
import type { Middleware } from '@reduxjs/toolkit'

export const sentoriMiddleware: Middleware = () => (next) => (action) => {
  try {
    return next(action)
  } catch (err) {
    captureError(err as Error, {
      tags: {
        'redux.action': (action as { type?: string }).type ?? 'unknown',
        source: 'redux.middleware',
      },
    })
    throw err
  }
}
```

Wire it:

```ts
import { configureStore } from '@reduxjs/toolkit'
import { sentoriMiddleware } from './sentori-middleware'

const store = configureStore({
  reducer: rootReducer,
  middleware: (getDefault) => getDefault().concat(sentoriMiddleware),
})
```

## Zustand

Zustand stores expose `subscribe` and accept a middleware-style
wrapper. The cleanest pattern is a small wrapper around `create`
that catches any throw inside a `set` callback or selector.

```ts
import { captureError } from '@goliapkg/sentori-javascript'
import { create, type StateCreator } from 'zustand'

function withSentori<T>(initializer: StateCreator<T>): StateCreator<T> {
  return (set, get, api) =>
    initializer(
      (partial, replace) => {
        try {
          return (set as typeof set & ((p: unknown, r?: boolean) => void))(partial, replace as boolean)
        } catch (err) {
          captureError(err as Error, { tags: { source: 'zustand.set' } })
          throw err
        }
      },
      get,
      api,
    )
}

export const useCart = create(
  withSentori<{ items: string[]; add: (id: string) => void }>((set) => ({
    items: [],
    add: (id) => set((s) => ({ items: [...s.items, id] })),
  })),
)
```

## TanStack Query

TanStack Query already routes errors through its `onError` callback.
Wire it once at the `QueryClient` level so every query / mutation
flows through Sentori.

```ts
import { captureError } from '@goliapkg/sentori-javascript'
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      captureError(error as Error, {
        tags: {
          source: 'tanstack.query',
          'query.key': JSON.stringify(query.queryKey),
        },
      })
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      captureError(error as Error, {
        tags: {
          source: 'tanstack.mutation',
          'mutation.key': JSON.stringify(mutation.options.mutationKey ?? []),
        },
      })
    },
  }),
})
```

This catches queries that fail after their retry budget is exhausted
plus every mutation rejection. It does **not** double-capture errors
that already throw during render — `<SentoriErrorBoundary>` covers
those.

## Don't double-capture

All three patterns above call `captureError` **once** per error and
re-throw. If you also wrap the same call site in a
`<SentoriErrorBoundary>` you'll get two entries on the dashboard for
the same throw. Pick one capture point per surface:

- Reducer / thunk: middleware
- Store mutation: wrapper
- Async data fetch: query cache `onError`
- Render-phase throw: `<SentoriErrorBoundary>`

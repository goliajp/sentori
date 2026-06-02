---
title: Remix
description: Wire Sentori into a Remix (Vite) project
---

# Remix

Targets Remix v2 (Vite-based, the current default). A migration note
for classic Remix (esbuild) is at the end.

## 1. Install

```bash
bun add @goliapkg/sentori-react @goliapkg/sentori-javascript
# or
pnpm add @goliapkg/sentori-react @goliapkg/sentori-javascript
```

The `@goliapkg/sentori-javascript` install is implicit (it's a
transitive dep of `sentori-react`), but listing it explicitly lets
you call `initSentori` in `entry.server.tsx` without an extra
indirection.

## 2. Environment

`.env`:

```bash
SENTORI_TOKEN=st_pk_...
SENTORI_RELEASE=myapp@1.2.3
SENTORI_INGEST_URL=https://ingest.sentori.golia.jp
```

Remix's Vite plugin exposes these via `import.meta.env` when prefixed
with `PUBLIC_` for the browser:

```bash
PUBLIC_SENTORI_TOKEN=st_pk_...
PUBLIC_SENTORI_RELEASE=myapp@1.2.3
```

## 3. Client side — `app/entry.client.tsx`

```tsx
import { initSentori } from '@goliapkg/sentori-javascript'
import { RemixBrowser } from '@remix-run/react'
import { startTransition, StrictMode } from 'react'
import { hydrateRoot } from 'react-dom/client'

initSentori({
  token: import.meta.env.PUBLIC_SENTORI_TOKEN,
  release: import.meta.env.PUBLIC_SENTORI_RELEASE,
  environment: import.meta.env.MODE === 'production' ? 'prod' : 'dev',
})

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <RemixBrowser />
    </StrictMode>,
  )
})
```

## 4. Server side — `app/entry.server.tsx`

```tsx
import { initSentori, captureException } from '@goliapkg/sentori-javascript'
import type { EntryContext } from '@remix-run/node'
import { RemixServer } from '@remix-run/react'
import { renderToString } from 'react-dom/server'

initSentori({
  token: process.env.SENTORI_TOKEN!,
  release: process.env.SENTORI_RELEASE!,
  environment: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
})

export default function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext,
) {
  return new Response(
    `<!DOCTYPE html>${renderToString(
      <RemixServer context={remixContext} url={request.url} />,
    )}`,
    { headers: responseHeaders, status: responseStatusCode },
  )
}

// Remix forwards thrown loader / action errors here.
export function handleError(
  error: unknown,
  { request }: { request: Request },
) {
  const err = error instanceof Error ? error : new Error(String(error))
  captureException(err, {
    tags: {
      source: 'remix.handleError',
      'remix.url': new URL(request.url).pathname,
      'remix.method': request.method,
    },
  })
}
```

## 5. Route ErrorBoundary — `app/root.tsx`

Remix gives every route an `ErrorBoundary` export. Wrap the root one
with Sentori's boundary so caught React render errors flow through:

```tsx
import { SentoriErrorBoundary, SentoriProvider } from '@goliapkg/sentori-react'
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteError,
} from '@remix-run/react'

export default function App() {
  return (
    <html lang="en">
      <head>
        <Meta />
        <Links />
      </head>
      <body>
        <SentoriProvider config={configFromEnv()}>
          <SentoriErrorBoundary fallback={<DefaultErrorScreen />}>
            <Outlet />
          </SentoriErrorBoundary>
        </SentoriProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export function ErrorBoundary() {
  const error = useRouteError()
  if (isRouteErrorResponse(error)) {
    return <p>{error.status} — {error.statusText}</p>
  }
  // Non-route errors already went through handleError on the server
  // and through SentoriErrorBoundary on the client.
  return <p>Something went wrong</p>
}

function DefaultErrorScreen() {
  return <p>Sorry — refresh the page or come back later.</p>
}

function configFromEnv() {
  return {
    token: import.meta.env.PUBLIC_SENTORI_TOKEN,
    release: import.meta.env.PUBLIC_SENTORI_RELEASE,
    environment: import.meta.env.MODE === 'production' ? 'prod' : 'dev',
  }
}
```

## 6. Source maps

Remix v2 uses Vite under the hood. Source maps are emitted by
default; if not, ensure `vite.config.ts` doesn't disable them:

```ts
// vite.config.ts
import { vitePlugin as remix } from '@remix-run/dev'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [remix()],
  build: {
    sourcemap: true,
  },
})
```

After `bun run build`, the maps land in `build/client/assets/`.
Upload them from CI:

```bash
sentori-cli upload sourcemap \
  --release "myapp@$(git rev-parse --short HEAD)" \
  --token "$SENTORI_TOKEN" \
  --ingest-url "$SENTORI_INGEST_URL" \
  build/client/assets/
```

## Classic Remix (esbuild)

If you're still on the pre-Vite Remix compiler:

- Set `serverSourcemap: true` in `remix.config.js`.
- Browser maps live in `public/build/assets/` after `bun run build`.
- Upload path: `sentori-cli upload sourcemap ... public/build/`.

The runtime wiring (entry.client / entry.server / root.tsx) is the
same.

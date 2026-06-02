---
title: Getting started — React
description: 5 minutes from `bun add` to your first React event in the Sentori dashboard
---

# React quickstart

Goal: 5 minutes from `bun add @goliapkg/sentori-react` to a React
error showing up in the Sentori dashboard.

## Prerequisites

- A React 18+ app (Vite / CRA / any bundler). Sentori does not care
  what router or state library you use.
- A Sentori **token** (`st_pk_...`) and an **ingest URL**:
  - SaaS: sign up at <https://sentori.golia.jp> and copy from
    project settings.
  - Self-hosted: see [Self-hosting](../self-hosting.md) — the token
    is `SENTORI_DEV_TOKEN` and the ingest URL is the host you run
    the server on.

## 1. Install

```bash
bun add @goliapkg/sentori-react
# or
pnpm add @goliapkg/sentori-react
```

The React SDK pulls `@goliapkg/sentori-javascript` as a transitive
dep, so the JS SDK's window/process error hooks come along.

## 2. Configure

Put credentials in your `.env.production` (Vite uses `VITE_*`):

```bash
VITE_SENTORI_TOKEN=st_pk_...
VITE_SENTORI_RELEASE=myapp@1.0.0
VITE_SENTORI_INGEST=https://ingest.sentori.golia.jp
```

## 3. Wire `main.tsx`

```tsx
import { SentoriErrorBoundary, SentoriProvider } from '@goliapkg/sentori-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SentoriProvider
      config={{
        token: import.meta.env.VITE_SENTORI_TOKEN,
        release: import.meta.env.VITE_SENTORI_RELEASE,
        environment: import.meta.env.MODE === 'production' ? 'prod' : 'dev',
        ingestUrl: import.meta.env.VITE_SENTORI_INGEST,
      }}
    >
      <SentoriErrorBoundary fallback={<p>Something went wrong.</p>}>
        <App />
      </SentoriErrorBoundary>
    </SentoriProvider>
  </StrictMode>,
)
```

That's the entire wiring — Provider initialises the SDK, boundary
catches render-phase throws.

## 4. Capture your first error

Easiest way: render a component that throws.

```tsx
// somewhere in App.tsx
function BoomButton() {
  return (
    <button onClick={() => { throw new TypeError('hello sentori') }} type="button">
      Boom
    </button>
  )
}
```

Click it once. The boundary catches the throw, renders the fallback,
and the SDK POSTs the event to your ingest URL.

For imperative capture (not a render error — e.g. inside a fetch
catch block):

```tsx
import { useCaptureError } from '@goliapkg/sentori-react'

function PayButton() {
  const capture = useCaptureError()
  return (
    <button
      onClick={async () => {
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

## 5. View on the dashboard

Open your dashboard (`https://sentori.golia.jp/main` for SaaS, or
`http://localhost:8000/main` self-hosted). The new issue appears within a
few seconds on the Issues list.

If you don't see it:

- Check the browser DevTools network panel for a `POST .../v1/events`
  with a `202 Accepted` response.
- A `401` means the token doesn't match — look for the `hint` field
  in the response JSON for a specific cause.
- A `429` means you've hit the rate limit. Default per-token limit
  is 1000 req/min; bump via `SENTORI_RATE_LIMIT_PER_MIN`.

## 6. Next steps

- [SDK reference](../sdk-react.md) — `<SentoriSuspense>`,
  `resetKeys`, react-router auto-breadcrumbs, hooks
- [Vite + React recipe](../recipes/vite.md) — sourcemap upload + CI
- [Next.js recipe](../recipes/nextjs.md) — for Next users specifically
- [Self-hosting](../self-hosting.md) — production deploy, SMTP

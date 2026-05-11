---
title: Getting started — Next.js
description: 5 minutes from `bun add` to your first Next.js event in the Sentori dashboard
---

# Next.js quickstart

Goal: 5 minutes from `bun add @goliapkg/sentori-next` to a Next.js
error showing up in the Sentori dashboard. Targets Next.js 14+
(App Router); Pages Router is covered at the end.

## Prerequisites

- A Next.js 14+ project.
- A Sentori **token** and **ingest URL** — see the [React
  quickstart §Prerequisites](./react.md#prerequisites).

## 1. Install

```bash
bun add @goliapkg/sentori-next
# or
pnpm add @goliapkg/sentori-next
```

## 2. Environment

`.env.local`:

```bash
NEXT_PUBLIC_SENTORI_TOKEN=st_pk_...
NEXT_PUBLIC_SENTORI_RELEASE=myapp@1.0.0
NEXT_PUBLIC_SENTORI_ENVIRONMENT=prod
```

`NEXT_PUBLIC_*` is required so the SDK can read them in the browser
bundle.

## 3. Wire `instrumentation.ts`

```ts
// instrumentation.ts at the project root
export { register, onRequestError } from '@goliapkg/sentori-next/instrumentation'
```

That covers every server-side error surface: RSC throws, route
handlers (`app/api/*/route.ts`), and Pages API (`pages/api/*`).

## 4. Wire `app/layout.tsx`

```tsx
'use client'
import { clientInit, SentoriProvider } from '@goliapkg/sentori-next/client'

clientInit() // reads NEXT_PUBLIC_SENTORI_*

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SentoriProvider
          config={{
            token: process.env.NEXT_PUBLIC_SENTORI_TOKEN!,
            release: process.env.NEXT_PUBLIC_SENTORI_RELEASE!,
            environment: process.env.NEXT_PUBLIC_SENTORI_ENVIRONMENT ?? 'prod',
          }}
        >
          {children}
        </SentoriProvider>
      </body>
    </html>
  )
}
```

## 5. Wire `app/error.tsx`

```tsx
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

For a global catch-all that wraps the root layout too, drop the same
component into `app/global-error.tsx`.

## 6. Capture your first error

Add a page that throws:

```tsx
// app/boom/page.tsx
'use client'
export default function BoomPage() {
  if (typeof window !== 'undefined') {
    throw new TypeError('hello sentori')
  }
  return null
}
```

Navigate to `/boom`. The boundary catches the throw, renders the
fallback, and the SDK POSTs the event.

For server-side errors, throw inside a route handler:

```ts
// app/api/boom/route.ts
export function GET() {
  throw new Error('server hello sentori')
}
```

Then `curl http://localhost:3000/api/boom`. `instrumentation.ts`'s
`onRequestError` captures the throw.

## 7. View on the dashboard

Open your dashboard. The new issue appears within a few seconds.
Client-side events carry `next.runtime=browser` indirectly via the
JS SDK; server-side events carry `next.runtime=nodejs|edge` +
`next.method` + `next.route` tags.

## 8. Pages Router

`pages/_app.tsx`:

```tsx
import { clientInit, SentoriProvider } from '@goliapkg/sentori-next/client'

clientInit()

export default function MyApp({ Component, pageProps }) {
  return (
    <SentoriProvider config={configFromEnv()}>
      <Component {...pageProps} />
    </SentoriProvider>
  )
}
```

`pages/_error.tsx`:

```tsx
import { useCaptureError } from '@goliapkg/sentori-next/client'
import { useEffect } from 'react'

export default function ErrorPage({ statusCode }: { statusCode: number }) {
  const capture = useCaptureError()
  useEffect(() => {
    capture(new Error(`Pages Router ${statusCode}`), {
      tags: { source: 'next.pages._error' },
    })
  }, [capture, statusCode])
  return <p>Sorry — something broke ({statusCode}).</p>
}
```

`instrumentation.ts` from §3 covers Pages API routes too.

## 9. Next steps

- [SDK reference](../sdk-react.md) — `<SentoriErrorBoundary>`,
  `<SentoriSuspense>`, hooks
- [Next.js recipe](../recipes/nextjs.md) — full deploy workflow,
  GitHub Actions yaml, sourcemap upload
- [Self-hosting](../self-hosting.md) — production deploy, SMTP

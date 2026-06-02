---
title: Getting started — Node.js
description: 5 minutes from `bun add` to your first Node.js event in the Sentori dashboard
---

# Node.js quickstart

Goal: 5 minutes from `bun add @goliapkg/sentori-javascript` to a
Node-side error showing up in the Sentori dashboard. Covers Express,
Hono, Fastify, plain scripts, and bun.

## Prerequisites

- Node.js 18+ or Bun.
- A Sentori **token** and **ingest URL** — see the [React
  quickstart §Prerequisites](./react.md#prerequisites).

## 1. Install

```bash
bun add @goliapkg/sentori-javascript
# or
pnpm add @goliapkg/sentori-javascript
```

The same package serves browser and Node — the Node entry point
attaches `process.on('uncaughtException')` and
`process.on('unhandledRejection')` automatically.

## 2. Initialise

Call `initSentori` once, as early as possible — before any other
import that might throw on load. The cleanest spot is a dedicated
`sentori.ts` imported first from your entry:

```ts
// sentori.ts
import { initSentori } from '@goliapkg/sentori-javascript'

initSentori({
  token: process.env.SENTORI_TOKEN!,
  release: process.env.SENTORI_RELEASE!,
  environment: process.env.NODE_ENV === 'production' ? 'prod' : 'dev',
  ingestUrl: process.env.SENTORI_INGEST_URL!,
})
```

```ts
// index.ts — your real entry
import './sentori.js'   // ← must come first
import { startServer } from './server.js'

startServer()
```

`.env`:

```bash
SENTORI_TOKEN=st_pk_...
SENTORI_RELEASE=myapi@1.0.0
SENTORI_INGEST_URL=https://ingest.sentori.golia.jp
NODE_ENV=production
```

## 3. Capture your first error

The global hooks catch anything you let escape:

```ts
// somewhere in your handler
function buggy() {
  throw new TypeError('hello sentori from node')
}

setTimeout(buggy, 0) // unhandled — captured automatically
```

Or imperatively from inside a try/catch:

```ts
import { captureException, captureException } from '@goliapkg/sentori-javascript'

try {
  await chargeCard()
} catch (err) {
  captureException(err as Error, {
    tags: { feature: 'billing', region: process.env.AWS_REGION ?? 'unknown' },
  })
  throw err  // re-throw so your normal error handling still runs
}
```

## 4. Framework integrations

### Express

```ts
import express from 'express'
import { captureException } from '@goliapkg/sentori-javascript'

const app = express()

app.use((err: Error, _req, _res, next) => {
  captureException(err, { tags: { framework: 'express' } })
  next(err)
})
```

### Hono

```ts
import { captureException } from '@goliapkg/sentori-javascript'
import { Hono } from 'hono'

const app = new Hono()

app.onError((err, c) => {
  captureException(err, {
    tags: { 'hono.path': c.req.path, framework: 'hono' },
  })
  return c.text('Internal error', 500)
})
```

### Fastify

```ts
import { captureException } from '@goliapkg/sentori-javascript'
import Fastify from 'fastify'

const fastify = Fastify()

fastify.setErrorHandler((err, req, reply) => {
  captureException(err, {
    tags: { 'fastify.route': req.routerPath, framework: 'fastify' },
  })
  reply.status(500).send({ error: 'Internal error' })
})
```

### Bun

The `bun` runtime also exposes `process.on('uncaughtException')` so
the JS SDK's hooks just work. No extra wiring.

## 5. View on the dashboard

Open your dashboard. The new issue appears within a few seconds.

If you don't see it:

- Confirm `initSentori` ran with the right token (the SDK logs
  `[sentori]` warnings on bad config).
- Watch your app's stdout for `[sentori] POST ... 401` — that's a
  token mismatch.
- A `429` means rate limit — default 1000 req/min/token.

## 6. Breadcrumbs

Drop a breadcrumb whenever something interesting happens — it ships
with the next captured event:

```ts
import { addBreadcrumb } from '@goliapkg/sentori-javascript'

addBreadcrumb({ type: 'log', data: { msg: 'cache miss', key: 'user:42' } })
addBreadcrumb({ type: 'net', data: { url: 'https://api.x.com/v2', status: 503 } })
```

Buffer is bounded (drops oldest first when full).

## 7. Next steps

- [Self-hosting](../self-hosting.md) — production deploy, SMTP,
  backups
- [Protocol](../protocol.md) — wire format reference if you're
  writing your own SDK

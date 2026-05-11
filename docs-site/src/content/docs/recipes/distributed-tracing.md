---
title: Distributed tracing
description: A three-layer trace from a React Native client through a Node backend to Postgres
---

# Distributed tracing — RN → Node → Postgres

Sentori traces follow the W3C TraceContext spec. A span emitted on
one process gets a `traceparent` header propagated outbound, so a
matching server-side span on the next process can attach itself as
a child and the trace stays connected across the network boundary.

This recipe walks through a realistic three-layer setup:

```
┌─────────────────┐   traceparent     ┌───────────────────┐  sqlx span
│ React Native    │ ─────────────────▶│ Node API (Hono)   │ ─────────▶ Postgres
│ http.client     │                   │ http.server       │
│ react.navigation│                   │ (parent of every  │
└─────────────────┘                   │  downstream span) │
                                      └───────────────────┘
```

By the end you'll see a single trace in the dashboard with a span
tree like:

```
react.navigation  Home → Checkout
  └─ http.client  POST /api/orders
     └─ http.server  POST /api/orders         (Node)
        └─ db.query  INSERT INTO orders ...   (manual span)
```

## 1. Mobile client (sentori-react-native)

Initialize the SDK once at the top of your entry file. Phase 35
shipped automatic fetch instrumentation + a navigation tracer; both
are on by default once `sentori.init` runs.

```ts
// app/_layout.tsx (Expo Router) or index.js (bare RN)
import { sentori, useTraceNavigation } from '@goliapkg/sentori-react-native'
import { useNavigationContainerRef, NavigationContainer } from '@react-navigation/native'

sentori.init({
  token: 'st_pk_...',
  release: 'myapp@1.0.0+123',
  environment: __DEV__ ? 'dev' : 'prod',
  ingestUrl: 'https://ingest.sentori.golia.jp',
})

export default function App() {
  const navigationRef = useNavigationContainerRef()
  useTraceNavigation(navigationRef)
  return <NavigationContainer ref={navigationRef}>{...}</NavigationContainer>
}
```

What you get for free:

- Every `fetch()` call emits an `http.client` span and injects a
  `traceparent` header (`00-<32hex traceId>-<16hex spanId>-01`).
- Every navigation transition emits a `react.navigation` span. If
  the user taps "Checkout," any fetches that fire on the new screen
  inherit that screen's trace context.

## 2. Backend (Node + Hono)

```ts
// server.ts
import { Hono } from 'hono'
import { honoTracingMiddleware } from '@goliapkg/sentori-javascript/tracing'
import { initSentori } from '@goliapkg/sentori-javascript'

initSentori({
  token: process.env.SENTORI_TOKEN!,
  release: process.env.SENTORI_RELEASE!,
  environment: process.env.NODE_ENV ?? 'prod',
  ingestUrl: 'https://ingest.sentori.golia.jp',
})

const app = new Hono()
app.use('*', honoTracingMiddleware())

app.post('/api/orders', async (c) => {
  // Inside this handler, withSpan from the middleware made the
  // http.server span "active". Any startSpan() here parents to it.
  const order = await c.req.json()
  await createOrderInDb(order)
  return c.json({ ok: true })
})

export default app
```

`honoTracingMiddleware`:

- Decodes the inbound `traceparent` header into a parent span
  context.
- Opens an `http.server` span with the inherited trace id.
- Wraps `next()` in `withSpan(span, ...)` so any child spans your
  handler opens automatically pick this one up as their parent.
- On the way out, tags `http.status` and finishes the span with
  `status = "error"` for 5xx, otherwise `"ok"`. A thrown error gets
  the same treatment plus an `error.message` tag, then re-throws.

For Express or Fastify, swap the middleware:

```ts
// Express
import { expressTracingMiddleware } from '@goliapkg/sentori-javascript/tracing'
app.use(expressTracingMiddleware())
```

```ts
// Fastify
import { installFastifyTracing } from '@goliapkg/sentori-javascript/tracing'
installFastifyTracing(fastify)
```

Express's callback-style `next` can't carry async context through
the chain, so child spans created inside an Express handler won't
auto-inherit the `http.server` parent. Pass `parent` explicitly to
`startSpan` if you need the chain. Hono and Fastify don't have this
limitation.

## 3. Database span (manual)

For each SQL statement worth measuring, wrap it in a span. The
`http.server` parent comes from `activeSpan()` since the Hono
middleware made it active.

```ts
import { startSpan } from '@goliapkg/sentori-javascript'

async function createOrderInDb(order: Order): Promise<void> {
  const span = startSpan('db.query', {
    name: 'INSERT INTO orders',
    tags: { 'db.system': 'postgres', 'db.table': 'orders' },
  })
  try {
    await pool.query(
      'INSERT INTO orders (id, user_id, total) VALUES ($1, $2, $3)',
      [order.id, order.userId, order.total],
    )
    span.finish({ status: 'ok' })
  } catch (err) {
    if (err instanceof Error) span.setTag('error.message', err.message)
    span.finish({ status: 'error' })
    throw err
  }
}
```

Automatic SQL instrumentation (without the manual `startSpan`
boilerplate) is a v0.5 follow-up — the cleanest path is a sqlx /
pg / mysql2 interceptor, which is invasive enough that v0.4 chose
"document the manual pattern" instead.

## 4. Looking at the trace

Open the dashboard's **Traces** tab. Filter:

```
op:http.server status:error duration:>500ms
```

…to surface slow server-side requests, or just sort by `Last seen`
to see the most recent. Click the row to land on the trace detail
view — a flat waterfall, indented by parent depth, with `Duration`
on the right and a hover-highlighted ancestor chain.

If an event was captured inside any span on this trace (an
`http.server` 5xx, say), the trace detail row shows a red
"`N event(s)`" chip; the Issue detail page for that event has a
matching "In trace →" pill that jumps back here.

## 5. What if I'm not using a Sentori SDK on one of the layers?

`traceparent` is a W3C spec, not a Sentori invention. If your
Node backend sits behind an Nginx or an upstream that already
emits `traceparent` (e.g. an OpenTelemetry-instrumented service),
the Node middleware will pick it up just the same. If your mobile
client isn't Sentori-instrumented but you want the backend trace,
omit the inbound parent — the server middleware will root a fresh
trace per request, and the dashboard will still show the
http.server + db.query waterfall.

What Sentori does NOT do today:

- Run as an OTLP receiver. We accept spans on `/v1/spans` in our
  own JSON shape; OpenTelemetry SDKs that target OTLP can't post
  there directly. A shim is straightforward but out of v0.4 scope.
- Cross-process span_id stitching at full uuid resolution. The
  W3C 16-hex parent-id is zero-padded right to fit our uuid
  columns. The trace id is exact; the parent-id will look like
  `fedcba98-7654-3210-0000-000000000000` (last 16 hex zeros) when
  it crossed a process boundary. The dashboard understands this
  and shows the inbound chain correctly.

## SDK ↔ wire-protocol crosswalk

| Surface | What emits | Where it lands |
|---|---|---|
| RN `fetch()` | `http.client` span via wrapped fetch | `/v1/spans:batch` |
| RN `useTraceNavigation` | `react.navigation` span | `/v1/spans:batch` |
| Web `fetch()` (`sentori-javascript`) | `http.client` span | `/v1/spans:batch` |
| `<TraceRender>` (`sentori-react`) | `react.render` span | `/v1/spans:batch` |
| Node middleware (Express/Hono/Fastify) | `http.server` span | `/v1/spans:batch` |
| `sentori.startSpan('db.query', ...)` | whatever op you give it | `/v1/spans:batch` |
| sentori-server itself (`SENTORI_SELF_TRACE_PROJECT_ID`) | `http.server` for every inbound request | direct INSERT into `spans` + `traces` |

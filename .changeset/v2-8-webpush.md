---
"@goliapkg/sentori-core": minor
"@goliapkg/sentori-javascript": minor
"@goliapkg/sentori-next": minor
---

v2.8 — Web Push opt-in, Service Worker subscription, server-side send for Next.js.

Second phase of the v2.7→v2.12 Push rollout. v2.7 shipped the
server foundation (provider trait, dispatch cron, secrets-sealed
credentials, `/v1/push/*` routes); v2.8 lights up the **Web Push**
branch end-to-end:

**`@goliapkg/sentori-core` (minor) — types**

Adds `PushMessage`, `PushOptions`, `PushPriority`, `PushTicket`,
`PushTicketStatus`, `PushReceipt`. These mirror the
`/v1/push/send` wire shape and are re-exported from
`@goliapkg/sentori-javascript` + `@goliapkg/sentori-next` so the
matrix shares one canonical contract.

**`@goliapkg/sentori-javascript` (minor) — browser registration**

New `sentori.push.registerWeb({ vapidPublicKey, ... })` that walks
the standard browser opt-in path:

1. `Notification.requestPermission()`
2. `navigator.serviceWorker.register(serviceWorkerUrl)` (default `/sentori-sw.js`)
3. `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })`
4. POST the subscription JSON to the Sentori ingest
   `/v1/push/tokens`, getting back an `ipt_*` device handle.
5. Cache the handle in `localStorage` + bind Service Worker
   `postMessage` events to optional `onMessage` / `onTap`
   callbacks.

`unregisterWeb()` does the reverse — DELETE the handle + unsubscribe
locally. Both are no-ops when the browser doesn't support the Push API.

**Default off** — the host app calls `registerWeb` when ready.
Sentori never triggers a permission prompt on its own. Same opt-in
principle as `trackAutoBreadcrumb`.

**`@goliapkg/sentori-next` (minor) — server-side send**

New `sentoriPush({ ingestUrl, token })` factory at
`@goliapkg/sentori-next/push`. Returns a `{ send, sendBatch,
getReceipt, isSentoriPushToken }` client that wraps `/v1/push/send`
and `/v1/push/receipts/{id}` with the Sentori-native wire shape.
Pure `fetch`, no Node-only imports — safe under `runtime: 'edge'`
in App Router server actions + middleware.

`sendBatch` concurrency-caps at 8 parallel HTTP calls to keep the
Sentori dispatcher's queue healthy on big fan-outs.

**Recipe**

`docs-site` gains `recipes/push-from-nextjs.md` — end-to-end walk
through: VAPID key pair generation, admin REST upload of the
encrypted credentials, Service Worker template, `'use client'`
register flow, App Router server action send, and a troubleshooting
matrix mapping push-server status codes to operator action.

**Compatibility**

Wire shape is unchanged from v2.7. Customers using raw REST against
`/v1/push/*` keep working without code changes. The Sentori-native
wire shape `PushMessage` and the Expo-compat endpoints both stay byte-
compatible.

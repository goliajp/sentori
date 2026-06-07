---
title: Push notifications from a Next.js app
description: v2.8 end-to-end — VAPID key setup, Service Worker template, opt-in browser registration, server-side send from an App Router action.
---

# Web Push from a Next.js app

v2.8 lights up the **Web Push** branch of the Sentori push subsystem.
This recipe walks the whole path: generating a VAPID key pair,
registering the project with Sentori, dropping in a Service Worker,
calling `sentori.push.registerWeb` from the browser, and sending a
notification from a Server Action.

Web Push covers Chrome / Edge / Firefox / Safari 16.4+ on desktop
and mobile browsers — anywhere that supports the
[Push API](https://www.w3.org/TR/push-api/) + [VAPID](https://datatracker.ietf.org/doc/html/rfc8292).

> **Default off.** `sentori.push.registerWeb()` is opt-in — the host
> app calls it when the operator is ready to see the OS permission
> prompt. Sentori never prompts on its own.

## 1. Generate a VAPID key pair

VAPID identifies the sending application server to the browser's
push service. The key pair is **per-project**, not per-deployment —
generate it once, ship the private key to Sentori, keep the public
key in the client bundle.

```bash
openssl ecparam -genkey -name prime256v1 -noout -out vapid_private.pem
openssl ec -in vapid_private.pem -pubout -out vapid_public.pem

# Base64url-encoded public key (this is what the browser SDK + the
# Sentori dashboard both need).
PUB_B64=$(openssl ec -in vapid_public.pem -pubin -outform DER 2>/dev/null \
    | tail -c 65 | base64 | tr '+/' '-_' | tr -d '=')
echo "VAPID public key: $PUB_B64"
```

Save the `vapid_private.pem` somewhere secure — you'll upload it to
Sentori in step 2 and never need it directly again.

## 2. Tell Sentori about the keys

Push credentials live in the encrypted `push_credentials` table per
project. Upload yours via the admin API:

```bash
curl -X PUT "https://sentori.golia.jp/admin/api/projects/<project_id>/push/credentials" \
    -H "Authorization: Bearer st_admin_<your_admin_token>" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "provider": "webpush",
  "config": {
    "vapidPublic": "$PUB_B64",
    "contact": "mailto:dev@example.com"
  },
  "secret": {
    "vapidPrivate": "$(cat vapid_private.pem | base64 | tr -d '\n')"
  }
}
EOF
```

The `contact` field is required by some push servers (notably FCM
Web) — `mailto:` or `https:` URI both work.

`sentori-cli push creds set-webpush` lands in v2.12; until then this
direct admin REST call is the path.

## 3. Drop in the Service Worker

Save the following at the **root of your public site** as `public/sentori-sw.js`:

```js
// Sentori Web Push Service Worker (v2.8 template).
// Owns: push event → notification show, notificationclick → focus tab.
// Tracking-free: the only network call is `clients.matchAll` which
// stays local. Replace with your own SW if you have additional
// responsibilities (offline cache, etc.) — just call into the same
// handler shape.

self.addEventListener('push', (event) => {
  if (!event.data) return
  let payload = {}
  try { payload = event.data.json() } catch (_) { payload = { title: event.data.text() } }
  const { title, body, data } = payload
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title ?? 'Notification', { body, data }),
      forwardToPages('sentori.push.message', payload),
    ]),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const payload = { data: event.notification.data }
  event.waitUntil(
    Promise.all([
      forwardToPages('sentori.push.tap', payload),
      self.clients.matchAll({ type: 'window' }).then((wins) => {
        if (wins.length > 0) return wins[0].focus()
        return self.clients.openWindow('/')
      }),
    ]),
  )
})

async function forwardToPages(type, payload) {
  const wins = await self.clients.matchAll({ type: 'window' })
  for (const win of wins) {
    try { win.postMessage({ type, payload }) } catch (_) {}
  }
}
```

If you already own a Service Worker, paste the two `addEventListener`
blocks into it instead of registering a second SW.

## 4. Wire up the browser registration

In a client component (`'use client'`), call `registerWeb` when the
operator opts in. The SDK handles the permission prompt + SW
registration + push subscription + the call back to
`/v1/push/tokens`.

```tsx
'use client'

import { useState } from 'react'
import { registerWeb, unregisterWeb, readCachedIpt } from '@goliapkg/sentori-javascript'

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!

export function NotificationsToggle() {
  const [ipt, setIpt] = useState(readCachedIpt())
  return ipt ? (
    <button onClick={() => unregisterWeb().then(() => setIpt(null))}>
      Disable notifications
    </button>
  ) : (
    <button
      onClick={async () => {
        try {
          const { ipt } = await registerWeb({
            vapidPublicKey: VAPID_PUBLIC,
            // Optional: bind this device to the signed-in user, so
            // server code can `push.send({ to: usersDeviceIpt })`.
            linkHash: typeof window !== 'undefined' ? localStorage.getItem('sentori.user.linkHash') ?? undefined : undefined,
            onMessage: (msg) => console.log('foreground push:', msg),
            onTap: (data) => console.log('tapped:', data),
          })
          setIpt(ipt)
        } catch (e) {
          console.warn('opt-in failed', e)
        }
      }}
    >
      Enable notifications
    </button>
  )
}
```

After a successful `registerWeb`, store the returned `ipt_*` handle
somewhere your server can read it back — typically as a column on the
user row, or in a `device_tokens` table you manage. Sentori keeps its
own copy too, but your server needs the handle to address sends.

## 5. Send a push from a Server Action

Server-side use is intentionally separate from the browser SDK —
nothing in `@goliapkg/sentori-next/push` reaches into a browser API,
so it's safe under `runtime: 'edge'` as well as Node.

```ts
'use server'

import { sentoriPush } from '@goliapkg/sentori-next/push'

const push = sentoriPush({
  ingestUrl: process.env.SENTORI_INGEST_URL!,        // https://ingest.sentori.golia.jp
  token: process.env.SENTORI_ADMIN_TOKEN!,           // st_admin_...
})

export async function notifyNewComment(userIpt: string, comment: string) {
  await push.send({
    to: userIpt,
    title: 'New comment',
    body: comment.slice(0, 80),
    data: { kind: 'comment', deepLink: '/comments' },
    options: { priority: 'high' },
    // Optional — collapses duplicate notifications for the same
    // comment id if the server retries the action.
    idempotencyKey: `comment:${comment.id}`,
  })
}
```

For batch fan-out (e.g. notifying every team member), pass an array
of `PushMessage`s to `sendBatch` — it concurrency-caps at 8 to keep
the Sentori dispatcher's queue healthy on big jobs.

## 6. Check delivery

After the dispatch cron runs (≤ 30 s), the send moves from
`queued` → `sent` (or `failed`). Read the receipt:

```ts
const receipt = await push.getReceipt(ticket.id)
// receipt.ticket.status      → 'queued' | 'sent' | 'failed'
// receipt.ticket.providerOutcome → 'WP_201' | 'WP_410_Gone' | ...
```

## Troubleshooting

**`/v1/push/tokens` returns 503 `dbNotConfigured`** — the Sentori
server's Postgres isn't reachable. Operator side.

**`/v1/push/tokens` returns 400 `invalid provider`** — only emitted
when `provider` isn't one of `apns / fcm / webpush / hcm / mipush`.
The browser SDK always sends `webpush`; this would only fire on a
hand-rolled call.

**Send stays in `queued` forever** — the dispatch cron picks rows up
every 30 s. If it's longer than that, check the server logs for
`push dispatch sweep failed` warnings and confirm
`SENTORI_SESSION_SECRET` is set (the dispatcher uses it to decrypt
`push_credentials.secret_blob`).

**`WP_404` / `WP_410`** in the receipt — the browser revoked the
subscription (user toggled notifications off, cleared site data, or
the SW unregistered). Sentori auto-revokes the `device_tokens` row
after 3 consecutive `PermanentlyInvalidToken` outcomes.

**`WP_401` / `WP_403`** — VAPID JWT was rejected. Re-check the
private key matches the public key you uploaded, and that `contact`
is a valid `mailto:` or `https:` URI.

**No notification appears in the browser** — confirm:
1. The site is over HTTPS (or `http://localhost` for dev).
2. The Service Worker is registered at `/sentori-sw.js` (or wherever
   you pointed `serviceWorkerUrl`).
3. `Notification.permission === 'granted'` (you can re-prompt by
   calling `Notification.requestPermission()` in DevTools).

## Related

- [Push notification design](/docs/design/push-architecture/) — the
  five-layer architecture and wire format.
- [Find users affected](/recipes/find-users-affected/) — once you've
  registered devices with `linkHash`, the Users module can show
  which users have push enabled.

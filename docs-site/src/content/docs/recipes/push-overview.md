---
title: Push notifications — overview
description: How Sentori's push subsystem works end-to-end across APNs / FCM / Web Push / HCM / MiPush, and where to go for each platform.
---

# Push notifications — overview

Sentori has shipped a full push subsystem across the v2.7 → v2.19 series. It covers iOS (APNs), Android (FCM), Web browsers (VAPID Web Push), Huawei (HCM), and Xiaomi (MiPush), with a dashboard for credential management, send monitoring, and per-device fleet inspection.

This page is the **map**. If you're new to Sentori push, read it once to understand the moving parts, then jump to the platform-specific recipe for your app.

## What Sentori push gives you

A single API across every platform:

```ts
// register a device once
const handle = await sentori.push.register({ /* per-platform options */ })

// later — from anywhere on the server
await fetch(`${INGEST_URL}/v1/push/send`, {
  method: 'POST',
  headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  body: JSON.stringify({ to: handle, title, body, data }),
})
```

There is **no Sentori SDK on the server**. You make plain HTTP calls into the ingest server's `/v1/push/*` routes (or use `sentori-cli push send`). The server holds your APNs / FCM / Web Push credentials, signs the upstream request, and reports delivery receipts back into the dashboard.

### What's intentionally not here

- **No OneSignal-style SDK side channel for analytics.** Sentori push is a transport — it delivers the message and reports the receipt. Engagement analytics live in the Sentori `track` channel, which you call yourself when the user opens the notification.
- **No "Sentori-managed cohorts."** You decide who gets the notification. Sentori stores device tokens grouped by `installId` / `userId` you supply at register time, and accepts a target expression on send (`to: 'user:abc'` / `to: 'install:xyz'` / `to: 'topic:promo'` / etc).
- **No automatic opt-in.** The SDK never triggers the OS permission prompt on its own — the host app decides when to call `sentori.push.register()`. Same posture as `trackAutoBreadcrumb` and replay capture.

## The three actors

```
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│  HOST APP (RN /  │         │  SENTORI SERVER  │         │  APNs / FCM /    │
│  Web / Expo)     │ ──1──▶  │  /v1/push/*      │ ──3──▶  │  Web Push / HCM  │
│                  │         │                  │         │  / MiPush        │
│  sentori.push.   │ ◀──4──  │                  │ ◀──2──  │                  │
│  register()      │         │  send + receipt  │         │  upstream gateway │
└──────────────────┘         └──────────────────┘         └──────────────────┘
       ▲                              │                              │
       │                              ▼                              │
       │                     ┌──────────────────┐                    │
       └─── 5 (notification ─│  USER'S DEVICE   │ ◀── 5 (delivery) ──┘
            from OS)         └──────────────────┘
```

1. **Register** — host app calls `sentori.push.register()`. The SDK walks the OS permission flow, hands off to the platform registration handshake (APNs / FCM SDK / `PushManager.subscribe()`), and POSTs the resulting token to `/v1/push/tokens`. You get back an `ipt_*` install-push-token handle.
2. **Server side** — Sentori stores the token grouped by `(projectId, installId, userId, platform)` and surfaces the device in the dashboard's [Push fleet view](#push-fleet).
3. **Send** — your backend (or your support tooling / your cron) calls `/v1/push/send`. Sentori signs the upstream request using credentials configured in the dashboard, posts to APNs / FCM / etc, and stores the result.
4. **Receipt** — APNs / FCM / Web Push report back synchronously or via webhook. Sentori records the outcome (`delivered` / `clicked` / `bounced`) against the send id, queryable from the dashboard or via `/v1/push/sends/<id>`.
5. **Delivery** — OS shows the notification to the user. If the user taps it, your app receives a regular `Notifications.addNotificationResponseReceivedListener` event (or web `notificationclick` event); how you handle taps is identical to any non-Sentori push setup.

## Setup checklist

```
[ ]  1. Generate provider credentials (APNs .p8 / FCM service account JSON / VAPID keys / HCM secret / MiPush secret).
[ ]  2. Upload credentials to Sentori dashboard ↓ Project Settings ↓ Push Credentials.
[ ]  3. Install the matching SDK in your app:
         - RN bare / Expo:  bun add @goliapkg/sentori-react-native @goliapkg/sentori-expo
         - Next.js (Web Push):  bun add @goliapkg/sentori-next
         - Plain JS / Vue / Svelte / Solid:  bun add @goliapkg/sentori-javascript
[ ]  4. Call sentori.push.register() at the moment you want to prompt the user (NOT app start).
[ ]  5. Verify in dashboard ↓ Push ↓ Fleet that the device appeared.
[ ]  6. Send a test from the dashboard ↓ Push ↓ Send composer (or `sentori-cli push send --to <handle>`).
[ ]  7. Wire your real send call from your backend.
```

## Platform recipes

Pick your platform; each recipe walks the **full path** including the platform-specific credential setup, the SDK call sites, and a verified send round-trip.

| Platform | Recipe | SDK package | What it covers |
|---|---|---|---|
| Web (browsers) — Next.js | [push-from-nextjs](/recipes/push-from-nextjs) | `@goliapkg/sentori-next` | VAPID key pair, Service Worker template, opt-in `registerWeb`, send from a Server Action. |
| React Native — iOS | [push-from-react-native-ios](/recipes/push-from-react-native-ios) | `@goliapkg/sentori-react-native` | APNs `.p8` upload, `register()` opt-in, foreground + tap handlers, send via cURL. |
| React Native — Android | [push-from-react-native-android](/recipes/push-from-react-native-android) | `@goliapkg/sentori-react-native` | FCM service-account upload, manifest setup, the same `register()` call returning an FCM token. |
| Expo (iOS + Android) | Use the RN iOS / Android recipes + [expo-notifications migration](/recipes/migrate-from-expo-notifications) | `@goliapkg/sentori-expo` + `@goliapkg/sentori-react-native` | Config plugin auto-injects `Info.plist` / Android manifest / Gradle. |
| Huawei (HMS) | _Configure in dashboard; SDK path matches RN Android_ | `@goliapkg/sentori-react-native` | HCM credential upload, register-with-`provider: 'hcm'` flag. |
| Xiaomi (MiPush) | _Configure in dashboard; SDK path matches RN Android_ | `@goliapkg/sentori-react-native` | MiPush credential upload, register-with-`provider: 'mipush'` flag. |

### Migrating from `expo-notifications`?

We ship a **drop-in compatibility shim** at `@goliapkg/sentori-expo/expo-compat`. Your existing `expo-notifications` import sites keep working without changes; the shim routes the calls into `sentori.push.*`. See [migrate-from-expo-notifications](/recipes/migrate-from-expo-notifications) for the one-line swap and the lifecycle differences.

## Monitoring + management (dashboard)

The Sentori dashboard's Push section covers the operational side. Three views shipped in v2.11 → v2.19:

### Credentials (v2.11)

Project Settings → Push Credentials. Upload / rotate APNs `.p8`, FCM service-account JSON, VAPID keys, HCM secret, MiPush secret. **Secrets are write-only after upload** — you cannot read them back from the dashboard, only replace them. (`sentori-cli push creds list/set/delete` exposes the same surface for CI / IaC.)

### Send composer + history

Dashboard → Push. Pick a target (user / install / topic), compose a payload (title / body / data / image / TTL), preview platform rendering, send. Every send has a stable `send_id` you can drill into for per-recipient receipts (delivered / clicked / bounced / suppressed-quiet-hours / token-expired).

### Push fleet (v2.19)

Dashboard → Push → Fleet. Per-device inventory: which `installId`s are reachable on which provider, last-seen timestamps, registration age, opt-out vs token-expired distinction. Use this to:

- Confirm a specific user has a registered token on the platform you expect.
- Find devices that haven't been seen recently (likely uninstalled).
- Audit how many of your active users actually granted push permission.

### Receipts + delivery analytics

Each send's detail view (v2.19) breaks down:

- Per-platform delivery success rate.
- Bounce reasons (token expired, blocked by user, payload-too-large, rate-limited).
- Click-through rate, if you wire the tap event into `sentori.track`.

## Best practices

**Opt-in timing.** Don't call `sentori.push.register()` on app start. Prompt the user *after* they've seen value — past onboarding, behind a Notifications settings screen, or after a meaningful action. iOS denies you a second prompt forever, so the first one matters.

**One `installId` per device.** Sentori already deduplicates a device's token if you re-register with the same `installId`. You don't need to "deregister before re-register" on re-login — just call `register()` with the new `userId`.

**Be conservative with topics.** A `topic:promo` send fans out to every device subscribed to that topic. Make sure your unsubscribe path is wired and tested — the dashboard's Bounce filter will show you token-expired entries, but it can't undo a user who turned off notifications because of you.

**Quiet hours + rate limits.** The server respects per-project quiet hours (configurable in dashboard) and per-device rate limits. If a send is suppressed for either reason it shows in the receipt as `suppressed-quiet-hours` / `suppressed-rate-limit` — these are not failures, they're policy.

**Foreground vs background.** OS-level push handling differs by platform when the app is in the foreground:

- iOS shows nothing by default — your app gets the payload via `Notifications.addNotificationReceivedListener` and decides whether to surface an in-app banner.
- Android shows the notification only if the priority + channel settings allow.
- Web Push always shows the OS notification (if it didn't, the browser would revoke your permission).

Plan UX around this — don't assume "send" means "the user saw it right now."

## What we don't ship (yet)

- **No native A/B-test variants in send composer** — you can fan out to two installId cohorts manually but there's no built-in variant infra. On the v2.x roadmap.
- **No automatic retry-on-bounce schedule** — if a send bounces it stays bounced; you decide whether to retry against a new token next time the device re-registers.
- **No deep-link wizard** — payloads ship as JSON; build your own deep-link routing on the receive side. We document the pattern in each platform recipe.

## Where to ask for help

- Found a bug? [Issue tracker](https://github.com/goliajp/sentori/issues).
- Token registers but sends bounce? Check the send's detail view — receipt reason is usually conclusive.
- Stuck on credential setup? Each platform recipe has a "I tried but it doesn't work" diagnostic section.

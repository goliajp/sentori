---
title: Push notifications — React Native Android
description: v2.10 — Firebase Cloud Messaging via @goliapkg/sentori-react-native. Same sentori.push.register() as iOS; resolves on Android too.
---

# Push notifications — React Native Android

v2.10 ships the **Android** branch of `@goliapkg/sentori-react-native`'s
push support. The JS surface is identical to the v2.9 iOS recipe:
`sentori.push.register({...})` returns an `ipt_*` handle on both
platforms.

> **Default off.** Same opt-in posture as iOS — the SDK never asks
> for the OS permission on its own. The host app calls `register()`
> when ready.

> **Firebase is optional.** `firebase-messaging` is a `compileOnly`
> dependency in the SDK's `build.gradle`. Apps that don't want push
> aren't forced to ship Firebase. Apps that DO want push add the
> Firebase deps themselves; the SDK detects them at runtime via
> `Class.forName` and proceeds.

## 1. Add APNs / FCM credentials to your Sentori project

For Android-only setup, you only need the FCM credential entry —
the v2.9 recipe covers the APNs side if your app ships both
platforms.

```bash
curl -X PUT "https://sentori.golia.jp/admin/api/projects/<id>/push/credentials" \
    -H "Authorization: Bearer st_admin_<token>" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "provider": "fcm",
  "config": { "project_id": "my-firebase-project" },
  "secret": $(cat firebase-admin-sdk.json)
}
EOF
```

The `secret` body is your Firebase **service account JSON** — the
file downloaded from Firebase Console → Project Settings → Service
Accounts → "Generate new private key". Sentori encrypts it at rest
via `secrets.rs` (AES-256-GCM with HKDF-SHA256 from
`SENTORI_SESSION_SECRET`).

## 2. Configure the Android app

### `google-services.json`

Download from Firebase Console → Project Settings → General → "Your
apps" → Android. Place it at:

```
android/app/google-services.json
```

### Root `android/build.gradle`

```gradle
buildscript {
  dependencies {
    classpath 'com.google.gms:google-services:4.4.2'
  }
}
```

### App `android/app/build.gradle`

```gradle
apply plugin: 'com.android.application'
apply plugin: 'com.google.gms.google-services'  // ← at bottom of file

dependencies {
  // Firebase BOM picks compatible versions for all firebase-* deps
  implementation platform('com.google.firebase:firebase-bom:33.5.1')
  implementation 'com.google.firebase:firebase-messaging'
}
```

### AndroidManifest.xml

The SDK's `AndroidManifest.xml` declares the
`SentoriFirebaseMessagingService` for you — manifest merger combines
it with your app's manifest automatically. **No host code required.**

The `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>`
declaration is also merged in by the SDK.

### Default notification channel

The SDK creates a `"sentori"` notification channel lazily on first
push received. Hosts that want their own channel pass `channelId`
in the send options:

```ts
await push.send({
  to: ipt,
  title: 'Hi',
  body: 'from sentori',
  options: { channelId: 'my-app-comments', priority: 'high' },
})
```

## 3. Register from your React Native app

Identical to the iOS recipe — `sentori.push.register({...})`
resolves to an `ipt_*` handle on either platform.

```tsx
import { sentori } from '@goliapkg/sentori-react-native'

const { ipt } = await sentori.push.register({
  onMessage: (m) => console.log('foreground push:', m),
  onTap: (data) => console.log('tapped:', data),
})
```

On Android 13+ (API 33), the call triggers the `POST_NOTIFICATIONS`
runtime permission prompt the first time. On older Android, the
permission is granted at install time, so `register()` resolves
immediately when Firebase has the token.

The `nativeToken` POSTed to `/v1/push/tokens` is the FCM
registration token (raw string, not hex). The server's `FcmProvider`
handles the rest.

## 4. Send a push

Same as iOS / Next.js recipes — `/v1/push/send` is the single
entry point.

```ts
import { sentoriPush } from '@goliapkg/sentori-next/push'

const push = sentoriPush({
  ingestUrl: process.env.SENTORI_INGEST_URL!,
  token: process.env.SENTORI_ADMIN_TOKEN!,
})

await push.send({
  to: userIpt,
  title: 'New comment',
  body: 'Alex replied to your issue',
  data: { kind: 'comment', deepLink: '/issues/abc123' },
  options: { priority: 'high', channelId: 'sentori' },
})
```

The server's dispatch cron picks up the row, calls FCM's v1
`messages:send` endpoint with the right OAuth bearer (RS256 JWT
exchange behind the scenes), and updates the receipt.

## 5. Observe the result

```bash
curl "https://ingest.sentori.golia.jp/v1/push/receipts/<send_id>" \
    -H "Authorization: Bearer st_admin_<token>"
# → { "ticket": { "status": "sent", "providerOutcome": "FCM_200", ... } }
```

In the running app:
- **Foreground**: `onMessage` callback fires; the system tray may
  also show the notification depending on whether the message has a
  `notification` payload (Firebase show) vs `data` only (no system
  display, JS-only).
- **Background**: standard system tray entry. Tap → app opens →
  `onTap(data)` fires when the app's drain loop next ticks.

## Troubleshooting

**`isFirebaseAvailable: false`** in server logs — the host app
doesn't include `firebase-messaging` in its `app/build.gradle`
dependencies. Add it (see Step 2).

**`pushRequestPermission` returns `'unavailable'`** — there's no
Activity attached to the React Native runtime. Wait until the JS
runtime mounts the first screen and call `register()` from a
component lifecycle (e.g. `useEffect`), not from module init.

**`FCM_404_Unregistered` in the receipt** — Firebase revoked the
token. Same auto-revoke logic as iOS: Sentori marks the
`device_tokens` row revoked after 3 consecutive
`PermanentlyInvalidToken` outcomes.

**`FCM_401_Unauthenticated`** — the service account JSON uploaded
to `push_credentials` is expired or revoked. Generate a new one in
Firebase Console and re-upload.

**Push never arrives in foreground despite `register()` returning**
— check `Settings → Apps → YourApp → Notifications` on the device.
Android 13+ users may have toggled notifications off; the SDK's
permission check catches `currentPermission`'s
`areNotificationsEnabled` state.

**`pushRequestPermission` callback never fires** — On older devices
(pre-API 31), `ActivityCompat.requestPermissions` may not deliver
the result through our hook. The 1 Hz drain loop will catch up
within 1 second — the JS layer's `register()` will resolve once the
permission is granted on the next pump.

## Related

- [Push notifications — React Native iOS](/recipes/push-from-react-native-ios/) — the v2.9 counterpart with `aps-environment` setup.
- [Push notifications — Next.js Web Push](/recipes/push-from-nextjs/) — v2.8.
- [Push notification architecture](/design/push-architecture/) — the cross-version design contract.
- v2.11 Expo config plugin — auto-injects the gradle plugin + `google-services.json` glob; coming next.

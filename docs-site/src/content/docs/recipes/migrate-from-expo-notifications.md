---
title: Migrate from expo-notifications to Sentori push
description: v2.18 — one-line import swap covers 90% of the expo-notifications surface. The rest of this page is the server-side change + a feature parity matrix.
---

# Migrate from `expo-notifications`

v2.18 ships `@goliapkg/sentori-react-native/expo-compat` — a drop-in
shim that mirrors the public surface of [`expo-notifications`](https://docs.expo.dev/versions/latest/sdk/notifications/).
For most apps the migration is one line:

```diff
- import * as Notifications from 'expo-notifications'
+ import * as Notifications from '@goliapkg/sentori-react-native/expo-compat'
```

…and your existing registration / listener / handler code keeps
running.

## Why migrate

`expo-notifications` ties your app to **Expo's exp.host push
service** for the actual delivery. Going through Sentori instead
gives you:

- One backend for both **APNs + FCM + Web Push + HCM + MiPush** (v2.7–v2.12 series).
- **Encrypted credential storage** server-side (AES-256-GCM via the
  new `secrets.rs` layer) — your `.p8` / service-account JSON never
  touches Expo's infrastructure.
- **First-party dashboard** for credential CRUD + send-history view (v2.11).
- **Same wire shape** as if you'd been hitting `/v1/push/*` directly all along.

## 1. Update the import (client-side)

That's it for the client.

```diff
- import * as Notifications from 'expo-notifications'
+ import * as Notifications from '@goliapkg/sentori-react-native/expo-compat'
```

Every call signature is identical. `Notification` / `NotificationResponse` /
`NotificationContent` / `NotificationRequest` types match the
upstream shapes byte-for-byte, so any code that destructures them
keeps compiling.

## 2. Change the server-side send (this is the real work)

`expo-notifications` apps POST to `https://exp.host/--/api/v2/push/send`
with a body of `ExponentPushToken[...]` strings. Sentori doesn't
proxy through exp.host — your backend POSTs directly to the
Sentori ingest instead.

**Before** (expo-notifications):

```ts
await fetch('https://exp.host/--/api/v2/push/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    to: 'ExponentPushToken[xxx...]',
    title: 'New message',
    body: 'You have one new message',
    data: { url: '/messages/123' },
  }),
})
```

**After** (Sentori) — using `@goliapkg/sentori-next/push`:

```ts
import { sentoriPush } from '@goliapkg/sentori-next/push'

const push = sentoriPush({
  ingestUrl: process.env.SENTORI_INGEST_URL!,
  token: process.env.SENTORI_ADMIN_TOKEN!,
})

await push.send({
  to: 'ipt_xxx...',
  title: 'New message',
  body: 'You have one new message',
  data: { url: '/messages/123' },
})
```

The **device token** you store on the user record changes shape too:

- expo-notifications gave you `ExponentPushToken[...]`
- Sentori gives you `ipt_<uuid>` (after a one-time `POST /v1/push/tokens` registration)

The client-side `getDevicePushTokenAsync()` shim takes care of the
`/v1/push/tokens` registration call — you keep storing whatever the
function returns, just as a different string.

## 3. Upload provider credentials to Sentori

```bash
# APNs (iOS)
curl -X PUT "https://sentori.golia.jp/admin/api/projects/<id>/push/credentials" \
    -H "Authorization: Bearer st_admin_<token>" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "provider": "apns",
  "config": { "key_id": "...", "team_id": "...", "bundle_id": "...", "env_default": "production" },
  "secret": { "p8": "-----BEGIN PRIVATE KEY-----..." }
}
EOF

# FCM (Android)
curl -X PUT "https://sentori.golia.jp/admin/api/projects/<id>/push/credentials" \
    -H "Authorization: Bearer st_admin_<token>" \
    -d "{\"provider\":\"fcm\",\"config\":{\"project_id\":\"...\"},\"secret\":$(cat firebase-admin-sdk.json)}"
```

Or use the dashboard's Push module (`/main/.../push`) — same flow, no curl.

## 4. Feature parity matrix

What the shim covers today (one-line import swap is enough):

| `expo-notifications` API | Shim status |
|---|---|
| `getPermissionsAsync` | ✅ |
| `requestPermissionsAsync` (incl. iOS sub-options) | ✅ (`allowProvisional` falls back to regular auth — see follow-up) |
| `getDevicePushTokenAsync` | ✅ |
| `getExpoPushTokenAsync` | ✅ (returns native token wrapped — your backend POSTs to Sentori, not exp.host) |
| `unregisterForNotificationsAsync` | ✅ |
| `addNotificationReceivedListener` (foreground) | ✅ |
| `addNotificationResponseReceivedListener` (tap) | ✅ |
| `addPushTokenListener` (rotation) | ✅ |
| `setNotificationHandler` | ✅ (handler runs; presentation override is a follow-up) |
| `AndroidImportance` / `IosAuthorizationStatus` / `DEFAULT_ACTION_IDENTIFIER` / `SchedulableTriggerInputTypes` constants | ✅ (re-exported with same values) |

What throws today (each error message links to the relevant section below):

| `expo-notifications` API | Workaround |
|---|---|
| `scheduleNotificationAsync` + 7 trigger types {#local-scheduling} | No equivalent yet — local notifications require an `expo-task-manager`-style host integration. Until that lands, schedule on the server (Sentori send with `delay` is the v2.13+ candidate). |
| `setBadgeCountAsync` / `getBadgeCountAsync` {#badge} | iOS badge is set by the push payload (`options.badge`), not by an explicit client call. Android has no native badge API — use `notifee` or `react-native-push-notification`'s `setApplicationIconBadgeNumber` if you really need one. |
| `setNotificationChannelAsync` + channel groups {#android-channels} | Pass `options.channelId` in your Sentori send payload; the channel is created lazily by the SDK's default `"sentori"` channel on first push. If you need custom importance / vibration / lights, write a tiny native module that calls `NotificationManager.createNotificationChannel` from your `MainApplication`. |
| `setNotificationCategoryAsync` + interactive actions {#categories} | Categories require native action registration — the v2.18 SDK doesn't surface that yet. Pure-tap deep-linking still works through `addNotificationResponseReceivedListener`. |
| `useLastNotificationResponse` / `getLastNotificationResponseAsync` {#cold-start} | Returns `null` today. Cold-start deep-link from a tap is best handled by reading the system intent in your `AppDelegate` / `MainActivity` and forwarding to JS via `Linking.getInitialURL()`. |
| `subscribeToTopicAsync` / `unsubscribeFromTopicAsync` {#topics} | Sentori doesn't proxy FCM topics — use Audience cohorts (Users module → audience-by-tag) once you've got the `linkHash` flow set up, or hit FCM topics directly with a separate `firebase-admin` call. |
| `registerTaskAsync` (background task) {#background-task} | Background JS execution needs `expo-task-manager`. v2.18 shim doesn't ship a task-manager equivalent; if your app needs silent push to wake a JS task, keep using `expo-notifications` alongside Sentori for now (they coexist — different listeners, different transports). |
| `dismissNotificationAsync` / `dismissAllNotificationsAsync` / `getPresentedNotificationsAsync` {#dismissal} | Native `UNUserNotificationCenter.removeDeliveredNotifications` / `NotificationManager.cancelAll` are one tap away from any RN turbo-module; we'll surface them in a follow-up. |

## 5. Side-by-side: a typical register flow

**Before** (`expo-notifications`):

```ts
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

async function registerForPushNotificationsAsync() {
  const { status } = await Notifications.getPermissionsAsync()
  let final = status
  if (status !== 'granted') {
    final = (await Notifications.requestPermissionsAsync()).status
  }
  if (final !== 'granted') return null
  const tok = await Notifications.getExpoPushTokenAsync({ projectId: '<expo-project>' })
  // POST tok.data to your backend, your backend POSTs to exp.host
  await fetch('/api/register-device', {
    method: 'POST', body: JSON.stringify({ token: tok.data }),
  })
}

useEffect(() => {
  const sub1 = Notifications.addNotificationReceivedListener((n) => {
    console.log('foreground:', n)
  })
  const sub2 = Notifications.addNotificationResponseReceivedListener((r) => {
    console.log('tap:', r)
  })
  return () => { sub1.remove(); sub2.remove() }
}, [])
```

**After** (Sentori, same code, one-line import swap):

```diff
- import * as Notifications from 'expo-notifications'
+ import * as Notifications from '@goliapkg/sentori-react-native/expo-compat'
```

The `tok.data` you POST is now an APNs hex token (iOS) or FCM
registration token (Android). Your backend POSTs to
`/v1/push/tokens` instead of `exp.host/--/api/v2/push/send`. The
listener fires exactly the same `Notification` shape — `n.request.content.title`,
`r.notification.request.content.data`, etc. all work.

## 6. Coexistence — running both during the migration window

Nothing stops you from keeping `expo-notifications` AND adding
`@goliapkg/sentori-react-native/expo-compat`. They register
independently with the OS push service; you'd end up sending two
device tokens to two backends. Useful pattern for a 1-week
gradual cut-over where you compare delivery rates side-by-side.

## Related

- [Push from React Native iOS](/recipes/push-from-react-native-ios/) — the v2.9 recipe; `sentori.push.register` is the native-flavored alternative to this shim.
- [Push from React Native Android](/recipes/push-from-react-native-android/) — same for FCM.
- [Push notification architecture](/design/push-architecture/) — the cross-version design contract for the whole v2.7–v2.12 series.

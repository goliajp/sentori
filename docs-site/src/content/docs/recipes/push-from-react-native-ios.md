---
title: Push notifications — React Native iOS
description: v2.9 — opt-in APNs registration via @goliapkg/sentori-react-native, plus the host-side Info.plist + entitlement setup that real iOS push requires.
---

# Push notifications — React Native iOS

v2.9 ships the **iOS** branch of `@goliapkg/sentori-react-native`'s push
support. A single call from your app — `sentori.push.register(...)` —
walks the OS permission prompt, the APNs registration handshake, and
the device-token POST to Sentori. The token is delivered to the host
app via callbacks so foreground notifications + taps are handled
inline.

> **Default off.** The SDK never asks the user for permission on its
> own. The host app decides when to call `register()` — typically
> after onboarding or behind a settings toggle. Same opt-in posture
> as `trackAutoBreadcrumb` and the Web Push counterpart in v2.8.

> **iOS in this release.** Android FCM lands in v2.10. The recipe for
> Android will follow the same shape: `sentori.push.register()` with
> the same options will resolve to an `ipt_*` handle on both
> platforms.

## 1. Add APNs credentials to your Sentori project

Same one-time setup as any APNs sender. The Apple Developer console
gives you a `.p8` private key + a Key ID; your Apple team id and the
app's bundle id are already known.

```bash
curl -X PUT "https://sentori.golia.jp/admin/api/projects/<id>/push/credentials" \
    -H "Authorization: Bearer st_admin_<token>" \
    -H "Content-Type: application/json" \
    -d @- <<EOF
{
  "provider": "apns",
  "config": {
    "key_id": "ABCDEFGHIJ",
    "team_id": "1234567890",
    "bundle_id": "com.example.app",
    "env_default": "production"
  },
  "secret": {
    "p8": "$(cat AuthKey_ABCDEFGHIJ.p8 | tr -d '\n')"
  }
}
EOF
```

Sentori encrypts the `.p8` body at rest using `secrets.rs`
(`AES-256-GCM` with `HKDF-SHA256` derivation from
`SENTORI_SESSION_SECRET`).

## 2. Configure the iOS app

### Xcode — enable Push Notifications capability

Target → **Signing & Capabilities** → **+ Capability** → **Push
Notifications**. Xcode adds the `aps-environment` entitlement to your
`.entitlements` file. Signed `development` builds talk to APNs
sandbox; production builds talk to the prod APNs host. The Sentori
JS layer picks `env` based on `__DEV__` automatically, so the same
codepath works in both.

### Info.plist — background mode

Add the `remote-notification` background mode so iOS will wake your
app to deliver `content-available: 1` pushes:

```xml
<key>UIBackgroundModes</key>
<array>
  <string>remote-notification</string>
</array>
```

No other Info.plist keys required.

### AppDelegate — no code

The SDK method-swizzles
`application:didRegisterForRemoteNotificationsWithDeviceToken:` and
the failure variant. You don't need to override anything in your
`AppDelegate.swift` / `AppDelegate.mm`.

If your team has disabled swizzling at the host level, set this
opt-out flag in `Info.plist` and forward the delegate calls manually:

```xml
<key>Sentori.disableAppDelegateSwizzle</key>
<true/>
```

```swift
func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
) {
    SentoriPushNotifications.shared.handleRegisteredToken(deviceToken)
}

func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
) {
    SentoriPushNotifications.shared.handleRegistrationFailure(error)
}
```

## 3. Register from your React Native app

```tsx
import { useEffect, useState } from 'react'
import { sentori } from '@goliapkg/sentori-react-native'

export function NotificationsToggle() {
  const [ipt, setIpt] = useState<string | null>(sentori.push.getCachedIpt())
  useEffect(() => {
    // Re-bind handlers on app start in case the user opted in
    // during a previous launch — the buffered notifications will
    // flow through onMessage / onTap automatically.
    if (ipt) {
      void sentori.push.register({
        onMessage: (m) => console.log('foreground push:', m),
        onTap: (data) => console.log('tapped:', data),
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return ipt ? (
    <Button
      title="Disable notifications"
      onPress={() => sentori.push.unregister().then(() => setIpt(null))}
    />
  ) : (
    <Button
      title="Enable notifications"
      onPress={async () => {
        try {
          const { ipt } = await sentori.push.register({
            onMessage: (m) => console.log('foreground push:', m),
            onTap: (data) => console.log('tapped:', data),
          })
          setIpt(ipt)
        } catch (e) {
          console.warn('opt-in failed', e)
        }
      }}
    />
  )
}
```

The `ipt_*` handle is cached in
`@react-native-async-storage/async-storage` if you've installed it;
otherwise it lives in a module-scoped variable that survives reloads
but not full app kills.

If you've adopted Sentori's identity flow (v2.3 `setUser({ id })`),
pass the same hash as `linkHash`:

```ts
sentori.push.register({
  linkHash: sentori.hashIdentities({ email: user.email }).email,
  // ...
})
```

This binds the device to the user fingerprint, so backend sends can
target every device a user owns via the upcoming v2.11 "send to user"
helper (or directly via SQL in the meantime).

## 4. Send a push

Same as the v2.7 server foundation — any backend that can hit
`/v1/push/send` works. From a Next.js API route or Server Action:

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
  options: { priority: 'high', sound: 'default' },
})
```

Or via curl for one-off ops:

```bash
curl -X POST "https://ingest.sentori.golia.jp/v1/push/send" \
    -H "Authorization: Bearer st_admin_<token>" \
    -H "Content-Type: application/json" \
    -d '{ "to": "ipt_...", "title": "Hi", "body": "from sentori", "options": { "priority": "high" } }'
```

## 5. Observe the result

After the dispatch cron (≤ 30 s):

```bash
curl "https://ingest.sentori.golia.jp/v1/push/receipts/<send_id>" \
    -H "Authorization: Bearer st_admin_<token>"
# → { "ticket": { "status": "sent", "providerOutcome": "APNS_200", ... } }
```

In the running app:
- **Foreground**: the iOS notification banner is presented (we
  override the default suppression so the user sees it; UNUserNotificationCenter
  still fires the tap handler if they tap it).
- **Background / Locked**: standard iOS notification UI. Tap → app
  opens → `onTap(data)` fires when the app finishes hydration.

## Troubleshooting

**`/v1/push/tokens` returns 400 `invalid provider`** — the SDK
always sends `provider: 'apns'` on iOS. This only fires on a hand-
rolled call.

**Permission prompt never appears** — the prompt is one-shot per
app install. Once denied, iOS suppresses it. The user has to go to
**Settings → Notifications → YourApp → Allow Notifications** before
`register()` will succeed again.

**`APNs token not received within 8000 ms`** — a network or APNs
backend hiccup. The SDK times out cleanly. Retry by calling
`register()` again. On TestFlight provisioning the very first
register can take ~10 s; bump `tokenTimeoutMs` to 15000 if you see
this consistently.

**Sends stuck in `queued`** — the dispatch cron picks up rows every
30 s. If it's longer, check server logs for `push dispatch sweep
failed` warnings. Confirm `SENTORI_SESSION_SECRET` is set (the
dispatcher uses it to decrypt `push_credentials.secret_blob`).

**`APNS_400_BadDeviceToken` in the receipt** — token is dead.
Sentori auto-revokes the `device_tokens` row after 3 consecutive
`PermanentlyInvalidToken` outcomes.

**`APNS_400_BadEnvironmentKeyInToken`** — the device registered with
the sandbox APNs but the credentials' `env_default` is `production`
(or vice versa). The SDK chooses `env` from `__DEV__`; check the
build flavor matches the entitlement.

**Foreground notifications appear but `onMessage` doesn't fire** —
the 1 Hz drain loop pauses when the app goes background. Make sure
you call `register()` (which starts the loop) at least once after
the app becomes foreground.

## Related

- [Push notifications — Next.js Web Push](/recipes/push-from-nextjs/) — the v2.8 counterpart.
- [Push notification architecture](/design/push-architecture/) — the cross-version design contract.
- v2.10 Android (FCM) — same `sentori.push.register()` API, lands next.

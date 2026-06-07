---
"@goliapkg/sentori-react-native": minor
---

v2.9 — iOS push notification opt-in for React Native.

Third phase of the v2.7→v2.12 Push rollout. v2.7 shipped the server
foundation (APNs + FCM providers + dispatch cron + secrets-sealed
credentials + `/v1/push/*` routes); v2.8 shipped Web Push end-to-end;
v2.9 lights the iOS APNs branch for `@goliapkg/sentori-react-native`.

**New surface — `sentori.push.*`**

```ts
const { ipt } = await sentori.push.register({
  linkHash: '...',
  onMessage: (m) => { ... },
  onTap: (data) => { ... },
})
await sentori.push.unregister()
sentori.push.getCachedIpt() // ipt_... | null
await sentori.push.getStatus() // 'granted' | 'denied' | 'notDetermined' | ...
await sentori.push.requestPermission()
```

**Native iOS module**

A new `SentoriPushNotifications.swift` owns:

* UNUserNotificationCenter delegate (foreground + tap)
* AppDelegate method swizzle for
  `application:didRegisterForRemoteNotificationsWithDeviceToken:` +
  the failure variant. Idempotent; opt-out via Info.plist
  `Sentori.disableAppDelegateSwizzle = YES`.
* In-memory buffers (32-slot FIFO each) for the token, foreground
  notifications, and tap responses. JS drains them via a 1 Hz loop
  that pauses on background (battery rule).

`SentoriModule.swift` adds 5 ModuleDefinition exports:
`pushGetStatus`, `pushRequestPermission`, `pushRegister`,
`pushUnregister`, `pushDrainState`.

**JS flow**

`register()`:

1. `pushRequestPermission()` — OS prompt the first time.
2. `pushRegister()` — calls
   `UIApplication.registerForRemoteNotifications`.
3. Polls `pushDrainState()` at 200 ms ticks for up to 8 s waiting
   for the token; rejects with a tagged error on timeout / native
   failure / denied permission.
4. POSTs `/v1/push/tokens` with
   `provider: 'apns'`, `env: __DEV__ ? 'sandbox' : 'production'`,
   `nativeToken: <hex>`, `linkHash?`, `metadata`.
5. Caches the `ipt_*` handle to
   `@react-native-async-storage/async-storage` if installed,
   otherwise a module-scoped variable.
6. Starts a 1 Hz drain loop that fires `onMessage` / `onTap` from
   buffered events. Pauses on `AppState.change → 'background'`,
   resumes on `'active'`.

**Default off** — host calls `register()` when ready. Sentori SDK
init never triggers the OS prompt on its own. Same opt-in posture as
`trackAutoBreadcrumb` and v2.8's `registerWeb`.

**Recipe**

`docs-site/src/content/docs/recipes/push-from-react-native-ios.md` —
end-to-end walkthrough: APNs credential upload, Xcode capability +
Info.plist + entitlements setup, register flow, send via
`@goliapkg/sentori-next/push`, troubleshooting matrix for the APNS_*
status codes the server's dispatcher surfaces.

**Compatibility**

Wire shape is unchanged from v2.7 / v2.8. The new device tokens land
in the same `device_tokens` table with `provider: 'apns'`. Customers
sending via raw REST keep working with no changes.

iOS only in this release — Android FCM lands in v2.10, same JS API.

**Tests**

6 new bun tests in `src/__tests__/push.test.ts` cover:

* register rejects cleanly on denied permission
* register rejects cleanly on native-token timeout
* register POSTs the right shape (provider/env/nativeToken/linkHash)
  and resolves to the server-issued `ipt_*`
* register surfaces server errors
* foreground notifications buffered during the token wait flush to
  `onMessage`
* unregister DELETEs the cached `ipt`, clears local state, and calls
  the native unregister

Full RN test suite: 185 pass, 0 fail.

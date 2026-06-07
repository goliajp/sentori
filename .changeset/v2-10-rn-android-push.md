---
"@goliapkg/sentori-react-native": minor
---

v2.10 — Android FCM push notification opt-in for React Native.

Fourth phase of the v2.7→v2.12 Push rollout. v2.9 shipped the iOS
branch; v2.10 lights the Android FCM branch behind the same JS
surface — `sentori.push.register({...})` now resolves to an `ipt_*`
handle on Android too.

**Native — Kotlin**

* New `android/src/main/java/com/sentori/SentoriPushNotifications.kt`
  — static singleton owning the 32-slot FIFO buffers (token /
  notifications / taps), runtime POST_NOTIFICATIONS permission flow
  for Android 13+, and the FCM token retrieval via
  `Class.forName("FirebaseMessaging").getInstance().getToken()` so
  the SDK works whether or not Firebase is on the host's classpath.
* New `SentoriFirebaseMessagingService.kt` extends
  `FirebaseMessagingService` and routes `onNewToken` /
  `onMessageReceived` into `SentoriPushNotifications`. Manifest-
  registered in the SDK's `AndroidManifest.xml`; manifest merger
  combines it with the host app's manifest.
* `SentoriModule.kt` gains 5 ModuleDefinition exports identical to
  iOS: `pushGetStatus`, `pushRequestPermission`, `pushRegister`,
  `pushUnregister`, `pushDrainState`.
* `android/build.gradle` adds `compileOnly` on
  `com.google.firebase:firebase-messaging:24.0.3` so non-push hosts
  pay nothing. The host app declares the runtime Firebase dep + the
  `com.google.gms.google-services` plugin themselves.
* `AndroidManifest.xml` declares
  `<uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>`
  and the FirebaseMessagingService.

**JS — `src/push.ts` cross-platform**

* `detectPlatform()` reads `Platform.OS` from `react-native` (with
  test-only `__setPlatformForTests` hook).
* `registerWithServer` now sends `provider: 'fcm'` and omits `env`
  on Android. iOS still sends `provider: 'apns'` + `env: 'sandbox' |
  'production'` keyed by `__DEV__`.
* All other public surface (`register`, `unregister`, `getCachedIpt`,
  `getStatus`, `requestPermission`) is unchanged — host app code is
  platform-agnostic.

**Recipe**

`docs-site/src/content/docs/recipes/push-from-react-native-android.md`
walks the `google-services.json` placement, gradle deps, plugin
application, register flow, send via `@goliapkg/sentori-next/push`,
and a troubleshooting matrix for the FCM_* status codes the server
dispatcher surfaces.

**Tests**

One new bun test in `src/__tests__/push.test.ts` covers the Android
branch — asserts `provider: 'fcm'` is sent and `env` is omitted.
Full RN test suite 186 pass / 0 fail.

**Compatibility**

Wire shape unchanged from v2.7 / v2.8 / v2.9. Android device tokens
land in the same `device_tokens` table with `provider: 'fcm'`. Raw
REST customers keep working with no changes.

v2.11 — Expo config plugin + dashboard Push module — lands next.

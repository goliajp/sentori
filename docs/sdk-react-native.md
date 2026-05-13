# @goliapkg/sentori-react-native

React Native SDK for Sentori. Captures JS errors, iOS `NSException`,
Android uncaught Java/Kotlin exceptions, and ships them through a
batched HTTP transport.

## Install

```bash
bun add @goliapkg/sentori-react-native
# or npm / yarn / pnpm
```

Peer dependencies:

| Package | Required for |
|---|---|
| `react` >= 18 | always |
| `react-native` >= 0.74 | always |
| `expo-modules-core` >= 2.0 | native crash capture only (optional) |
| `@react-native-async-storage/async-storage` >= 1.23 | offline retry queue (optional) |

The optional ones are graceful no-ops when absent: pure-RN-without-Expo
is supported, just without native crash capture.

## Initialize

```ts
import { sentori } from '@goliapkg/sentori-react-native'

sentori.init({
  token: 'st_pk_<your project token>',
  release: 'myapp@1.2.3+456',
  ingestUrl: 'https://sentori.your-host.com', // optional
})
```

| Option | Type | Required | Default |
|---|---|---|---|
| `token` | string | yes | — (must start with `st_pk_`) |
| `release` | string | yes | format `<name>@<version>+<build>` |
| `environment` | string | no | `'dev'` if `__DEV__`, else `'prod'` |
| `ingestUrl` | string | no | `https://ingest.sentori.golia.jp` |
| `capture` | object | no | all sources on |

`capture` toggles (all default true):

- `globalErrors`: `ErrorUtils.setGlobalHandler`
- `promiseRejections`: `HermesInternal.enablePromiseRejectionTracker`
- `network`: fetch wrapper that adds `net` breadcrumbs (auth params auto-redacted)

## Capture API

### `sentori.captureError(error, extras?)`

```ts
try {
  doSomething()
} catch (e) {
  sentori.captureError(e as Error, {
    tags: { screen: 'Checkout' },
    user: { id: 'u_abc' },
    fingerprint: ['order-checkout-failure'],
  })
}
```

### `sentori.setUser(user)` / `sentori.getUser()`

```ts
sentori.setUser({ id: 'u_abc', anonymous: false })
sentori.setUser(null) // clear
```

### `sentori.addBreadcrumb(input)`

```ts
sentori.addBreadcrumb({
  type: 'user',
  data: { action: 'tap', target: 'submit' },
})
```

Types: `nav` / `net` / `log` / `user` / `custom`. Ring buffer caps at 100
entries.

### `sentori.ErrorBoundary`

```tsx
<sentori.ErrorBoundary fallback={<Crashed />}>
  <App />
</sentori.ErrorBoundary>
```

`fallback` can be a node or a function `(error, reset) => ReactNode`.

## Native crash capture

iOS `NSException` + Android `Thread.UncaughtExceptionHandler` are
captured natively, written to disk, and drained on the next launch.

Expo Go does not support custom Expo modules. To enable native capture,
switch the host app to a development build:

```bash
bunx expo prebuild
cd ios && bundle exec pod install && cd ..
bun run ios     # or `bun run android`
```

The crash file location:

- iOS: `<Documents>/sentori/pending/<uuid>.json`
- Android: `<filesDir>/sentori/pending/<uuid>.json`

`sentori.init` reads + deletes those files on startup and pipes the
events through the same HTTP transport as JS errors.

For testing the round-trip:

```ts
import { triggerNativeCrash } from '@goliapkg/sentori-react-native'
triggerNativeCrash()  // closes the app on real crashes
```

After the relaunch, the server stdout (and dashboard) shows a
`platform: ios` or `platform: android` event.

## Source maps

**In `__DEV__`**, the SDK asks Metro's `/symbolicate` to resolve the
stack before sending — so dev errors land in the dashboard already
pointing at `src/Foo.tsx:42` (the same thing RN's LogBox does). Nothing
to configure; if Metro isn't reachable the raw stack is sent.

**For a release build**, Hermes double-minifies the bundle, so upload
the *composed* (Metro + Hermes) source map tagged to the release —
`sentori-cli react-native upload` does the compose + upload in one
step:

```bash
npx react-native bundle --platform ios --dev false --entry-file index.js \
  --bundle-output main.jsbundle --sourcemap-output main.jsbundle.packager.map
# (the iOS/Android build then compiles to Hermes → main.jsbundle.hbc.map)
npx @goliapkg/sentori-cli react-native upload \
  --release "myapp@1.2.3+456" --token "$SENTORI_ADMIN_TOKEN" \
  --metro-map main.jsbundle.packager.map --hermes-map main.jsbundle.hbc.map \
  --bundle main.jsbundle
```

`--release` must equal `init({ release })`. The server symbolicates
matching events at ingest and groups the issue on the original-source
frame. Full CI / EAS recipe: docs → Recipes → "Source map upload".

## Screenshot capture (opt-in)

Phase 42 sub-D — when `captureException` fires, the SDK can grab a
screenshot of the current screen, ship it to the server, and surface
it in the issue's "Captured at error" gallery. Off by default; flip
it on in `init`:

```ts
sentori.init({
  token: 'st_pk_…',
  release: 'myapp@1.2.3+456',
  capture: { screenshot: true },
})
```

Requirements:

```sh
bun add react-native-view-shot
```

`react-native-view-shot` is declared as an **optional** peer
dependency — apps that don't enable screenshots never have to
install it.

### Per-call override

```ts
sentori.captureException(err, { screenshot: false })
```

Always wins over the global `init` flag — useful on sensitive
screens you'd rather not snapshot at all.

### Redacting sensitive UI

Two redaction paths, depending on whether you own the view tree:

```tsx
import { MaskRegion } from '@goliapkg/sentori-react-native'

// Declarative: wrap any subtree that contains PII.
<MaskRegion>
  <CreditCardForm />
</MaskRegion>

// Imperative: third-party views you can't wrap.
import { setMaskedNode, unsetMaskedNode } from '@goliapkg/sentori-react-native'
const videoRef = useRef<VideoComponent>(null)
useEffect(() => {
  setMaskedNode(videoRef.current)
  return () => unsetMaskedNode(videoRef.current)
}, [])
```

The native iOS / Android screenshotters in sub-E / sub-F consult
the masked-node table before drawing. On the JS side, the
`react-native-view-shot` library doesn't expose a "redact these
rects" hook directly — wrap `<MaskRegion>` around the actual
content you want hidden and paint it black yourself if you need
absolute guarantees today.

### Performance

The capture path yields the JS thread twice before invoking the
native screenshotter (`InteractionManager.runAfterInteractions` →
`requestAnimationFrame`) so it never extends the active gesture or
animation by a frame. The resulting image is capped to **480 px
on the long edge** at **JPEG q=70** — typical payload 50-100 KB
under the server's 500 KB hard limit. A **1.5 s timeout** silently
gives up if the capture or the upload stalls; the error event
still ships without a thumbnail.

### Session budget

Capped at **10 screenshots per session in prod** (no cap in dev)
to prevent runaway render-loop crash storms from filling storage.

### What lands on the server

Each captured screenshot becomes one row in `event_attachments`
and one binary blob on disk under `$SENTORI_ATTACHMENT_DIR`. The
dashboard surfaces them inline on the issue-detail page. Server
retention sweep drops the rows + blobs on the events partition
schedule (default 30 days). Self-hosted operators: see
`SENTORI_ATTACHMENT_DIR` in `docs/self-hosting.md`.

## What this SDK does NOT do (v0.1)

- Native signal-based crashes (SIGSEGV / SIGABRT) — only `NSException`
  on iOS, only `Thread.UncaughtExceptionHandler` on Android.
- ANR detection on Android.
- Session replay, profiling, distributed tracing (the `traceId` /
  `spanId` slots are reserved in the schema but unused).
- iOS XCTest / Android Robolectric coverage of the native modules.

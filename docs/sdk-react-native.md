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

## Native debug symbols

Native crashes (iOS `NSException`, Android `Thread.UncaughtExceptionHandler`)
arrive with raw frame addresses. To get readable `file:line:function`
in the dashboard — the same `<FrameSourceDrawer>` experience JS
frames get — upload your build's debug-symbol artifact:

| platform | artifact          | command                                 |
| -------- | ----------------- | --------------------------------------- |
| iOS      | `Foo.dSYM` bundle | `sentori-cli upload dsym <path>`        |
| Android  | `mapping.txt`     | `sentori-cli upload mapping <path>`     |

### iOS dSYM

The CLI walks the `.dSYM` bundle, enumerates each Mach-O slice via
`dwarfdump --uuid`, and uploads them all. Run it after each release
build (Xcode Archive / EAS build):

```bash
npx @goliapkg/sentori-cli upload dsym \
  --project "$SENTORI_PROJECT_ID" \
  --token "$SENTORI_ADMIN_TOKEN" \
  --release "myapp@1.2.3+456" \
  ./build/MyApp.dSYM
```

`--release` must equal `init({ release })` exactly. In Linux CI
where `dwarfdump` isn't available, pass `--debug-id <uuid> --arch
arm64` and the CLI uploads a single slice instead of auto-discovering.

#### Xcode Run Script (auto-upload after Archive)

Drop this as a Run Script build phase **after** "Embed Pods Frameworks":

```bash
# Sentori dSYM auto-upload
if [ "$CONFIGURATION" != "Release" ]; then exit 0; fi
export SENTORI_PROJECT_ID="<project-uuid>"
export SENTORI_ADMIN_TOKEN="<admin-token>"   # store in a .env, not in git
RELEASE="${PRODUCT_BUNDLE_IDENTIFIER}@${MARKETING_VERSION}+${CURRENT_PROJECT_VERSION}"
find "${DWARF_DSYM_FOLDER_PATH}" -name "*.dSYM" -maxdepth 2 | while read dsym; do
  npx -y @goliapkg/sentori-cli upload dsym \
    --project "$SENTORI_PROJECT_ID" \
    --token "$SENTORI_ADMIN_TOKEN" \
    --release "$RELEASE" \
    "$dsym"
done
```

### Android ProGuard / R8

After `assembleRelease` (or your prod variant), upload `mapping.txt`:

```bash
npx @goliapkg/sentori-cli upload mapping \
  --project "$SENTORI_PROJECT_ID" \
  --token "$SENTORI_ADMIN_TOKEN" \
  --release "myapp@1.2.3+456" \
  android/app/build/outputs/mapping/release/mapping.txt
```

If the mapping file starts with the R8 `# pg_map_id:` line the
server sniffs the debug-id from it; otherwise pass it explicitly
with `--debug-id`.

#### Gradle hook (auto-upload after assembleRelease)

Add to `android/app/build.gradle`:

```gradle
afterEvaluate {
  tasks.matching { it.name == 'assembleRelease' }.all { releaseTask ->
    releaseTask.finalizedBy(tasks.register("sentoriUploadMapping", Exec) {
      workingDir rootProject.projectDir
      def release = "${android.defaultConfig.applicationId}@${android.defaultConfig.versionName}+${android.defaultConfig.versionCode}"
      commandLine 'npx', '-y', '@goliapkg/sentori-cli', 'upload', 'mapping',
        '--project', System.getenv('SENTORI_PROJECT_ID'),
        '--token',   System.getenv('SENTORI_ADMIN_TOKEN'),
        '--release', release,
        "${buildDir}/outputs/mapping/release/mapping.txt"
    })
  }
}
```

### When it didn't symbolicate

The dashboard issue detail shows `releaseHasMap: true|false` on
each event. If `true` but frames are still raw, the upload's
`--release` doesn't match the SDK's `init({ release })` for that
build, or the dSYM debug-id doesn't match this build's binary
(common when a CI run re-builds with the same version string but
a new arch slice). Server log greps for `symbolicate` to confirm.

## Screenshot capture (opt-in)

When `captureException` fires the SDK can grab a screenshot of the
current screen and ship it as an attachment on the error event. Off
by default; flip it on in `init`:

```ts
sentori.init({
  token: 'st_pk_…',
  release: 'myapp@1.2.3+456',
  capture: { screenshot: true },
})
```

Since v0.7.3 the capture goes through the SDK's own native module
(iOS `UIGraphicsImageRenderer`, Android `PixelCopy`). No peer dep
to install — `react-native-view-shot` was dropped in 0.7.3.

### Per-call override

```ts
sentori.captureException(err, { screenshot: false })
```

Always wins over the global `init` flag — useful on sensitive
screens you'd rather not snapshot at all.

### Redacting sensitive UI

The SDK exposes a single hook — `registerMaskQuery` — and lets the
host app own the registry of regions to black out. The pattern in
your code base (lives outside the SDK, never imports from it):

```tsx
// app/src/observability/mask.tsx
import { useEffect, useRef } from 'react'
import { View, type ViewProps } from 'react-native'

const registry = new Set<string>()
export const getMaskedNativeIds = (): string[] => Array.from(registry)

export function Maskable({ children, ...rest }: ViewProps & { children?: React.ReactNode }) {
  const idRef = useRef(`mask-${Math.random().toString(36).slice(2, 10)}`)
  useEffect(() => {
    const id = idRef.current
    registry.add(id)
    return () => { registry.delete(id) }
  }, [])
  return (
    <View collapsable={false} nativeID={idRef.current} {...rest}>
      {children}
    </View>
  )
}
```

Wire it once at boot, next to `initSentori`:

```ts
import { sentori } from '@goliapkg/sentori-react-native'
import { getMaskedNativeIds } from '@/observability/mask'

sentori.registerMaskQuery(getMaskedNativeIds)
```

Then any PII surface uses `<Maskable>` — no SDK import in the UI:

```tsx
<Maskable><Text>{user.email}</Text></Maskable>
<Maskable className="absolute inset-0"><CameraPreview /></Maskable>
```

At capture time the SDK calls the query once, walks the native
view tree by `nativeID` (iOS `accessibilityIdentifier`, Android
`view.tag`), and paints a black rectangle over each match on the
captured bitmap. No live-UI flicker — the redaction is on the
off-screen image.

### Performance

The capture yields one `requestAnimationFrame` paint before
asking the OS to snapshot, so post-error UI state has committed.
Output: 480 px on the long edge, JPEG q=70 (iOS) or WEBP_LOSSY
q=70 (Android 11+) / JPEG q=70 (Android 7-10). Typical payload
30-100 KB, well under the server's 500 KB hard limit. On any
failure (no key window, render rejected, timeout) the function
returns null silently — the error event still ships.

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

## Session trail (opt-in)

Phase 46 — record the last 30 steps (route changes, custom
breadcrumbs) leading up to a crash and ship them as a `sessionTrail`
attachment alongside the next `captureException`. The dashboard
renders the buffer as a scrubbable timeline so you can step through
"what the user was doing in the 8 seconds before this NPE".

Off by default; flip it on in `init`:

```ts
sentori.init({
  token: 'st_pk_…',
  release: 'myapp@1.2.3+456',
  capture: { sessionTrail: true },
})
```

### Auto-recorded steps

When you mount `useTraceNavigation(navigationRef)` (see Navigation
tracing above), every screen transition pushes a step like
`screen:Home` into the trail. No extra wiring needed.

### Manual steps

```ts
import { captureStep } from '@goliapkg/sentori-react-native'

captureStep('checkout:tapped-pay', {
  breadcrumb: { type: 'custom', message: 'cart $42.10, 3 items' },
})
```

`captureStep` is a no-op when sessionTrail isn't enabled — the
buffer just stays empty and is cleared after each captureException.
You can leave the calls in production safely.

### Privacy + size

- Trail JSON is < 5 KB for 30 steps without screenshots.
- Screenshots are **not** auto-attached to steps. If you want one,
  pass `screenshotRef` explicitly after a separate
  `captureScreenshot` upload.
- The buffer is **per-process**, in-memory only; nothing is
  persisted to AsyncStorage or disk.
- One trail per crash: the buffer is sealed and cleared inside
  `captureException`, so successive crashes get fresh trails.

## Wireframe replay (opt-in, v1.0)

v1.0 adds a wireframe **session replay** ring. The native side
walks the UIView (iOS) / decor View (Android) hierarchy at a fixed
cadence and serialises each visible node as a compact rect descriptor
(`{ kind, x, y, w, h, text?, color? }`). The ring keeps the last
60 snapshots (60 seconds at the 1 Hz default) and flushes as a
`replay` attachment on every `captureException`.

Off by default; flip on in `init`:

```ts
sentori.init({
  token: 'st_pk_…',
  release: 'myapp@1.2.3+456',
  capture: { replay: { mode: 'wireframe', hz: 1 } },
})
```

`hz` is sampler frequency in Hz. Default 1 (one snapshot per
second). 2 Hz is the sweet spot for "felt fluid" replays of
animations; > 2 Hz starts to compete with the JS thread for
main-queue dispatches on mid-tier Android.

### What you get on the dashboard

The issue detail page grows a **Replay** tab between Stack and
Events when the event has a replay attachment. It renders the
frame stream as:

- a SVG canvas at the device viewport's aspect ratio — every node
  is a `<rect>` with optional text glyph; same primitive shape the
  native sampler emits
- a horizontal **thumbnail rail** — one mini SVG per frame,
  click-to-jump
- a **time slider** + Prev / Play / Next + 2 Hz auto-play
- keyboard nav: ←/→ step, Space play/pause, Home/End jump
- a **diff vs prev** toggle — added (green) / changed (amber) /
  removed (red ghost) outlines on each node, plus a per-frame
  count rail

### Why wireframe, not raster

- **Storage** — 80 nodes × ~80 bytes ≈ 6 KB per snapshot. A 60-slot
  ring is ~360 KB raw, well under the 500 KB attachment cap. Raster
  session replay is 50 KB / frame on the same scene.
- **Privacy** — no pixels means no accidental PII leaks. Mask
  registry decides what text is replaced with `***`.
- **Replay fidelity** — less faithful to pixels but enough to see
  which screen the user was on and what was on it, which is the
  question that matters during triage.

### Mask registry

```ts
sentori.registerMaskQuery(() => {
  // Return the list of nativeIDs (iOS) / view tags (Android) the
  // sampler should mask out. Called once per tick — keep it
  // O(small).
  return ['login.password', 'profile.dob', 'payment.cc-number']
})
```

A node whose accessibilityIdentifier / View.tag matches is rendered
as a single black mask rectangle and its subtree is skipped.

### Diagnostic + drain APIs (advanced)

For dev verification, the SDK exposes three calls beyond
`captureException`:

```ts
import {
  drainReplay,
  probeNativeWireframe,
  startReplay,
  stopReplay,
} from '@goliapkg/sentori-react-native'

// One-shot status of the native side. Useful in a "Why is my ring
// empty?" debug screen. See the iOS showcase
// `apps/ios-showcase/SentoriShowcase/Views/ActionGrid.swift` for
// the canonical usage.
const probe = probeNativeWireframe()
// {
//   available: true,
//   lastPath: 'scene.fg.key',   // which keyWindow tier resolved
//   lastNodes: 47,
//   sceneCount: 1,
//   windowCount: 1,
// }

// Manually drain the ring as NDJSON without firing a captureException.
// Side effect: clears the ring. Use sparingly.
const ndjson = drainReplay()

// Hot-start / hot-stop (init() does this automatically when the
// `capture.replay` option is set; exposed for dev tooling).
startReplay({ mode: 'wireframe', hz: 2 })
stopReplay()
```

### Known surface

- iOS: requires iOS 13+ (the sampler uses `connectedScenes`); falls
  back to `UIApplication.shared.windows.first` on iOS 12.
- Android: walks the current Resumed Activity's decor view; sampler
  returns null between activity transitions.
- Hermes on RN ≤ 0.82 had a `Timer.unref` interop bug that killed
  the sampler tick. Fixed in the SDK in v1.0.0-rc.1; consumer apps
  on Hermes 0.83+ are unaffected.

## What this SDK does NOT do (v0.1)

- Native signal-based crashes (SIGSEGV / SIGABRT) — only `NSException`
  on iOS, only `Thread.UncaughtExceptionHandler` on Android.
- ANR detection on Android.
- Session replay, profiling, distributed tracing (the `traceId` /
  `spanId` slots are reserved in the schema but unused).
- iOS XCTest / Android Robolectric coverage of the native modules.

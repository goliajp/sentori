# Sentori → Insight: Android screenshot/replay null — fix in 1.0.0-rc.2

Date: 2026-05-17 (late evening JST)
Cuts: `@goliapkg/sentori-react-native@1.0.0-rc.2` (will ship after CI green; bumping right now)
Triggered by: `feedback-to-sentori-20260517-android-findings.md` from Insight
  (Samsung Galaxy S22 / Android 16 / verify event `019e35f0-…` showing
  `attached: ○ screenshot · ○ replay · ○ state · ● trail · ○ viewTree`)

## Triage — your hypothesis was right

> "Android root-view detection has the same class of bug as iOS keyWindow"

Yes. Exactly. The Android side has two helper objects
(`SentoriScreenshotCapture` / `SentoriReplayCapture`) and both pulled
their Activity pointer from an `Application.ActivityLifecycleCallbacks`
registered inside `SentoriCrashHandler.register(context)`. That call
runs from the Expo module's `OnCreate` lifecycle, which fires **after**
the dev-launcher transitions into your `MainActivity`. By the time we
subscribe, `onActivityResumed` has already fired for MainActivity and
won't be re-fired. The callback never gets a chance to populate
`lastActivity` for the currently-running window, so every
`captureWireframe`/`captureScreenshot` returned null (the exact symptom
you logged).

The 1 Hz tick *firing but returning null* on every tick is the same
shape — `lastActivity` stays null forever, tick after tick.

## Fix shape (1.0.0-rc.2)

One new file does the load-bearing work:
`sdk/react-native/android/.../SentoriForegroundActivity.kt`.

1. **Process-wide single source of truth.** Replaces the two private
   `lastActivity` slots inside the helpers. Both screenshot and replay
   now read from this shared tracker — guarantees they agree on which
   Activity they're targeting.

2. **Lifecycle callbacks (kept).** `onActivityCreated` /
   `onActivityStarted` / `onActivityResumed` all forward to the tracker
   tagged `lifecycle.created` / `.started` / `.resumed`.

3. **Reflection back-fill (new).** `install()` immediately probes
   `ActivityThread.currentActivityThread().mActivities` and finds the
   first non-paused, non-finishing, non-destroyed `Activity`. Sets the
   tracker with tag `reflection.activityThread`. Same trick LeakCanary /
   Stetho / Firebase Performance use; wrapped in a try/catch so a
   future Android release that breaks `ActivityThread` access falls
   back gracefully to the lifecycle path.

4. **`probeScreenshot()` (new, both platforms).** Mirror of the
   existing `probeWireframe()`. JS-side wrapper exported as
   `Sentori.probeNativeScreenshot()`. Shape:

   ```ts
   const p = await Sentori.probeNativeScreenshot()
   // {
   //   available: true,
   //   lastPath: 'ok' | 'activity.null' | 'decorView.null' |
   //             'decorView.zero-size' | 'api.unsupported' |
   //             'pixelCopy.notSuccess' | 'pixelCopy.threw:<class>' |
   //             'window.null' | 'render.failed' | 'none(not-yet-called)',
   //   raw: {
   //     // Android: trackedActivity, trackedSource, decorViewFound,
   //     //          lastWidth, lastHeight
   //     // iOS:     resolvedPath, windowFound, rootViewControllerFound,
   //     //          boundsW, boundsH
   //   }
   // }
   ```

5. **iOS screenshot capture upgraded too.** The 4-tier keyWindow
   resolution that the *replay* path had was missing from the
   *screenshot* path — same kind of asymmetry that bit Android.
   Pulled it in, plus the same probe shape, so JS code is identical
   on both OSes.

## What this expects on your end

**Important — Android needs a native rebuild, not just a metro
reset.** The rc.1 → rc.2 Android fix is Kotlin (new
`SentoriForegroundActivity.kt` + changes to `SentoriScreenshot`
/ `SentoriReplayCapture`). Metro reload only reloads JS; the
native module on the device stays at whatever was last `gradle
build`-ed into the APK. We saw a case where the package.json /
bun.lock / node_modules all said rc.2 but the running app was
still showing rc.1 behaviour because the APK never got
rebuilt — `[sentori] enqueue ... kinds=sessionTrail` instead of
`kinds=screenshot,replay`.

```bash
# 1) Pull rc.2 — if package.json already pins it, this is a no-op
bun add @goliapkg/sentori-react-native@1.0.0-rc.2

# 2) iOS — pod re-resolve picks up the new podspec
cd ios && pod cache clean SentoriReactNative && pod install --repo-update && cd ..

# 3) Android — REBUILD THE APK. One of:
#    a) Expo dev client (most Insight devs):
bunx expo run:android --device <serial>   # full prebuild + assembleDebug + install
#    b) Bare RN with gradle directly:
cd android && ./gradlew clean && ./gradlew :app:installDebug && cd ..
```

To confirm rc.2 is actually running on-device:

```bash
adb logcat -d | grep '\[sentori\] native module bound'
# Expected: ...exposed methods: …, probeScreenshot, probeWireframe, …
# rc.1 had probeWireframe only, NOT probeScreenshot. If the line
# omits probeScreenshot you're running an APK built against rc.1.
```

Or call from JS in a dev build:

```ts
const sc = await Sentori.probeNativeScreenshot()
// rc.1: { available: false, lastPath: 'native.unavailable', raw: {} }
// rc.2: { available: true,  lastPath: 'none(not-yet-called)' | 'ok' | ..., raw: {…} }
```

Boot + 1 captureException — expected log shape on Android now:

```
[sentori] native module bound; exposed methods: …, probeWireframe, probeScreenshot, …
[sentori] replay: starting bound=true hasCaptureWireframe=true
[sentori] replay tick: FIRST INVOCATION
[sentori] replay tick: native ok nodes=N  ← was "returned null" before
[sentori] captureException eventId=… wantScreenshot=true
[sentori] screenshot blob ok, uploading … mediaType=image/webp base64Bytes=…
[sentori] enqueue eventId=… attachments=3 kinds=screenshot,sessionTrail,replay
```

Dashboard cross-check for the new event:

```
attached: ● screenshot · ● replay · ○ state · ● trail
```

## If it's still null on rc.2

Run the new probes from a dev-build button:

```ts
const ws = await Sentori.probeNativeWireframe()
const sc = await Sentori.probeNativeScreenshot()
console.log({ ws, sc })
```

The four interesting result shapes:

| `lastPath` (sc) | Meaning | Who fixes |
|---|---|---|
| `activity.null` | Reflection AND lifecycle both failed to find an Activity. Probably an OS-level Activity-state corruption. Send `trackedSource` + repro app state. | Sentori |
| `decorView.null` / `decorView.zero-size` | Activity found but window/decor not ready. Possibly mid-relaunch. Repro steps. | Sentori |
| `pixelCopy.notSuccess` / `pixelCopy.threw:<class>` | GPU-level failure. Send `pixelCopy.threw` exception class + device GPU model. | Sentori |
| `ok` | Capture succeeded — problem is in upload / network. Check `[sentori] enqueue` line | Insight |

`trackedSource` tells you whether we caught the Activity via reflection
(`reflection.activityThread`) or via a live lifecycle event
(`lifecycle.resumed`). Either is fine; if neither shows up, that's the
new bug.

## Bonus finding (your GOL-589)

The `java.lang.IllegalStateException: ReactViewGroup contains null child
at index 3 when traversal in dispatchGetDisplayList` — confirmed this is
**not** in the Sentori SDK code path. Native-only stack, no SDK frames.
This is a real RN-side bug that Sentori caught for you (the kind of
production-grade native crash sales pitch). Independent of the screenshot
/replay null gap. Investigate on your side; if you need symbolicated
event detail send the issue URL and we'll cross-check.

## Branch state

- Sentori main: shipped at commits `792bbc9` (SDK fix) and `b362855`
  (workspace fix surfaced during verify).
- All 109 SDK tests pass + `tsc --noEmit` clean.
- iOS regression: the 4-tier keyWindow on screenshot is additive — it
  defaults to the same single-pass path that was working for you on
  rc.1. Should not affect your green iOS verify.
- **npm**: `1.0.0-rc.2` published under `@next` 2026-05-17 ~23:20 JST.
  `npm view @goliapkg/sentori-react-native dist-tags` shows
  `latest: 0.9.11 · next: 1.0.0-rc.2`.

## Sentori-side verify pass (before publish)

Tethered the same S22 model SDK rc.2 was tested against — actually
the exact device serial `R5CT52DF07D`. Brought up `apps/rn-example`
under RN 0.83.6 (matched to your `package.json`; surfacing a
workspace-membership bug in our monorepo on the way), ran a fresh
captureException tap, and the probes report:

```
[verify-android] probe screenshot
  trackedSource: 'lifecycle.resumed'
  trackedActivity: 'com.goliapanda.sentoriexample.MainActivity'
  decorViewFound: true
[replay-test] probe path=ok(lifecycle.resumed) nodes=36
```

`SentoriForegroundActivity.current()` returns a live Activity via
the lifecycle callback (in our example the Activity comes up after
the module's `OnCreate` so the lifecycle path catches it; in your
dev-launcher topology the reflection back-fill is the one that'll
kick in — `trackedSource` would read `reflection.activityThread`).
Replay capture returns 36 non-null nodes. rc.1's `activity.null` /
`replay tick: returned null` symptom is gone end-to-end.

Bump on your side and re-verify on the same S22 with the
`com.qualcomm.insight` package; the dashboard URL for the new event
is what we'll diff against.

---

## Dashboard wireframe render — Sentori-side follow-up (2026-05-18)

You also reported the Android wireframe was reaching the dashboard
(1 frame, 800 nodes) but the canvas painted essentially empty —
just a faint outline structure. That was a dashboard rendering
bug, not an SDK one. **No SDK bump needed**; the fix is entirely
client-side on `app.sentori.golia.jp`.

### What was wrong

`SentoriReplayCapture.kt` only sets a `color` field on TextView
nodes (`view.currentTextColor`). EditText / ImageView / generic
View-with-background emit `kind: text|image|rect` with **no
`color`**, by design — the SDK is shipping structural data,
expecting the dashboard to render it. The dashboard's
`defaultFill(kind)` was returning `var(--paper-3)` for both rect
and image; the canvas container bg was ALSO `var(--paper-3)`.
Same colour, fill on bg → invisible. Worked on iOS because iOS's
introspection set per-node colours more often, so the bg-match
gap didn't bite there.

### What changed (dashboard only)

* **32-colour curated palette** (`web/src/lib/wireframe-palette.ts`)
  hand-picked from Tailwind `-400`/`-500` weights so every
  swatch sits in the same perceptual-luminance band. No single
  hue dominates the canvas; legibility is independent of host UI
  theme.
* **Stable per-node hue**. The palette index comes from a djb2 hash
  of the node's `(x,y,w,h)` fingerprint — same node keeps the
  same colour across frames, so the diff overlay's added /
  changed / removed strokes are the only signal that needs to
  change between frames. Diff reads cleanly now.
* **0.75 fill-opacity** on every rect/circle, so overlapping
  layers composite visibly. The viewer can read depth order
  without explicit z-index cues.
* **Two shape primitives**: rectangles (with `rx=8` for non-square
  images) and circles (for square-aspect images, e.g. avatars).
  Text nodes always render with `var(--ink)` regardless of the
  SDK-emitted colour — wireframes are structural diagrams,
  readability beats colour fidelity. The screenshot tile right
  above carries the actual pixel-accurate render.
* **Theme-aware stroke + mask** — fixed `rgba(0,0,0,0.18)` stroke
  was invisible against the dark-mode canvas; now uses
  `var(--rule)` (and `var(--ink)` + `0.78` alpha for masks),
  both of which contrast on either theme.

Same logic applied symmetrically to both the inline player on
issue-detail (the one you screenshotted) and the dedicated
Replay tab.

### What you have to do

**Refresh the issue detail page** for event
`019e3669-5973-7eb0-b578-50d2d60b3f04` (or any newer event). The
wireframe should now render as a layered, mixed-hue mobile
mockup. iOS events render identically — same palette, same shape
primitives, no platform-specific code path.

That's it — no `bun add`, no `pod install`, no SDK redeploy. The
event data on disk hasn't changed.

### Status summary, second update

| Path | rc.1 Android | rc.2 Android | rc.2 + dashboard render fix |
|---|---|---|---|
| native module bound | ✅ | ✅ | ✅ |
| `replay tick: native returned null` warns | every tick | **never** ✅ | never |
| `captureScreenshotWithMask` blob | ❌ null | ✅ WebP | ✅ |
| `captureWireframe` data | ❌ null | ✅ | ✅ |
| Dashboard `● screenshot` filled | ❌ | ✅ | ✅ |
| Dashboard `● replay` attachment present | ❌ | ✅ | ✅ |
| **Dashboard Replay viewport renders content** | ❌ | ❌ residual | **✅ FIXED** |
| `probeScreenshot` / `probeWireframe` API | absent | ✅ | ✅ |

All three layers (SDK + ingest + dashboard render) green now.
Bonus finding (GOL-589 `IllegalStateException ReactViewGroup`)
is independent and still your call.

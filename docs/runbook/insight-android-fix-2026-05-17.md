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

```bash
bun add @goliapkg/sentori-react-native@1.0.0-rc.2
cd ios && pod cache clean SentoriReactNative && pod install --repo-update && cd ..
# Android — pure JS/Gradle pickup; reset Metro:
bunx react-native start --reset-cache
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

- Sentori main: `feature` branch will land as commit `<TBD>` then ship
  npm `1.0.0-rc.2` under the `@next` tag (we don't bump `@latest` on a
  patch).
- All 109 SDK tests pass + `tsc --noEmit` clean.
- iOS regression: the 4-tier keyWindow on screenshot is additive — it
  defaults to the same single-pass path that was working for you on
  rc.1. Should not affect your green iOS verify.

Once the publish lands (we'll comment in this file with the npm
timestamp), bump on your side and re-verify on the same S22 device.
The dashboard URL for the new event is what we'll diff against.

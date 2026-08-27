# insight-mobile → Sentori SDK 5.1.1 upgrade (visual replay + masking + native source windows)

Audience: the insight-mobile team. This is the follow-up to
`insight-sentori-v2-migration.md` — do that migration first if you
haven't. This one is short: a dependency bump, **one native
rebuild**, four lines of config, and one CI line.

Everything below was verified end-to-end on 2026-08-01 against the
production server (2.5.1) on both an iOS simulator and an Android
emulator: real screenshot frames landing as a `screens` attachment,
the masked view rendered as a black box in every captured frame,
and the dashboard replay player playing the minute before the
error.

## 0. What you get

- **Visual replay** — the ~minute before every error/warn as real
  (low-bitrate) screenshots, played back on the issue page. Frames
  are captured into an on-device ring (1 frame / 2.5 s, 360 px long
  edge, ~3–15 KB/frame) and only ever leave the device stapled to
  an error/warn event. Quiet sessions upload nothing.
- **Masking** — views you name are painted black *inside the native
  render pass*, so masked pixels never exist in any frame. This is
  the answer to your camera-feed / user-identity compliance
  question.
- **Native source windows** — the failing Swift/Kotlin line shown
  in the dashboard with surrounding source, without giving Sentori
  any access to your repository.
- iOS native crash frames now carry `addr`/`imageBase`/`imageUuid`,
  so dSYM symbolication works end to end (needs the rebuilt
  binary).

## 1. Bump — `package.json`

```diff
-    "@goliapkg/sentori-react-native": "^5.0.0",
+    "@goliapkg/sentori-react-native": "^5.1.2",
```

**Skip 5.1.0** — its attachment upload is broken on real devices
(found and fixed in 5.1.1). 5.1.2 additionally makes **dev-client
errors readable**: stacks are symbolicated locally against Metro,
so the dashboard shows your source line instead of
`entry.bundle:721724`. `bun install`, done. No other package
moves.

## 2. Rebuild the native app (required once)

5.1 adds native functions (`captureReplayFrame`, the extended crash
handler). JS-only updates (OTA / dev-client reload) will not pick
them up:

- rebuild your **dev client**, and
- ship the next **release build** with the new pods/gradle output.

Old binaries keep working — they just degrade to wireframe replay
and skip the new crash fields. Nothing breaks in the window where
JS is 5.1.1 but the binary is older.

## 3. Config — `src/runtime/bootstrap/scripts/sentori.ts`

```ts
import { registerMaskQuery, sentori } from '@goliapkg/sentori-react-native'

// Views that must never appear in a captured frame. Return nativeIDs;
// one prop works on both platforms. Keep the query cheap (static array).
registerMaskQuery(() => ['camera-preview', 'user-identity-card'])

init({
  // ...existing config...
  replaySeconds: 60,
  replayScreens: true,   // OFF by default — this is the opt-in
})
```

Then tag the sensitive views:

```tsx
<CameraPreview nativeID="camera-preview" ... />
<IdentityCard nativeID="user-identity-card" ... />
```

Notes:
- `nativeID` is enough for both platforms. (On iOS, `testID` also
  matches, but you don't need both.)
- Masking covers the view's whole subtree — tag the container, not
  every child.
- A throwing mask query masks **nothing** that tick (and reports
  itself), so test it once in the dev client before trusting it:
  trigger a test error, open the issue on the dashboard, and check
  the replay shows black boxes where the tagged views are.

## 4. CI — one line after your dsym/mapping uploads

```bash
sentori-cli upload srcbundle --release "$RELEASE" \
  --token $SENTORI_API_TOKEN ios/ android/app/src
```

The bundle is built from exactly the directories you pass — nothing
reads your repository. After it lands, native frames on the
dashboard show the failing line with a source window, same as JS
frames already do. Like every upload command it exits 0 on failure
(`--strict` to opt out), and already-received events are
re-symbolicated once the artifacts arrive.

Make sure your CLI is `@goliapkg/sentori-cli@^1.2.0` (`upload
srcbundle` doesn't exist before 1.2).

## 5. Verify (5 minutes, dev client)

1. Rebuilt dev client running, `replayScreens: true`.
2. Use the app normally for ~30 s, then trigger a test error
   (Dev Utils → Sentori Err).
3. On https://sentori.golia.jp open the new issue: a **Replay**
   section plays real frames of the last minute; tagged views are
   black boxes in every frame.
4. If the replay section shows wireframes instead of screenshots,
   the binary predates 5.1 — rebuild (step 2).

## 6. Cost, for the record

Steady state: one native screenshot every 2.5 s (~1–3 ms off the
main thread's budget), ring capped at `replaySeconds`, zero network
until an error/warn fires; then one attachment of roughly
60–200 KB rides along with the event. Disable any time with
`replayScreens: false` — wireframe replay remains.

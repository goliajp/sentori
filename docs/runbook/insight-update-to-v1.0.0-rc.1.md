# Insight → Sentori: upgrade to v1.0.0-rc.1

Date: 2026-05-17 (~21:00 JST)
SDK: `@goliapkg/sentori-react-native@1.0.0-rc.1` (npm `@next` tag)
Dashboard: `app.sentori.golia.jp` build `v1.0.0-rc.1 · cf4733c`
Server: `v1.0.0-rc.1` (deployed)
Previous round: [`insight-followup-2026-05-17.md`](./insight-followup-2026-05-17.md)

This is the closure of the 2026-05-17 verify cycle. Two of the
findings you reported earlier are root-caused and fixed in this
release; one new dashboard capability (the Replay tab) lands too.

## TL;DR — what to do

```bash
bun add @goliapkg/sentori-react-native@next
cd ios && pod cache clean SentoriReactNative --all && pod install --repo-update && cd ..
bun ios --device FDBDF6F3-…   # or your usual sim UDID
```

Then on a fresh cold launch + one `captureException`, you should
see this Metro log shape (the new lines are bold):

```
[sentori] native module bound; exposed methods: …, captureWireframe, probeWireframe, …
[sentori] replay: starting bound=true hasCaptureWireframe=true
[sentori] replay: scheduled tick period= 500 ms          ← NEW (rc.1)
[sentori] replay tick: FIRST INVOCATION                  ← NEW (rc.1)
[sentori] captureException eventId=… breadcrumbs=N wantScreenshot=true wantSessionTrail=true
[sentori] screenshot blob ok, uploading … mediaType=image/jpeg base64Bytes=~40000
[sentori] enqueue eventId=… attachments=3 kinds=screenshot,sessionTrail,replay   ← `replay` is new
```

The `FIRST INVOCATION` line is the one that proves the tick scheduler is alive — its absence in your 0.9.11 verify report was the smoking gun for the bug we just fixed.

## What we fixed (since 0.9.11)

### Finding 6 (`replay tick fires but ring stays empty` → root cause)

Your 2026-05-17 verify report had this distinctive shape:

> On 0.9.11 the metro stdout shows zero replay-tick log lines. Not
> even one. We waited ~30 s after enqueue with the app foregrounded
> on the dev landing screen.

Root cause: `replay.ts` ended `startReplay()` with:

```ts
(_timer as unknown as { unref?: () => void }).unref?.()
```

Hermes 0.81/0.82 timers are plain numbers, not Node-style Timer
objects. The optional-chained call dereferenced `prototype` on
`undefined` and **threw synchronously inside startReplay**. RN's
bridge swallowed the throw; `setInterval` was registered but its
callback was never invoked. Net effect: zero tick log lines.

Fixed by dropping the call (it was a misplaced Node idiom anyway —
replay tick lifecycle is bound to the app process, no event-loop
opt-out needed on RN). RN 0.83+ has a different timer wrapper that
exposes `unref`, but since 0.83 is the minimum we'll ship against,
the call still wasn't doing useful work. Better to just drop it.

### Server-side `○ replay` empty-circle (root cause)

The dashboard issue-header strip showing `○ replay` (empty circle)
on every event of 0.9.10 + 0.9.11 was not (only) the SDK side. The
server's application-level whitelist `ALLOWED_KINDS` in
`api/attachments.rs` never picked up `'replay'` when migration 0043
widened the DB CHECK constraint. **Every SDK replay upload was
returning 400 `invalidKind`** and the SDK's `captureAndAttachReplay`
caught + swallowed it.

Fixed in server commit `d2a8258` (deployed). The next replay
upload from your 1.0.0-rc.1 SDK build will actually land in
`event_attachments` and surface on the dashboard.

### Diagnostic additions

Even with the unref bug fixed, we don't want to be flying blind
again. 1.0.0-rc.1 adds:

- **`[sentori] replay: scheduled tick period= XXX ms`** — printed
  once after `setInterval` is wired. If you see "starting bound=true"
  but no "scheduled" line, the scheduler call itself threw — much
  louder signal than 30 s of silence.

- **`[sentori] replay tick: FIRST INVOCATION`** — printed once,
  unconditionally, at the top of the captureTick body before any
  other code that could throw. Proves the callback fires at all.

- **`probeWireframe()`** — new native function on iOS + Android.
  JS-side wrapper `probeNativeWireframe()` returns:

  ```ts
  {
    available: boolean,
    lastPath: string,       // e.g. 'scene.fg.key' / 'activity.resumed'
    lastNodes: number,
    sceneCount: number,
    windowCount: number,
  }
  ```

  Useful when the ring is empty: `lastPath === 'none(...)'` says
  the native side couldn't find a UIWindow; `lastNodes === 0` says
  it found a window but the tree was empty.

- **iOS keyWindow 4-tier fallback** — was single-pass `firstScene`,
  now tries `foregroundActive.keyWindow → fg.firstWindow →
  foregroundInactive.firstWindow → any scene's firstWindow →
  legacy UIApplication.windows.first`. SwiftUI / preview / scene
  race conditions used to drop us to nil; now they don't.

## What's new on the dashboard

Open any issue with a `replay` attachment (header strip will show
`● replay`, filled circle). You'll see a new **Replay tab** between
Stack and Events:

- SVG wireframe canvas, one `<rect>` per node, locked to the
  device viewport's aspect ratio
- horizontal thumbnail rail, one mini SVG per frame, click-to-jump
- scrubber controls — Prev / Play / Next + range slider + 2 Hz
  auto-play (stops at last frame, no wrap)
- keyboard nav: ←/→ step, Space play/pause, Home/End jump
- **diff toggle** — when on, each node gets an outline by its
  diff status vs the previous frame: added (green) / changed
  (amber) / removed (red ghost). The right rail shows the
  added/changed/removed counts.

Empty state: if the event has no replay attachment, the tab shows
"No replay captured" with a one-line hint to enable
`capture.replay = { mode: 'wireframe', hz: 1 }` in `sentori.init()`.

## Verify checklist

Tap a "Sentori Err" button (or whatever's wired to
`sentori.captureException`) once on a fresh cold launch. Then:

1. **Metro log shows all five `[sentori]` lines** in the order
   shown in the TL;DR (especially the `FIRST INVOCATION` line and
   the `kinds=…,replay` token in the `enqueue` line).

2. **Dashboard event header strip shows `● replay`** (filled,
   tora-orange dot). If you still see `○ replay`, share the eventId
   and the captureException Metro line — we'll trace it server-side.

3. **Open the Replay tab.** It should render frames (probably
   30–60 of them, depending on how long the app was foregrounded
   before the throw). Scrub. Try the diff toggle on a frame where
   you tapped a button — you should see the tap target's text /
   colour show up as `changed`.

4. **Click "[diff vs prev]"** — left half outlines should appear,
   right half count rail (`added N` / `changed N` / `removed N`)
   should be live.

If any of (1)–(4) fail, the failure shape tells us where to look:

| What fails | What it means | Who fixes |
|---|---|---|
| Stops after `replay: starting bound=true` | `scheduled` line missing → setInterval call itself threw. New bug we haven't seen. | Sentori |
| `scheduled` shows but no `FIRST INVOCATION` | The `setInterval` callback genuinely isn't firing. Hermes timer regression. | Sentori |
| `FIRST INVOCATION` shows but no `kinds=…,replay` on enqueue | Ring is empty when captureException flushed — call `probeNativeWireframe()` from a DevPanel button + share the response. | Insight (capture probe), Sentori (interpret) |
| `kinds=…,replay` ships but dashboard shows `○ replay` | Server-side `event_attachments` row missing — share the eventId, we'll inspect. | Sentori |
| `● replay` shows but Replay tab errors | Dashboard fetch / parse / render. Share the browser console. | Sentori |

## What's NOT in this RC

- **Workstream C (intent cluster)** — deferred to v1.1. Waiting on
  ≥ 100 ingested events with full breadcrumbs across ≥ 1 week of
  real traffic before we cluster.
- **Production SwiftUI showcase build** — `apps/ios-showcase/` is
  in the repo and runs on a sim, but it's not on TestFlight /
  Diawi. Not relevant to Insight's verify path.
- **Replay attachment compression** — measured the budget; 60-frame
  payload sits well inside the 500 KB cap with the dedup we ship.
  If your app has 200+ visible nodes per frame and your replay
  attachments start hitting the cap, ping us — we'll add gzip on
  upload in 1.x.

## Communication shape

- This file is the canonical state on Sentori's side, just like
  `insight-followup-2026-05-17.md` was for the previous round.
  Both stay in `docs/runbook/`.
- Insight's GOL-582 docs are the source of truth for the verify
  matrix on your side.
- When you share an event ID, a metro line, or a commit SHA, we
  cross-reference and pick up directly.

## Reproduction reference

- Stack: iPhone 17 Pro simulator on macOS, iOS 26.4
- App: focus-ai-app, latest GOL-582 branch with 1.0.0-rc.1 SDK
- Trigger: DevPanel "Sentori Err" → `sentori.captureException(new Error(…))`
- Cross-check IDs land in dashboard issue `sentori dev smoke @ …`

Pin the SDK explicitly to `next` tag in the upgrade — `@latest` is
intentionally still `0.9.11` so unrelated projects on auto-update
aren't pulled onto a release-candidate.

```jsonc
// package.json
{
  "dependencies": {
    "@goliapkg/sentori-react-native": "1.0.0-rc.1"
  }
}
```

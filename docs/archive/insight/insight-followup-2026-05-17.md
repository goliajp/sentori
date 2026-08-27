# Insight follow-up — 0.9.11 verify path + dashboard v0.9 + post-AFK polish

Status as of 2026-05-17 evening. Lives in the repo as the running
state of the Insight / Sentori interaction so neither side has to
re-piece it together from chat history.

## Where we are

| Surface | Version | Notes |
|---|---|---|
| `@goliapkg/sentori-react-native` | **0.9.11** (npm latest) | All Insight findings 1–6 closed in this version, plus the four-way native-binding diagnostic console.warn |
| `app.sentori.golia.jp` (dashboard) | **v0.9.2+** | Editorial redesign + Roboto Flex + designed semantic palette + theme toggle wired + ScreenshotDebugCenter (3-pane fullscreen) |
| Server | `209ccf4` deployed | `is_admin_for_project` SQL bug fixed; `SENTORI_ATTACHMENT_DIR` honoured; `/admin/api/projects/.../privacy/rescan` endpoint live |
| Compose | `goliajp/devops@17d38de` | Explicit `SENTORI_ATTACHMENT_DIR=/data/attachments` so the server-side fallback never kicks in by surprise |

## What Insight needs to do next

### 1. Upgrade

```bash
bun add @goliapkg/sentori-react-native@0.9.11
cd ios && pod cache clean SentoriReactNative && pod install --repo-update && cd ..
```

After this the iOS bundle should expose both `captureScreenshotWithMask`
and `captureWireframe` (the `apple.podspecPath` fix in
`expo-module.config.json` is what got Sentori's module to autolink in
the first place).

### 2. Verify with a maestro run

```bash
npx react-native log-ios | grep '\[sentori\]'
```

Expected lines on a fresh boot + 1 captureException:

```
[sentori] native module bound; exposed methods: …, captureScreenshotWithMask, captureWireframe, …
[sentori] replay: starting bound=true hasCaptureWireframe=true
[sentori] captureException eventId=… breadcrumbs=N wantScreenshot=true wantSessionTrail=true
[sentori] screenshot blob ok, uploading … mediaType=image/jpeg base64Bytes=~40000
[sentori] enqueue … attachments=1 kinds=screenshot
```

Anything else falls into one of three shapes — we have a deterministic
next step for each:

| What you see in Metro | What it means | Who fixes |
|---|---|---|
| `requireNativeModule("Sentori") threw` | Pod stale. `pod cache clean SentoriReactNative && pod install --repo-update` again. | Insight |
| `captureScreenshotWithMask missing` | Pod is on an older Sentori tarball. Bump npm again, redo `pod install`. | Insight |
| `native screenshot returned null …` | iOS Swift can't find the key window at capture time. Reproduce screen + send the active-scene state; we narrow inside `SentoriScreenshotCapture.swift`. | Sentori |
| `native screenshot threw …` | Swift exception. Forward the throw message; we'll fix. | Sentori |
| `[sentori] replay tick: native returned null` (with stride 1 / 10 / 100 / 1000) | `captureWireframe` keeps returning null. Same scene-state diagnosis as screenshot null. | Sentori |

### 3. Dashboard cross-check on `019e32d2-…` (your existing event)

Refresh the issue detail page for that event. You should see:

- `attached: ● screenshot` (filled circle) on the editorial header strip
- The **`Captured at error`** section under the stack trace, with a square
  thumbnail tile. Click it.
- The new **screenshot debug center** opens — 3-pane fullscreen:
  - left rail: thumbnails (one per screenshot) + non-image attachment list
  - center: image at viewport scale; `space` toggles fit ↔ 1:1; `← →` step
  - right rail: user.id + flags + attachment metadata (ref / kind / media / size / source)
- `esc` closes; download / nav links in the top bar

If the thumbnail renders but the debug center won't open, that's the
old route bug — confirm the dashboard footer reads `v0.9.x · <sha>`,
not `v0.8.0 · 63debc1`.

## What's new since the last hand-off

### Dashboard editorial redesign

- Off-white paper palette + tora-orange accent + Roboto Flex (variable
  axis sans) / Roboto Mono. No more generic SaaS grey. Light/dark each
  has its own designed semantic palette (info/success/warning/danger)
  — no alpha-on-accent washouts.
- Hierarchy via type scale + rule weight, not numbered chrome. No
  `01/02/03` page badges; the visual progression is: 26 px page title
  → 15 px sub-section title → 10 px column label, rules reserved for
  delimiting data strips (`.bench`, `.rule-grid`).
- `ScreenshotDebugCenter` replaces the old image-only Lightbox.
- Issues / Issue Detail / Traces / Trace Detail / Overview / Vitals /
  Releases / Live debug / Metrics / Moments / Privacy / Cert monitor /
  Alerts / Teams / Integrations / Audit / Settings — every page is
  on the new tokens. No `rounded-md border` cards left.
- Theme toggle in the top-right works now (was changing the atom but
  never re-painting `data-theme`).
- Issue Detail dropped a duplicate Context pane that was re-stating
  the same release / device / geo fields the EventGlanceStrip
  already shows.

### Server / SDK

- Insight findings 1–6 closed in `@goliapkg/sentori-react-native@0.9.11`
- Server `is_admin_for_project` SQL bug fixed (`(i64,)` over int4
  column → fail-closed → 403 forbidden on every attachment GET)
- Privacy classifier false-positive fix + admin rescan endpoint so
  the score recovers immediately after a classifier upgrade
- CLI auth contract in `docs/runbook/cli-auth.md` — single source of
  truth; recipe doc points at it

## Open items

### From Sentori's side

- **None blocking.** All known Insight findings closed; dashboard
  redesign shipped end-to-end.
- Backlog: SDK v0.9.12 patch bump to refresh npm registry after the
  dashboard work lands (no SDK source changes since 0.9.11; pure
  housekeeping bump can wait for the next real SDK change).

### From Insight's side

- Upgrade to 0.9.11 + `pod install --repo-update`
- Run a maestro pass and forward any `[sentori] …` log lines that
  don't match the "happy" shape above
- Verify the screenshot debug center end-to-end on a real event

## Communication shape

- Sentori's monorepo (`goliajp/sentori`) is the source of truth for
  this doc. Insight's GOL-582 docs are the source of truth for what
  they're testing.
- Keep cross-references — when either side mentions a specific event
  ID, file:line, or commit SHA, the other side picks it up directly.

## Reproduction reference

- Stack: iPhone 17 Pro simulator on macOS, iOS 26.4, dev build
- App: focus-ai-app, latest GOL-582 branch
- Trigger: DevPanel "Sentori Err" button → `sentori.captureException(new Error(…))`
- Cross-check IDs land in dashboard issue `sentori dev smoke @ …`

If you see something genuinely new (not in the table above), share
the Metro log + dashboard event ID and we have a deterministic next
step in every cell of the failure matrix.

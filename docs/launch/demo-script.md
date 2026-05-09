# 30-second demo screencast — script

Phase 16 sub-G placeholder. Re-record before Show HN; the goal is a single MP4 / WebM that auto-plays muted on `sentori.golia.jp` and embeds in the HN thread.

## Hard rules

- **30 seconds total.** People scroll past anything longer.
- **No voiceover.** Captions only. Background music optional, off by default.
- **No personal info on screen.** Use `demo@sentori.golia.jp` and the throwaway `demo-app` org.
- **One take.** Multiple cuts feel jumpy at this length.

## Storyboard

| t (s) | What's on screen | Caption |
|-------|------------------|---------|
| 0–3 | Cursor on `sentori.golia.jp` hero, hover the "Get started — free" button | _"Sign up free."_ |
| 3–5 | Fast-cut: register page with email + password filled, submit, "check your inbox" panel | _"No card. 1 link."_ |
| 5–8 | Click the verification link in the inbox preview (use a screen-recording inbox like mailpit dev mode) | (no caption — let the click speak) |
| 8–12 | Auto-redirect to onboarding wizard step 2: "Create your first project" with `myapp-ios` typed in | _"Name your app."_ |
| 12–15 | Wizard step 3: install snippet visible, click the "copy" button on the token | _"Copy your token."_ |
| 15–22 | Cut to a code editor, paste `initSentori({ token, ingestUrl })` 3 lines, save. Then a phone simulator on the side, throw a button → red error overlay flashes | _"One init call."_ |
| 22–27 | Cut back to dashboard, the Issues table populates with a `TypeError` row, click it; right pane shows the symbolicated stack frame at `App.tsx:42` | _"Issue lands. Stack symbolicated."_ |
| 27–30 | Pull back to the marketing tab open behind, mouse hovers "Star on GitHub" | _"Open source. Self-host or hosted."_ |

## Recording setup

- **macOS:** QuickTime → New Screen Recording, full screen, hide menu bar, browser zoom 110%.
- **Cursor:** turn on "Highlight cursor" in macOS settings — small visual aid, big readability win.
- **Resolution:** 1920×1080. Export at 1280×720 H.264 ~3 MB target.
- **Captions:** burn them in; many embedders mute and disable JS captions.

## Asset checklist

- `marketing/public/demo.webm` (fallback `.mp4`)
- Poster image: a single frame from t=22 with the "Issue lands" caption visible — used as `og:video` poster + LinkedIn share preview
- Captions transcript in `marketing/public/demo.vtt` for accessibility

## Don't

- Don't say "fast." Show the timestamp instead.
- Don't compare to Sentry by name in the video — the comparison belongs in the HN body, not on autoplay.
- Don't end on the dashboard. End on the marketing site so the call-to-action is the last thing the eye lands on.

# Insight dogfood — friction log

> Real-traffic source: **`qualcomm/insight`** (Expo + RN), running
> Sentori (`@goliapkg/sentori-react-native`) since 2026-05. Two
> purposes: (1) a chronology of fixes that *came out of* dogfood, and
> (2) the Phase 30 sub-A onboarding stopwatch (still TODO — needs a
> clean re-onboard run with timing).

## Dogfood-driven changes (chronology)

| When | Symptom | Fix |
|---|---|---|
| v0.4.1 | Traces page nearly empty despite the SDK being installed | Auto-instrumentation only patched `globalThis.fetch`, but Insight uses **axios** — default adapter is `XMLHttpRequest`, not built on fetch on RN. Added XHR-prototype instrumentation (`sentori-react-native` + `sentori-javascript`). |
| v0.4.2 | Traces *still* empty | SDKs never **sent** client spans — `finish()` only pushed to the in-memory `SpanBuffer`; no transport drained it to `/v1/spans:batch`. Added a span-flush timer to both transports (+ a self-trace guard so span uploads don't recursively spawn `http.client` spans). |
| v0.5 Phase 39 sub-A | Traces list unusable — every request to a different id (`/devices/69ef2dc5…`) is its own row; `traces` summary table cardinality unbounded | `normalizeUrl` in `sentori-core`: span `name` collapses id-like path segments to `{id}` (full URL kept in the `http.url` tag). |
| v0.5 Phase 39 sub-B | Every fetch was its own root trace — a screen's 20-40 requests = 20-40 separate traces | `useTraceNavigation` / `useSentoriRouter` open a `react.navigation` span per screen and keep it the *active* span, so the screen's requests become children: one trace per screen. |
| v0.5.4 | Dashboard: "No session pings on this release yet" — Insight calls `initSentori` but no sessions ever start | `sentori-react-native`'s `init` didn't wire session lifecycle (the `handlers/lifecycle.ts` AppState binding existed but was never installed). Now `init` opens the cold-start session + installs the AppState binding (`active` → start, `background` → end). Opt out with `capture: { sessions: false }`. **Insight just needs to bump to ≥ 0.5.4** — no app-side code. |
| v0.5 Phase 40 (planned) | JS error stacks unreadable (`index.bundle:1:288432`); dashboard's "SOURCE MAPS" card prompts `sentori-cli` which doesn't exist yet | End-to-end sourcemap symbolication — SDK captures column/function, `sentori-cli` (new) uploads composed Hermes/Metro maps tagged to the release, server symbolicates at ingest + re-fingerprints, dashboard renders source snippets. Interim: raw `curl` upload to `/admin/api/releases/{name}/sourcemaps` after a `compose-source-maps.js` step. |

**v0.5 finished — the ask for Insight is now two zero-script steps:**

1. `bun add @goliapkg/sentori-react-native@latest` (≥ 0.5.6). Bumping
   the SDK gets you (a) session pings + crash-free rate (auto-wired in
   `init`), (b) auto-symbolicated dev errors via Metro `/symbolicate`
   (so the `_temp5` / `anonymous` frames you saw before become
   `src/Foo.tsx:42` immediately, no upload needed for dev).
2. Add one step to your release-build pipeline (per platform):
   ```bash
   npx react-native bundle --platform $PLATFORM --dev false --entry-file index.js \
     --bundle-output main.jsbundle --sourcemap-output main.jsbundle.packager.map
   npx @goliapkg/sentori-cli react-native upload \
     --release "<byte-for-byte your init({ release })>" --token "$SENTORI_TOKEN" \
     --metro-map main.jsbundle.packager.map --hermes-map main.jsbundle.hbc.map \
     --bundle main.jsbundle
   ```
   (`--hermes-map` path may differ by EAS profile / RN version; happy
   to help locate it.)

After both, prod errors for that release land in the dashboard with
`src/Foo.tsx:42` titles and inline source snippets ±5 lines around the
failing line, with vendor frames folded. The Traces list aggregates by
normalized route, and one screen's requests group into one trace.

Record observations below.

---

# Phase 30 sub-A — Insight onboarding stopwatch & friction log

> Goal: measure end-to-end time from `bun remove` (old SDK) to "first
> event visible in `app.sentori.golia.jp` dashboard" against
> `@goliapkg/sentori-react-native@latest`, log every speed bump along
> the way, and emit a top-5 priority table that drives Phase 30 sub-B.

## Run metadata

| | |
|---|---|
| Run date | TODO (YYYY-MM-DD) |
| Run by | doracawl |
| Host | macOS / Xcode 26.x / iPhone 17 Pro simulator |
| Insight repo | `/Users/doracawl/workspace/qualcomm/insight` |
| Sentori dashboard | https://app.sentori.golia.jp |
| SDK before | `@goliapkg/sentori-react-native@0.1.3` (last pre-tracing) |
| SDK after | `@goliapkg/sentori-react-native@latest` (≥ 0.5.3) |
| Total elapsed | TODO seconds (north-star: ≤ 300 s = 5 min) |

## Stopwatch table

> Run each step in sequence. Start the timer when you begin the step,
> stop when the step completes or you're stuck. Record one line per
> step. `friction` is a one-line description of anything that slowed
> you down — error message, doc you had to search for, command you
> couldn't remember, terminal you had to switch to, etc. Blank if
> the step was clean.

| # | Step | Elapsed (s) | Friction |
|---|---|---|---|
| 1 | `cd qualcomm/insight && bun remove @goliapkg/sentori-react-native` | TODO | TODO |
| 2 | `bun add @goliapkg/sentori-react-native@latest` | TODO | TODO |
| 3 | Find / copy project token from `app.sentori.golia.jp` → settings → tokens | TODO | TODO |
| 4 | Locate the SDK integration docs (`sentori.init` shape, where to call it) | TODO | TODO |
| 5 | Update `sentori.init({ token, release, environment, ingestUrl })` in app entry | TODO | TODO |
| 6 | iOS: `cd ios && bundle exec pod install` (Expo autolink picks up new SDK) | TODO | TODO |
| 7 | `bun run ios` → simulator boots, JS bundle loads | TODO | TODO |
| 8 | App reaches a screen + a test error is triggered (button / `throw` / native crash) | TODO | TODO |
| 9 | Switch back to dashboard → issues page → wait for first event | TODO | TODO |
| 10 | Stack frame is visible and points at user code (not minified / unsymbolicated) | TODO | TODO |

## Free-form friction notes

> Moments where you wanted to throw the keyboard, switched terminals
> three times, tabbed to docs more than twice, or thought "wait, what
> am I supposed to do here?" Don't sand them down — verbatim is more
> useful than polished.

- TODO

## Doc-lookup log

> Every time the install required looking something up. The retrieval
> path is part of the friction: "I had to grep my old chat" is a
> different problem from "I had to read three pages of docs."

| What I needed | Where I looked | Found? |
|---|---|---|
| TODO | TODO | TODO |

## Error messages I had to decode

| Error text | Context (what triggered it) | How I unblocked |
|---|---|---|
| TODO | TODO | TODO |

## Top-5 friction priorities (input for sub-B)

> Score each line on two axes:
>
> - **Reach**  1 = only I hit this once / 5 = every fresh install will hit it
> - **Effort** 1 = one-line doc / 5 = needs SDK API change + new npm version
>
> Then sort by `reach × effort_invertedReach / cost` — high reach + low
> effort first. The top 5 become the punch list sub-B picks up.

| # | Friction | Reach 1-5 | Effort 1-5 | Candidate fix | Lands in |
|---|---|---|---|---|---|
| 1 | TODO | ? | ? | TODO | sub-B step ? |
| 2 | TODO | ? | ? | TODO | sub-B step ? |
| 3 | TODO | ? | ? | TODO | sub-B step ? |
| 4 | TODO | ? | ? | TODO | sub-B step ? |
| 5 | TODO | ? | ? | TODO | sub-B step ? |

## North-star check

- Total elapsed vs 5-minute target: TODO
- Single biggest failure mode this round: TODO
- Things that were already good — don't touch in sub-B: TODO

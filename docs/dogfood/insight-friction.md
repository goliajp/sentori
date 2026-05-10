# Phase 30 sub-A — Insight onboarding stopwatch & friction log

> Real-traffic source: **`qualcomm/insight`** (Expo + RN).
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
| SDK before | `@goliapkg/sentori-react-native@0.1.3` |
| SDK after | `@goliapkg/sentori-react-native@0.4.0` |
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

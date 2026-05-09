# Show HN draft

> Phase 16 sub-G placeholder. Tighten before posting; HN's title hard cap is 80 chars.
>
> Best slot for "Show HN" engagement: **Tuesday or Wednesday, 08:00–09:00 PT**.
> Avoid Mondays (front-page churn) and weekends (low engagement).

---

## Title

`Show HN: Sentori – modern error tracking for React Native, self-hostable in 1 binary`

(80 chars exactly. Acceptable to drop "modern" if needed.)

## Body

I built Sentori because every time I added Sentry to an app I had to think about the back-end before I could think about the bug. The Sentry server stack is Kafka + ClickHouse + Snuba + Django by default — overkill for the 99% case where you just want "tell me when prod throws."

Sentori is the same job, simpler shape:

- One Rust binary (axum + sqlx + valkey-rs). One `docker compose up` and you're a self-hosted error tracker on a $5 VM.
- A React Native SDK that's literally one line: `initSentori({ token, ingestUrl })`. JS errors via ErrorUtils, native crashes via NSException + Java/Kotlin uncaught handler. No envelope, no exceptions[] arrays — schema is "single JSON event, camelCase, nested cause chains."
- A dashboard built for keyboard people. 32px-row issue table; j/k/Enter/s/`/`/`[`/`]`. Designed against Linear and Modal, not 2015 Sentry.

Self-hosted is free forever, no event cap. There's also a hosted free tier at `sentori.golia.jp` — 100k events/month, 30-day retention, no card. Pro pricing lands after we've stayed up reliably for a while.

What's *not* there yet (and where I'd love feedback):

- Performance / tracing: not in v0.2. Doable; need a real demand signal first.
- iOS native source-map symbolication: maps are uploaded + RN JS frames symbolicate; ObjC frames stay raw. Coming after launch.
- Releases / health gates / commits-since-release: deferred until I dogfood it for a month.

Ask me anything; I'm reading the thread all day.

- GitHub: https://github.com/goliajp/sentori
- Hosted: https://sentori.golia.jp
- Docs: https://docs.sentori.golia.jp

## Reading the comments

Things that have hit Show HN before that we should be ready for:

- **"Why not Sentry/GlitchTip/Highlight/Bugsnag?"** — Have a one-line answer per comparison. Don't pick fights; just describe the trade-off honestly. ("Sentry is the gold standard but its server is heavier than the v0.1 self-hoster wants. Our schema is a clean break, not a fork.")
- **"What's the license?"** — MIT-style for self-hosted; commercial for hosted. Repo's LICENSE file is the source of truth.
- **"How are you funding this?"** — Honest answer: bootstrapped; SaaS Pro tier is the path. "Free forever for self-hosted, hosted Pro funds development that benefits both."
- **"Phase numbers in the README sound like internal jargon."** — Fair. Show HN audience cares about *the product*, not our roadmap. ROADMAP.md stays in repo for contributors but should probably not be the README.

## Cross-posts (after HN settles)

- dev.to: same body, "Show HN" → "I built", more code samples
- Twitter / Mastodon thread: 4 tweets, screenshots, link to HN at the end
- Reddit r/reactnative: title "Open-source error tracker built RN-first"

Don't cross-post until HN has been alive ≥ 6 hours; the algorithm penalizes obvious cross-promotion.

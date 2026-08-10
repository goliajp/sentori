# docs/

Source markdown for the protocol spec, getting started, the SDK
guide, self-hosting and troubleshooting. **These files are the
documentation** — read them here or in the OSS mirror.

There was an Astro Starlight site (`docs-site/`) and a marketing site
(`marketing/`) in this repo until 2026-08-10. Nothing routed to
either: `docs.sentori.golia.jp` redirects to the dashboard and
`sentori.golia.jp/docs/` is the SPA's catch-all. Between them they
documented a Sentry compatibility layer this product deliberately does
not have, four web-framework SDKs whose source is not in this repo,
and a Free / Pro / Enterprise pricing page for a product with no
signup and no billing. Thirty thousand files, built by no gate and
served to nobody — the OSS mirror excluded them, so not even a
self-hoster ever saw them. Deleted; the history has them.

## Reference & getting started

- [`getting-started.md`](getting-started.md) — five-minute zero-to-event
  walkthrough for the self-hosted stack.
- [`self-hosting.md`](self-hosting.md) — env reference, backup / restore,
  Postgres upgrade notes.
- [`protocol.md`](protocol.md) — ingest payload + sourcemap protocol.
- [`troubleshooting.md`](troubleshooting.md) — common failure modes.
- [`performance.md`](performance.md) — perf tuning + sampler tradeoffs.
- [`design-tokens.md`](design-tokens.md) — dashboard editorial palette
  + typography axes.
- [`teams.md`](teams.md) — RBAC roles + invite + team flows.

## SDKs

- [`sdk-react-native.md`](sdk-react-native.md) — the surface. Sentori
  watches mobile apps; there is no second SDK guide because there is
  no second SDK.

This section listed `sdk-react.md`, `sdk-vue.md`, `sdk-solid.md` and
`sdk-svelte.md` until 2026-08-10. None of those files were in this
directory — they lived in the deleted `docs-site/`, for packages whose
source left with the v1 redesign. Four links, four 404s, in the index
of the documentation.

## Insight upgrade notes (newest first)

Hand-off notes for the Insight team — what changed and how to adopt
each new SDK iteration without back-channel coordination.

- [`insight-upgrade-1.0.md`](insight-upgrade-1.0.md) **← read first**
  — `sentori-react-native` 0.9.11 → 1.0.0-rc.1: self-service account /
  token / OAuth, replay-tick crash fix, OAuth-callback routing fix,
  email actually sends, Caddy `/auth/*` rewrite, `/integrate` module.
- [`runbook/insight-followup-2026-05-17.md`](runbook/insight-followup-2026-05-17.md)
  — 0.9.11 verify path + findings 1–6 closure.
- [`insight-upgrade-0.8.md`](insight-upgrade-0.8.md)
  — 0.7.3 → 0.8.3: GraphQL operation naming, Rage tap, Feature flags,
  measureFn, Velocity alerts, Moments, OTA bundle awareness.
- [`insight-upgrade-0.7.3.md`](insight-upgrade-0.7.3.md) /
  [`insight-upgrade-0.7.3-note.md`](insight-upgrade-0.7.3-note.md) /
  [`insight-upgrade-0.7.2.md`](insight-upgrade-0.7.2.md)
  — historical predecessors.

## Roadmap / design

- [`roadmap/v1.0.md`](roadmap/v1.0.md) — current shipped scope.
- [`design/v1-roadmap.md`](design/v1-roadmap.md) — v1 design spine.
- [`design/v0.9-rn-deep-dive.md`](design/v0.9-rn-deep-dive.md) — RN
  native-binding deep dive (the foundation the 1.0 replay fixes
  build on).

## Runbooks

- [`runbook/v1.0-fresh-deploy.md`](runbook/v1.0-fresh-deploy.md) —
  fresh-stack bring-up (superadmin seed, OAuth secrets, SMTP).
- [`runbook/backup-restore.md`](runbook/backup-restore.md)
- [`runbook/v0.8-smoke-tests.md`](runbook/v0.8-smoke-tests.md)
- [`runbook/cli-auth.md`](runbook/cli-auth.md)

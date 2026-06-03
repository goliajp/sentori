# docs/

Source markdown for protocol spec, getting-started, SDK guide,
self-hosting, teams / RBAC, and design tokens. The `docs-site/` Astro
Starlight project (Astro `base: '/docs'`) ships the published
documentation at `sentori.golia.jp/docs/*`. The legacy host
`docs.sentori.golia.jp` 301-redirects to the new path so old links
keep working.

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

- [`sdk-react-native.md`](sdk-react-native.md) (primary surface)
- [`sdk-react.md`](sdk-react.md)
- [`sdk-vue.md`](sdk-vue.md)
- [`sdk-solid.md`](sdk-solid.md)
- [`sdk-svelte.md`](sdk-svelte.md)

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

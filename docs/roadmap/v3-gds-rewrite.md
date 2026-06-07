# Sentori v3 GDS dashboard rewrite — historical closeout

Status: **closed 2026-06-07. Cross-version dashboard rewrite onto `@goliapkg/gds`; ran from 2026-06-03 through 2026-06-07 as a parallel track to the v2.7→v2.12 Push series. Documented here retrospectively for ROADMAP coherence — the work shipped piecemeal under `gds-*` feature branches and was never formally version-tagged. Hidden-modules series (v2.13–v2.16) finished the migration for the modules the rewrite couldn't touch (because they were hidden at the time).**

Owner: claude + takagi

References:

- Memory `project-v3-gds-dashboard` — the in-the-moment notes the autorun session kept
- Memory `reference-gds-traps` — gotchas hit during the migration
- Memory `feedback-gds-dark-native` — light mode is the derived adaptation, dark is the home turf

## Timeline

| Date | Stage | Headline commits |
|---|---|---|
| 2026-06-03 | Migration phases A + B | `353854b` theme runtime + lens-grouped frame · `55ef542` Issues view + detail rewritten with GDS |
| 2026-06-04 | Migration phases C + D | `f0a4e6e` batch-swap editorial tokens across 67 files · `80faf2f` purge editorial palette, GDS owns colors |
| 2026-06-04 | Build / test fixes | `d07a936` e2e webServer → vite preview (production bundle) for GDS interop · `c20097b` scan GDS dist with Tailwind so utility classes generate |
| 2026-06-04 | True-rewrite rounds 1–10 | `f629364` r1 AppShell + Overview + Issues list · `f46a70b` r2 find-slow lens (Vitals/Metrics/Runtime) · `3319c03` r3 Releases + Users shell · `0273b44` r4 auth shell + form primitives · `57ae1a6` r5 Audit + Teams + Health list views · `fbfad6c` r6 Cert monitor + Privacy · `01b7932` r7 Webhooks delivery queue · `5f53cf0` r8 Posture (4-tab Trust surface) · `cf681cc` r9 Settings/Alerts/Integrations chrome · `78b6ff6` r10 drop `.sentori-page-in` + orphan Tag |
| 2026-06-04 | Bugfix + dark default + light contrast | `e580cfb` bleached dividers + issues table fix · `9396fef` dark is the first-time default · `9492bc9` light-mode contrast boost |
| 2026-06-07 | Follow-up A | `d13ade8` Skeleton dedup + EmptyState rename + EventsRail drop |
| 2026-06-07 | Hidden-modules series (continuation) | v2.13 Privacy / v2.14 Traces + Live debug / v2.15 Moments / v2.16 Alerts — each module the rewrite couldn't touch (hidden) got its own GDS migration commit before flipping visible |

## What shipped

* **`@goliapkg/gds` end-to-end on `sentori.golia.jp/main`.** AppShell, Sidebar, StatusBar, all 19 module views, and the auth pages render through GDS components (PageHeader / DataTable / Card / Alert / EmptyState / Tabs / Dialog / Button / Input / Badge / Chip / ToggleGroup) plus GDS depth/density tokens (`gds-h-sm`, `gds-pad`, `StatusBarComponent`).
* **5-lens sidebar grouping.** `find-bug` / `find-slow` / `find-user` / `trust` / `manage` replaces the v2.x `monitor | organize` split — sidebar maps to operator intent, not dashboard internals.
* **Issues view is full-screen DataTable + click-row navigation.** The v2.x master/detail rail is gone; the same pattern propagated to Traces (v2.14), Moments (v2.15), and Alerts (v2.16) as those modules came out of hiding.
* **`.sentori-page-in` animation primitive + orphan `Tag` component** removed from `index.css` (round 10).
* **First-time default = `mode: 'dark'`, `density: 'compact'`** (GDS Principle #4) with `html[data-theme='light']` `!important` overrides at the top of `index.css` (slate-100 / 300 / 500 / 700 / 900 scale) for the light-mode contrast boost.
* **Sentori UI primitives kept as design lib.** `Hint` / `ModuleEmpty` / `RailEmpty` / `CenteredEmpty` / `Stat` / `Sparkline` / `Row` / `SubSection` / `RowSkeleton` stay — they're sentori-internal design vocabulary (steel-tier per `methodology-steel-cement-stone`) that GDS doesn't cover. Hidden v3 follow-up A renamed sentori's own `EmptyState` → `InlineEmpty` to dedup with GDS's pattern of the same name, and dropped the dead-code raw `Skeleton` / `CardSkeleton` / `InlineSkeleton`.

## Why this isn't its own version

The work straddled v2.6 (find-threat lens) and the start of v2.7 (push foundation). Each round shipped under a `gds-true-rewrite-rN` feature branch with `--no-ff` merges through `develop` → `master` — every push triggered CI + deploy independently. By the time it finished, the v2.7→v2.12 Push series was actively running on the same branches, so backfilling a "v3.0" version tag retroactively would have created merge ordering confusion.

We chose to document it here instead: the historical record sits alongside every other roadmap doc, and the hidden-modules series (v2.13–v2.16) explicitly carried forward the GDS migration for the modules the original rewrite skipped (because they were `hidden: true` at the time and the rewrite session only touched visible modules).

## Open follow-ups (none blocking)

* **Sentori UI primitive library could ship as `@goliapkg/sentori-ui`** if a second project wants the same `InlineEmpty` / `Stat` / `Sparkline` / `Row` / `SubSection` etc. shape. Today they live in `web/src/components/` — steel→stone transition per the source model would slot them out as a publishable lib. No customer ask yet.
* **Runtime view's custom SVG timeseries chart** stays on raw `<svg>`, not `@goliapkg/gds` `LineChart`. GDS chart primitives are fixed-single-series with no per-point click hook; Runtime needs multi-series overlay + per-bucket drill modal. Re-evaluate when GDS exposes a multi-series chart.
* **Issues detail-view's spans-and-events** rewrites went through Issues v3 in round 1; subsequent v3-style flows (single Card stack + DataTable + linked KPI strip) are the pattern every later module copied.

## Related

- [`reference-gds-traps`](/Users/doracawl/.claude-profile-3/projects/-Users-doracawl-workspace-goliajp-sentori/memory/reference_gds_traps.md) — `--color-border-muted` undefined, vite dev prebundling chunk bug, Tailwind `@source` paths, light-mode override placement
- [`feedback-gds-dark-native`](/Users/doracawl/.claude-profile-3/projects/-Users-doracawl-workspace-goliajp-sentori/memory/feedback_gds_dark_native.md) — dark is the canonical mode, light overrides are minimal
- The v2.13–v2.16 roadmap docs — each carries the GDS-migration delta for one previously-hidden module

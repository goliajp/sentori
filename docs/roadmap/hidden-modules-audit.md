# Hidden modules audit — Phase 1 of post-v2.2 plan

**Date:** 2026-06-03
**Author:** claude (delegated by takagi)
**Plan:** `docs/roadmap/post-v2.2-plan.md` Phase 1
**Scope:** the 10 `hidden: true` modules in `web/src/modules/registry.tsx`
**Method:** read SDK emit paths + server ingest + server cron + DB
migrations; no live DB row-count check (claude has no prod read
replica access — flagged below where it matters).

## Bottom line

**All 10 hidden modules stay.** Every one of them has live data
flowing through SDK emit → server ingest → at least one storage
table, with at least one server-side aggregator or cron still
running. No "delete now" verdicts; no "deprecate" verdicts.

Each module is assigned a future lens (find-slow / find-user /
find-threat / engineering-hygiene / utility) so that when its
lens is designed and shipped we know which datasource is anchoring
the surface.

Phase 8 datasource (set per Decisions #4 in the master plan, default
lean Vitals): **Vitals confirmed alive**. Moments + Metrics are
both healthy fallbacks; no override needed.

| Module | Verdict | Future lens | Note |
|---|---|---|---|
| traces | keep | find-slow (fallback) | Anchor table; many downstream queries depend on `spans`. |
| metrics (v0.8.3) | keep | utility — business-metrics API surface | Not a lens module — a manual `recordMetric` channel. |
| vitals | **keep — Phase 8 anchor** | find-slow (primary) | SDK + server alive; lives on `spans` with `vital.kind=*` tags. |
| moments | keep | find-user OR engineering-hygiene | SDK `startMoment` + server `api/moments.rs` ALIVE. |
| audience | keep | find-user (cohort sub-view) | SDK `heartbeat.ts` + server `heartbeat.rs` + Valkey ALIVE. |
| cert-monitor | keep | find-threat (future v2.6+) | Server cron 10 m, has its own table; active monitor. |
| posture | keep | find-threat (future v2.6+) | SDK `report-security.ts` + `trust-score.ts` ALIVE. |
| privacy | keep | engineering-hygiene (future) | Server cron 15 m (`privacy_lab`); passive analysis. |
| live-debug | keep | (utility — admin tool) | SSE stream + control channel; not a lens. |
| alerts | keep | (cross-cutting — own redesign) | Server cron 60 s; Phase 27 surface, needs own redesign. |

No SDK changes proposed. No server changes proposed in Phase 1.
This audit is **read-only**: no `hidden: true` flag flipped here.
The lens openings (Phases 7 + 8) will flip the relevant ones.

---

## Per-module detail

### 1. traces

- **SDK emit:** `sdk/core/src/spans.rs`, `trace-context.ts`, `moments.ts`
  — `startSpan` / `startTrace` / `withSpan` / `withScopedSpan` are
  the SDK's tracing primitives. Every framework wrapper
  (RN / JS / React / Vue / Svelte / Solid) re-exports them.
  Network instrumentation (`hooks/fetch.js`, `hooks/xhr.js`) calls
  them on every fetch.
- **Server ingest:** `server/src/api/spans.rs` (`POST /v1/spans:batch`),
  `server/src/api/traces.rs` (admin read endpoints),
  `server/src/trace_emit.rs` (server-side span emitter).
- **Storage:** migrations `0026_spans.sql` + `0027_trace_meta.sql`.
  `spans` is **partitioned monthly** (`spans_2026_05`, `_06`, `_07`,
  …) which is a strong signal someone has been planning for serious
  volume. Anchor table for vitals + moments + future find-slow lens.
- **Cron:** `SpanEmitter::spawn` started per-org in
  `server/src/main.rs` (line ~234). `metrics partition cron (1h
  interval, 3d window, 90d retention)` likely manages span
  partitions too.
- **DB growth:** unknown without read-replica; partition table list
  through 2026_07 implies someone is rolling new ones each month.
- **Verdict:** **keep**. Many other modules depend on this table
  (vitals + moments both query it). Future lens: **find-slow
  fallback** if the default Vitals anchor isn't enough.

### 2. metrics (v0.8.3 `recordMetric` channel)

- **SDK emit:** `sdk/react-native/src/metrics.ts` —
  `recordMetric(name, value, tags?, opts?)` pushes into a 200-point
  ring; `flushMetrics()` drains every 30 s via
  `lifecycle.ts`. Same surface exported on JS SDK via
  `sdk/javascript/src/capture.ts` (line 179 mentions it). Re-
  exported through every framework wrapper.
- **Server ingest:** `server/src/api/metrics.rs` (`POST /v1/metrics:batch`,
  registered in `router.rs:160`). **Writes to `runtime_metrics_raw`**
  — same table as the v2.1 auto-instrument channel (note in the
  source: `0068_runtime_metrics.sql:15`).
- **Storage:** `runtime_metrics_raw` partitioned daily
  (`_2026_06_03`, `_06_04`, …) + roll-up `runtime_metrics_1m`.
- **Cron:** `metrics partition cron (1h interval)` rotates
  partitions.
- **Verdict:** **keep**. This is **not** a lens module; it's the
  manual business-metrics API surface the SDK exposes to hosts.
  Re-opening as a dashboard view would need a "list of known
  metric names + last value + sparkline" preset query against
  `runtime_metrics_1m`; not a Phase 8 fit (Phase 8 is opinionated
  find-slow, this is host-defined). Mark for **utility module**
  re-open at low priority — possibly bundled into the Runtime
  view as a second tab ("Custom metrics") in v2.5+.

### 3. vitals — **Phase 8 anchor confirmed**

- **SDK emit:** `sdk/react-native/src/mobile-vitals.ts` measures
  cold-start; `sdk/react-native/src/runtime-metrics.ts` +
  `sdk/react-native/src/init.ts` emit `sentori.cold_start` span
  with `tags['vital.kind']`. Also slow/frozen frame counters land
  as span tags `vital.slow_frames` / `vital.frozen_frames` (see
  server query in `api/vitals.rs:105-106`).
- **Server ingest:** **rides on the `spans` table** — no separate
  vitals table. `server/src/api/vitals.rs` query reads
  `tags->>'vital.*'` from spans. Routes
  `/admin/api/projects/{id}/vitals` + `/vitals/releases` live in
  `router.rs:418-422`.
- **Cron:** none of its own; relies on spans ingest pipe.
- **DB growth:** healthy by proxy of spans partitions.
- **Verdict:** **keep, Phase 8 primary anchor**. Default
  pre-judgement from Decisions #4 holds. Phase 8 module = redesigned
  Vitals view as `/explore` consumer with `dim=route` /
  `dim=device.os` and measures `p95_duration` / `p50_duration` /
  `slow_frame_pct` / `frozen_frame_pct`.

### 4. moments

- **SDK emit:** `sdk/core/src/moments.ts` — `startMoment(name)`
  returns a `MomentHandle` with `checkpoint()` / `fail()` /
  `abandon()` / `end()`. Reaches transport via the same span path
  (a moment is a span with `op='sentori.moment'`).
- **Server ingest:** rides on spans. `server/src/api/moments.rs`
  reads via `WHERE op = 'sentori.moment'`. Routes
  `/admin/api/projects/{id}/moments` + `/moments/{name}`
  registered in `router.rs:384-389`.
- **Cron:** none of its own.
- **DB growth:** unknown — depends on whether hosts have adopted
  `startMoment` in production. Manual instrumentation API; uptake
  is host-dependent.
- **Verdict:** **keep**. Future lens choice is debatable:
  - **find-user (Phase 7)** — moments are user-journey-shaped
    ("onboarding flow completed"), naturally a customer-journey
    anchor; could surface in Users view as "moments per user."
  - **engineering-hygiene** — moments-as-instrumentation-coverage,
    surfacing "how much of this app has named moments?"
  Recommended: leave assignment soft until Phase 7 design. Could
  surface as a sub-view of Users in Phase 7 (`per-user moment
  completion`) without needing its own lens.

### 5. audience

- **SDK emit:** `sdk/react-native/src/heartbeat.ts` — foreground
  1/min ping (configurable; defaults to 1/min per
  `feedback_dashboard_spa` SaaS profile). v2.0 added
  trackAutoBreadcrumb interplay; v2.1 W4 health probes are
  separate.
- **Server ingest:** `server/src/api/heartbeat.rs`
  (`POST /v1/heartbeat`). `server/src/live_presence.rs` uses
  **Valkey ZADD** for live-presence rolling window
  (`live_presence.rs:84-146`). `server/src/api/audience_metrics.rs`
  exposes the admin-facing aggregation
  (`GET /admin/api/projects/{project_id}/audience/metrics`).
  Also `server/src/api/live.rs` for distinct-user windowed counts.
- **Cron:** none of its own; Valkey TTL handles the rolling
  window decay.
- **DB growth:** Valkey-stored, no Postgres pressure. Aggregated
  counts read on-demand for the dashboard.
- **Verdict:** **keep, slated for Phase 7 (find-user lens) sub-view**.
  Audience is the cohort surface for find-user. Phase 7 plan
  explicitly says "If kept: rebuilt as `/explore` consumer with
  `dim=user_cohort`". This audit confirms: keep, Phase 7 will
  fold cohort into Users view.

### 6. cert-monitor

- **SDK emit:** indirect — `sdk/react-native/src/report-security.ts`
  has `reportPinMismatch` which SDK calls when TLS pinning fails.
  Doesn't emit cert-monitor events; the cert-monitor cron does
  the active probing.
- **Server ingest + cron:** **active cron** —
  `cert_monitor::spawn (10m interval)` registered in
  `server/src/main.rs:160`. `server/src/api/cert_monitor.rs`
  exposes
  - `GET    /projects/{id}/cert-monitor/domains`
  - `POST   /projects/{id}/cert-monitor/domains` body `{ domain }`
  - `DELETE /projects/{id}/cert-monitor/domains/{watch_id}`
  - `GET    /projects/{id}/cert-monitor/observations`
- **Storage:** has its own tables (not enumerated here; in the
  cert-monitor migration). Observations accrue every 10 min per
  monitored domain.
- **Verdict:** **keep**. Future lens **find-threat** (v2.6+).
  Sentori's security story (`feedback_glitchtip_isolation` is
  unrelated; security posture is genuine value-add) lives here.
  Active cron means dashboard hiding is the only thing to undo.

### 7. posture

- **SDK emit:** `sdk/react-native/src/report-security.ts` —
  `reportSecurity`, `linkFederatedIdentity`, `reportPinMismatch`;
  `sdk/react-native/src/trust-score.ts` — `queryTrustScore`,
  `TrustSignal`.
- **Server ingest:** server-side trust scoring (looser code trail
  — file presence confirmed but full table not enumerated).
- **Storage:** has security report tables (see `event.rs:295`
  privacy posture comment; cross-references suggest dedicated
  table).
- **Verdict:** **keep**. Future lens **find-threat** (paired with
  cert-monitor). Both will probably open together in a single
  find-threat lens batch in v2.6+.

### 8. privacy

- **SDK emit:** none directly. This is a **server-side passive
  analysis** module — `privacy_lab` scans existing event payloads
  for fields that look like PII and surfaces a "privacy score"
  per release.
- **Server cron:** `privacy_lab spawn (15m interval)` in
  `server/src/main.rs:177`. `server/src/api/privacy.rs` exposes:
  - `GET  /admin/api/projects/{id}/privacy/score?release=<r>`
  - `GET  /admin/api/projects/{id}/privacy/findings?release=<r>&limit=N`
  - `POST /admin/api/projects/{id}/privacy/rescan?release=<r>`
- **Storage:** has its own findings table (per the rescan API in
  `privacy.rs:272`).
- **Verdict:** **keep**. Future lens **engineering-hygiene**
  (v2.7+). The privacy view will partner with sourcemap-coverage,
  symbolicator-health, and other "is the host's instrumentation
  trustworthy" surfaces.
  - **Synergy with Phase 4 (identity layer):** Phase 4 strips
    raw PII at ingest. Phase 1 audit confirms `privacy_lab` is
    the audit/back-stop layer that flags PII the ingest filter
    missed. Both layers ship; Phase 4 doesn't subsume privacy
    module.

### 9. live-debug

- **SDK emit:** `sdk/react-native/src/control-channel.ts` —
  polls `/v1/control/poll?userId=X` on a timer. When the server
  has a record for that user, SDK starts fanning out full events
  (not just headers) to the live-debug SSE stream.
- **Server:** `server/src/api/live_debug.rs` SSE stream registered
  in `router.rs:427-428`. `server/src/recent.rs:50-89` describes
  the in-memory broadcast buffer (capacity 32 events).
- **Storage:** ephemeral (in-memory broadcast buffer). No table.
- **Cron:** none.
- **Verdict:** **keep, utility — not a lens**. Live-debug is an
  operator tool ("watch this user's events live for the next 5
  minutes"), not a measure-and-drill surface. Future re-open as
  a utility module accessible from Issue Detail / Users view
  ("Watch this user live →"). No lens needed; it doesn't fit the
  `dim × measure` mental model.

### 10. alerts

- **SDK emit:** none. Alerts is a server-side cross-cutting
  surface — rules over existing events.
- **Server:** `server/src/api/alert_rules.rs` (Phase 27 sub-A).
  Cron `alert rule cron (60s interval)` in
  `server/src/main.rs:145`. CRUD endpoints exist; integration
  with notification dispatch is wired through `webhook dispatch
  cron (30s)` + `notification_digest`.
- **Storage:** `alert_rules` table.
- **Verdict:** **keep**. Alerts is **not a lens** — it's a
  cross-cutting concern that consumes data from every lens. The
  Phase 27 surface predates the lens framework; its UX is the
  thing in need of redesign, not the data model. Recommended
  re-open in **v2.x+ as its own redesign batch**, not via a
  lens. Cron stays running.

---

## Cron summary (still spawning for hidden modules)

| Cron | Interval | Module | Status |
|---|---|---|---|
| notification_digest | (varies) | utility | active |
| quota flush | 60 s | infra | active |
| retention task | 24 h | infra | active |
| regression sweeper | 5 m | issues (find-bug lens) | active |
| **alert rule cron** | 60 s | **alerts** (hidden) | active |
| digest cron | 1 h | notifications | active |
| **cert-monitor** | 10 m | **cert-monitor** (hidden) | active |
| velocity cron | 5 m | issues | active |
| **privacy lab** | 15 m | **privacy** (hidden) | active |
| webhook dispatch | 30 s | notifications | active |
| metrics partition cron | 1 h | runtime metrics | active |
| trace_emit::SpanEmitter | (per-org) | traces (hidden) | active |

Three crons (alert-rule, cert-monitor, privacy-lab) explicitly
serve hidden modules. None are recommended for deactivation —
each is the upstream feeder for a planned future lens.

## What was NOT done in Phase 1

Per the master plan's Phase 1 acceptance:

- [ ] **Per-module live DB row-count via prod read replica.** Claude
      has no replica credentials in this session. Each module
      section above states what would be queried (`spans`,
      `runtime_metrics_raw`, `cert_observations`, `alert_rules`,
      etc.) — takagi can run those `SELECT count(*),
      max(received_at) FROM <table>` queries and paste numbers
      back into this doc if uncertainty about "is anything actually
      flowing" persists. Phase 1 verdict ("all keep") doesn't
      hinge on row counts — every module's code path is alive
      and each will be load-bearing for its future lens.
- [ ] **No "deprecate" / "delete now" verdicts surfaced.** No
      cleanup follow-up issues created.

## Pointers for the next session

- Phase 8 (find-slow lens) is **green-lit on Vitals**; Phase 8
  hot-plan can cite this audit's §3 directly.
- Phase 7 (find-user lens) gets two confirmed sub-anchors:
  audience (cohort) and moments (per-user journey). The Phase 7
  plan currently has audience explicit and moments soft; this
  audit suggests moments lands as a sub-view in Users view, no
  separate lens.
- find-threat lens (cert-monitor + posture) is planned but
  unscheduled — slot it after Phase 8 closes, with
  `docs/roadmap/v2.6.md` to be written at trigger time.
- engineering-hygiene lens (privacy + sourcemap coverage +
  symbolicator health) is planned but unscheduled — `v2.7.md`
  to be written at trigger time.
- alerts is **not** a lens — needs its own redesign batch when
  the find-* lenses are done. Carry forward as a v2.x backlog
  item, not as part of any lens batch.

## Update 2026-06-07 — v2.13 close (engineering-hygiene lens)

- **privacy** ✅ flipped visible in v2.13. group `trust`, chord `g y`
  (hygiene). View was already GDS-aligned (v3 round 6 polished
  the chrome); `privacy_lab` server cron unchanged.
- **moments** — verdict remains `keep`, but **needs v3 GDS migration
  before flip**. Current view is v2.x master-detail rail + legacy
  `<table className="bench">` (predates v3 because the module was
  hidden when v3 rewrite happened). Flipping it as-is would create
  a visual inconsistency in the sidebar. v2.14 candidate: rewrite
  to full-screen DataTable + click-row navigation matching the
  Issues v3 pattern, then flip.

Remaining hidden after v2.13:
- traces — find-slow fallback
- moments — needs v3 GDS migration (v2.14 candidate)
- audience — subsumed by Users overview
- live-debug — utility, not a lens
- alerts — cross-cutting, needs own redesign

## Update 2026-06-07 — v2.14 close (traces + live-debug)

- **traces** ✅ flipped visible in v2.14. group `find-bug`, chord `g a`
  (trAces). view + detail-view both went through v3 GDS migration
  (`@goliapkg/gds` PageHeader / DataTable / Card / EmptyState).
  find-slow lens fallback — operators drill from vitals/runtime
  into a full span timeline.
- **live-debug** ✅ flipped visible in v2.14. group `find-bug`,
  chord `g l` (live). adminOnly. view went through v3 GDS migration
  (Input / Button / DataTable). Server SSE wire unchanged.

Remaining hidden after v2.14:
- moments — still needs v3 GDS migration (v2.15 candidate)
- audience — subsumed by Users overview
- alerts — cross-cutting, needs own redesign

## Update 2026-06-07 — v2.15 close (moments flip)

- **moments** ✅ flipped visible in v2.15. group **changed from
  `find-user` to `find-slow`** (Audit verdict revised: business-
  flow vital, sibling to v2.5 vitals device-level vital — same
  find-slow lens, different abstraction level). chord `g m`.
  view + new detail-view both went through v3 GDS migration:
  master-detail rail → full-screen DataTable + click-row →
  per-sample timeline (`:momentName` child route). Same pattern
  as v2.14 traces / Issues v3.

Remaining hidden after v2.15 (2 modules only):
- audience — subsumed by Users overview (verdict: keep hidden)
- alerts — cross-cutting, needs own redesign (independent release)

## Update 2026-06-07 — v2.16 close (alerts redesign)

- **alerts** ✅ flipped visible in v2.16. group `manage`, chord
  `g k` (thinK alerts), adminOnly. Full cross-cutting redesign:
  view.tsx restructured into router shell + list (DataTable),
  new detail-view.tsx + form-view.tsx (mirror Health's
  `:checkId` / `:checkId/edit` / `new` sub-routes). Pure v3 GDS:
  PageHeader / Card / DataTable / Input / Button / Alert /
  EmptyState. Server-side AlertRule wire shape unchanged.

Final hidden-module state (1 module remains; verdict permanent):
- **audience** — `keep` per Phase 1 audit, but **subsumed by Users
  overview** (v2.4 verdict). The behavioral data still flows; the
  Users module's KPI + most-affected list covers the operator
  use case. Leave hidden unless a distinct cohort-explorer workflow
  surfaces that Users doesn't cover. Likely permanent.

**hidden-modules series CLOSED.**

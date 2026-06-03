# Post-v2.2 master plan

Status: **accepted 2026-06-03 — takagi delegated detail decisions to claude; 5 open questions resolved in §Decisions below**
Owner: claude + takagi
Date: 2026-06-03

## Why this doc

v2.2 closed 2026-06-03 with the find-bug lens in place (Issues /
Releases / Runtime / Health / Users rebuilt as `/explore` consumers).
The next batch of work is **bigger than one version**:

- The SDK v2.3 redesign spec (`docs/design/sdk-v2.3-redesign.md`) lays
  out W6.0 – W6.4. W6.2 (identity layer) is a hard prerequisite for
  the find-user lens.
- `/explore` grammar must be extended (`issueEq`, new dims, new
  measures) before any second lens can land — v2.2 W3 explicitly
  shipped without a per-row sparkline because `issueEq` did not exist
  yet.
- Two new lenses (find-user, find-slow) are on deck under the
  v2.2 lens stop-ship rule (`.claude/memory/project_v22_lens.md`).
- Hidden modules need an audit so we don't carry dead weight (or
  silently drop signal someone is actually using).

This doc orders all of that **by dependency, not by ROI**, and
commits to **closing each phase without defer**. The v2.3 design
doc's "Out of v2.3 scope" list is either absorbed into a phase below
or explicitly justified as a permanent deferral with a written
reason. See "Recovered defers" at the bottom.

## Principles (carried forward)

1. **Lens stop-ship rule.** Lenses ship one at a time. Touching a
   hidden module without an active lens is stop-ship for that PR.
   See `.claude/memory/project_v22_lens.md`.

2. **UX is delivery.** A backend API + curl-able endpoint is not
   shipped. Every feature lands with full dashboard UX: entry,
   empty, loading, error, edit, delete, confirm. See
   `.claude/memory/feedback_webapp_ux_is_delivery.md`.

3. **No-defer commitment.** Each phase is expected to *close*. If
   work surfaces that can't fit, it goes into the "Recovered
   defers" table below with an explicit reason — not buried in a
   commit message.

4. **Doc-first.** Each phase's hot-plan PR (its dedicated
   `docs/roadmap/vX.Y.md`) lands and is committed before the
   implementation PRs cite it. v2.0 / v2.1 / v2.2 all followed
   this; we keep doing it.

5. **CI is the gate.** `bun run check` + `bun run test` + `bun run
   build:sdks` + `cargo check --tests` green locally, then `gh run
   list` confirmed green after push, before any "shipped" claim.
   See `.claude/memory/feedback_ci_must_be_watched.md`.

## Dependency graph

```
                     ┌─────────────────────────┐
                     │  Phase 0: F + W6.0      │  (independent)
                     │  housekeeping +         │
                     │  SDK logger hotfix      │
                     └─────────────────────────┘
                                  │
                                  ▼
                     ┌─────────────────────────┐
                     │  Phase 1: E             │  (independent;
                     │  hidden modules audit   │   informs Phase 8
                     └─────────────────────────┘   lens datasource)
                                  │
                ┌─────────────────┼─────────────────┐
                ▼                                   ▼
   ┌──────────────────────┐         ┌──────────────────────────┐
   │ Phase 2: B           │         │ Phase 3: W6.1            │
   │ /explore grammar     │         │ SDK native API polish    │
   │ - issueEq filter     │         │ - flatten init config    │
   │ - device.os/priority │         │ - withSpan rename        │
   │ - p95/p50_duration   │         │ - beforeSend hook        │
   │ - userIdEq filter    │         │ - rc.1 publish for       │
   │ - server-side search │         │   dogfood                │
   │ - crash_free_rate    │         └──────────────────────────┘
   └──────────────────────┘                       │
                │                                 ▼
                │                   ┌──────────────────────────┐
                │                   │ Phase 4: W6.2            │
                │                   │ Identity layer +         │
                │                   │ project-scope carve +    │
                │                   │ GDPR DSR delete          │
                │                   └──────────────────────────┘
                │                                 │
                │                                 ▼
                │                   ┌──────────────────────────┐
                │                   │ Phase 5: W6.3            │
                │                   │ Sentry compat layer      │
                │                   └──────────────────────────┘
                │                                 │
                │                                 ▼
                │                   ┌──────────────────────────┐
                │                   │ Phase 6: W6.4 + release  │
                │                   │ v2.3 SDK docs + npm      │
                │                   │ matrix major bump        │
                │                   └──────────────────────────┘
                │                                 │
                └──────────────┬──────────────────┘
                               ▼
                 ┌─────────────────────────────┐
                 │ Phase 7: D (find-user lens) │  (hard-depends on Phase 4)
                 │ Users + Audience + merge UI │  (uses Phase 2 userIdEq)
                 └─────────────────────────────┘
                               │
                               ▼
                 ┌─────────────────────────────┐
                 │ Phase 8: C (find-slow lens) │  (Phase 1 picks datasource;
                 │ Vitals / Metrics / Moments  │   Phase 2 added p95/p50)
                 └─────────────────────────────┘
```

## Version mapping

| Phase | Version label | T-shirt | Ship vehicle |
|---|---|---|---|
| 0 | v2.2.1 (SDK patch) | S | npm patch matrix |
| 1 | v2.2 closeout doc | S | doc-only |
| 2 | v2.3 (server + dashboard) | M | server deploy + web deploy; no SDK |
| 3 | v2.3.0-rc.1 (SDK) | M | npm matrix rc tag |
| 4 | v2.3 (server + SDK + dashboard) | L | server deploy + SDK rc.2 + web |
| 5 | v2.3 (SDK) | M | SDK rc.3 |
| 6 | **v2.3.0 (SDK major release)** | S | npm matrix major; docs |
| 7 | v2.4 | M | server + web; no SDK |
| 8 | v2.5 | M | server + web; SDK if datasource needs it |

v2.3 covers Phases 2 – 6. v2.4 = Phase 7. v2.5 = Phase 8. Per-version
hot-plan docs (`docs/roadmap/v2.3.md` / `v2.4.md` / `v2.5.md`) get
written at the trigger point for each, citing back to this master plan.

---

## Phase 0 — Housekeeping + SDK logger hotfix

**Goal:** clear the inner loop. Drop console noise from the SDK without
touching the public API.

**Inputs:** none.

**Deliverables:**

- F: `/fewer-permission-prompts` swept, project `settings.json`
  permission allowlist updated.
- F: `/code-review ultra` pass on master (no diff to review — it's a
  scout pass to surface drift before phase 2 starts editing
  `/explore`).
- W6.0:
  - `sdk/core/src/logger.ts` — new module exporting `logger`,
    `setLogLevel`, `getLogLevel` per design §3.
  - `sdk/react-native/src/init.ts` + `sdk/javascript/src/init.ts` —
    accept `logLevel` + `onReady` init fields.
  - Sweep: every `console.warn('[sentori] …')` / `console.log` in
    `sdk/react-native/src/` + `sdk/javascript/src/` replaced with
    `logger.<level>('<subsystem>', …)` per the routing table in
    design §3. Includes deletion of the `'sentori: initialized
    (dev) · cold N ms'` line; surface that via `onReady` instead.
  - `setLogTransport` hook per design §9 resolution 5.
- Performance baseline (carries the design §6 "Verify rig"
  recovered defer, mechanical half):
  - Extend `sdk/core/src/__tests__/perf.bench.ts` with logger
    hot-path budgets (`logger.debug` gated-out, `logger.warn`
    emit through transport, `setLogLevel` toggle).
  - Doc `docs/perf-baselines/v2.2.1.md` records the bench
    numbers + the empty device-smoke table that Phase 3 must
    fill before W6.1 implementation starts. Device-smoke
    requires a host with sim-sentori + Pixel 10 Pro AVD live;
    that capture lives in the Phase 3 entry gate, not here.

**Acceptance:**

- [ ] `apps/rn-example` boots with `logLevel: 'warn'` (default) and
      shows zero `[sentori]` lines in Metro console under normal
      operation.
- [ ] `apps/rn-example` boots with `logLevel: 'debug'` and shows
      every event the old `console.warn` chain showed (no
      regression in observability).
- [ ] `setLogTransport(fn)` suppresses console and routes to `fn`;
      `setLogTransport(null)` restores console.
- [ ] `bun run build:sdks` + `bun run test:sdks` + web `bun run
      check` + `bun run test` green (top-level monorepo has no
      `check` script — these are the per-workspace equivalents).
- [ ] `sdk/core/src/__tests__/perf.bench.ts` extended with logger
      benches and all 12 budgets pass.
- [ ] `docs/perf-baselines/v2.2.1.md` committed with mechanical
      bench numbers + empty device-smoke table.
- [ ] CI build + sdk-perf + deploy green after push (`gh run list`).
- [ ] npm patch matrix published via changesets:
      `@goliapkg/sentori-core@1.2.0` (logger module is new — minor),
      `@goliapkg/sentori-react-native@2.1.1`,
      `@goliapkg/sentori-javascript@1.2.1`, framework wrappers patch.

**Ship vehicle:** changesets minor for core, patch for everything
else. No new public API beyond `init.logLevel`, `init.onReady`,
`setLogLevel`, `setLogTransport`.

---

## Phase 1 — Hidden modules audit (E)

**Goal:** Decide the fate of every `hidden: true` module so Phase 8
(find-slow) knows what data source to lean on, and so we stop
carrying modules that are de facto deprecated.

**Inputs:** none (independent).

**Deliverables:**

- New doc `docs/roadmap/hidden-modules-audit.md` with one section
  per module: traces / metrics / vitals / moments / audience /
  cert-monitor / posture / privacy / live-debug / alerts.
- Per module, the doc must answer:
  1. **SDK side** — is data still emitted? (grep `sdk/*/src/` for
     the relevant call; cite file:line).
  2. **Server ingest** — is data still accepted and stored?
     (grep `server/src/` for the table / handler; cite).
  3. **Storage** — is the underlying table growing? (run a
     `SELECT count(*), max(received_at)` against prod read replica;
     paste numbers).
  4. **Cron / agg** — is any server cron still running for it?
     (grep `server/src/cron*` + `server/src/aggregator*`; cite).
  5. **Verdict** — one of: **keep + assign to lens X** /
     **deprecate (mark for removal in vN)** / **delete now**.
- For every module marked "deprecate", a follow-up issue in the
  Sentori issue tracker with `type:cleanup` label, citing the
  audit doc.
- For every module marked "delete now", a same-PR deletion commit
  (registry entry, server handlers, SDK emitter, DB migration
  for the table drop — gated behind a confirmation from takagi
  before the migration commit).

**Acceptance:**

- [ ] Audit doc committed and reviewed by takagi.
- [ ] Each `hidden: true` registry entry has a verdict in the doc.
- [ ] Phase 8 lens choice (vitals / metrics / moments) is named in
      the audit conclusion — no longer "three-way TBD". Plan-level
      pre-judgement (§Decisions #4) is **Vitals**; audit may
      override only if data is dead / SDK not emitting / table
      empty. Override fallbacks: Moments first, then Metrics.
- [ ] Any "delete now" modules removed cleanly; `bun run check` +
      `cargo check` still green.
- [ ] CI green after push.

**Ship vehicle:** doc-only commit, plus optional cleanup commit if
the audit surfaces a "delete now". No SDK / API change unless
deletion lands.

---

## Phase 2 — `/explore` grammar extension (B)

**Goal:** Cash in the v2.2 W3 stub (Issues per-row sparkline) and
extend `/explore` so the lenses in Phases 7 and 8 don't need new
endpoints.

**Inputs:** Phase 1 (audit may add or remove a dim/measure from
the list below).

**Deliverables:**

Server (`server/src/api/admin/explore.rs`):

- **New filters:**
  - `issueEq: Uuid` — single-issue filter (unblocks per-row
    sparkline + Phase 8 drill-down).
  - `userIdEq: String` — single-user filter (for Phase 7 lookups).
  - `routeEq: String` — route name filter (for Phase 8).
  - `osEq: String` — `device.os` value filter.
  - `search: Option<String>` — server-side fuzzy match on
    `error.message` / `error.type` / `message` (replaces the
    client-side W3 stub).

- **New dims:**
  - `device_os` — `device.os` × `device.osVersion` rollup.
  - `issue_priority` — `issues.priority`.
  - `severity` — event-level `level` enum.
  - `route` — `tags.route` (where present).

- **New measures:**
  - `new_issue_count` — events where `first_seen ≥ windowStart`.
  - `p50_duration` / `p95_duration` — spans table, on `events`
    that are spans; null on event-only dims.
  - `crash_free_rate` — gated on Phase 1 audit: if session schema
    is alive, ship; if not, mark explicitly "no session data
    available" in audit doc and **do not silently drop** — keep
    the slot in the design with a `// TODO(sessions)` and an
    issue tracker entry.

Web:

- `web/src/api/client.ts` — `ExploreFilter` / `ExploreDim` /
  `ExploreMeasure` enums mirror server, all new variants typed.
- `web/src/modules/issues/view.tsx` — per-row sparkline rendered
  via `dim=time_bucket` + `issueEq=<row>` (mini-chart component
  shared with Releases module).
- `web/src/modules/issues/view.tsx` — search input becomes
  server-side (`search` filter passed through; debounce 250 ms).
- Documentation update: `docs-site/src/content/docs/recipes/find-bugs-with-explore.md`
  gets a new section "Per-issue trend lines" with curl example.

**Acceptance:**

- [ ] `POST /admin/api/projects/<p>/explore` accepts every new
      filter / dim / measure; whitelist tested via unit tests in
      `server/src/api/admin/explore.rs#[cfg(test)]`.
- [ ] `/main/<org>/<project>/issues` renders per-row sparklines
      (sub-100ms render after rail data lands; sparkline data
      fetched in batched parallel calls).
- [ ] `/main/<org>/<project>/issues?search=foo` filters server-side.
- [ ] `crash_free_rate` either works against live session data OR
      is documented as no-session-source with an issue link.
- [ ] Recipe page updated.
- [ ] `bun run check` + `bun run test` + `cargo check --tests` +
      `cargo test` green.
- [ ] CI green after push.
- [ ] `/explore` p95 < 200 ms with all new dims, measured against
      prod read replica with the largest project's data.

**Ship vehicle:** server deploy + web deploy. No SDK change.

---

## Phase 3 — SDK native API polish (W6.1)

**Goal:** Land the design §2 API shape. Cuts to `init`, `withSpan`,
adds `beforeSend` hook (a recovered defer).

**Inputs:** Phase 0 (logger).

**Deliverables:**

- Flatten `init` per design §2.1:
  - `sample: { errors, traces, messages }` replaces flat
    `errorSampleRate` / `traceSampleRate` / `messageSampleRate`.
  - `capture: { globalErrors, promiseRejections, network, sessions,
    heartbeat, replay, screenshots, sessionTrail, longTaskMonitor,
    sampleProfiler, preCrashSentinel, launchCrashGuard }` groups
    every existing toggle.
  - Defaults per the design §2.1 rationale table.
- Backward compat: accept legacy flat fields, emit one-shot
  `logger.warn('init', '…deprecated; use init.sample.errors')`,
  map to new shape internally.
- Rename `withScopedSpan` → `withSpan`. Re-export
  `withScopedSpan = withSpan` for one version with deprecation
  hint at `debug`.
- New: `init({ beforeSend })` hook (recovered defer from design
  §8). Signature: `(event) => event | null`. Sync. Throwing or
  returning a non-event aborts the event with a one-shot
  `logger.warn`. Documented in `api/init.md` (Phase 6).
- Audit `capture.*` defaults match §2.1 table exactly; fix any
  divergence.
- Drop any remaining `Severity.Log`-equivalent code paths
  (compat layer in Phase 5 handles the Sentry → Sentori mapping
  for `Log → 'info'`).
- Tests: every renamed surface has unit tests in
  `sdk/core/src/__tests__/` and `sdk/react-native/src/__tests__/`.

**Perf verify (Phase 3 entry gate + exit gate):**

- **Entry gate (before W6.1 implementation starts):** fill the
  device-smoke table in `docs/perf-baselines/v2.2.1.md` with
  sim-sentori (iOS) + Pixel 10 Pro AVD numbers for both
  `logLevel: 'silent'` and `'debug'`. This is the baseline
  Phase 3's exit gate diffs against.
- **Exit gate (after W6.1 lands):** re-measure the same table
  with every capture flag toggled both default and opt-in; diff
  vs entry-gate numbers. Any regression > 5% CPU / > 1 ms
  per-tick → blocks ship. Mechanical bench (`perf.bench.ts`)
  must also stay green throughout.

**Acceptance:**

- [ ] All v2.3 design §2.1 init fields supported with documented
      defaults.
- [ ] Legacy flat-field call still works + emits one-shot warn.
- [ ] `withScopedSpan` still works + emits one-shot debug hint.
- [ ] `beforeSend` hook fires for `captureException` /
      `captureMessage`; returning `null` drops; throwing emits
      warn and drops.
- [ ] Perf diff against Phase 0 baseline within +5% CPU, +1 ms
      per-tick on both sims.
- [ ] CI green.
- [ ] Published as `@goliapkg/sentori-react-native@2.3.0-rc.1`
      (+ peer packages rc.1 via changesets) for dogfood.

**Ship vehicle:** SDK matrix `2.3.0-rc.1` tag. **Not published to
`latest` dist-tag** — to `next`. Insight dogfoods for 48h before
Phase 4 starts modifying ingest.

---

## Phase 4 — Identity layer + project-scope carve + DSR delete (W6.2 expanded)

**Goal:** Land the full identity layer per design §5, plus the two
recovered defers that belong here: **project-level identity-scope
carve** and **GDPR DSR delete endpoint**.

**Inputs:** Phase 3 (init.identity field).

**Deliverables:**

Server:

- Migration `server/migrations/0065_identity_scopes.sql`:
  - `identity_scopes(id uuid PK, name text, salt bytea[32],
    project_id uuid NULL, org_id uuid NOT NULL, created_at)`.
    **`project_id NULL` = org-default scope (one per org); not-null
    = project carve-out.** (Project carve is the v2.3 design §8
    recovered defer.)
  - `orgs.default_identity_scope_id uuid REFERENCES identity_scopes(id)`.
  - `projects.identity_scope_id uuid NULL REFERENCES identity_scopes(id)`
    (NULL = inherit org default).
  - `identity_fingerprints(event_id, scope_id, key_type,
    fingerprint, PRIMARY KEY (event_id, scope_id, key_type))`
    + secondary index `(scope_id, key_type, fingerprint)`.
- Bootstrap script: for every existing org, create a default
  identity_scope with random 32-byte salt; backfill
  `orgs.default_identity_scope_id`.
- Ingest path (`server/src/event.rs` or successor):
  - Resolve scope via `project.identity_scope_id ?? org.default_identity_scope_id`.
  - For each `link_hashes[key]`, compute
    `sha256(scope.salt || key || ":" || client_hash)` and insert
    into `identity_fingerprints`.
  - Strip suspicious raw PII fields (`email`, `phone`, `mail`)
    from `payload.user` with a tracing-side metric increment.
- Validation: `link_hashes` values must match `/^[a-f0-9]{64}$/`;
  malformed → 400 with clear error.
- Lookup endpoint
  `POST /admin/api/identity-scopes/{scope_id}/lookup`:
  - Body `{ keyType, clientHash }`.
  - Returns events ordered by `received_at DESC`, limit param
    (max 200).
  - Rate-limited 60 / min per operator session.
  - Identical response shape for match vs no-match (no
    enumeration).
- **DSR delete endpoint**
  `POST /admin/api/identity-scopes/{scope_id}/erase`:
  - Body `{ keyType, clientHash, dryRun: bool }`.
  - Soft-delete every event with matching fingerprint; cascading
    delete of fingerprint rows.
  - Returns count + sample event IDs.
  - Audit log entry per call (operator id + scope + count).

SDK (`sdk/core` + `sdk/react-native` + `sdk/javascript`):

- `User.linkBy` field per design §5.2.
- Client-side normalization per key type (email lowercase+trim,
  phone E.164, others raw) — `sdk/core/src/identity/normalize.ts`.
- Client-side `sha256` via `crypto.subtle.digest`
  (`sdk/core/src/identity/hash.ts`); fallback to Node
  `node:crypto` for SSR consumers.
- Discard raw value after hashing; scope state stores
  `{ id, name, linkHashes: { key: clientHash } }`.
- Wire payload: `linkHashes` field name (not `linkBy`).
- `init({ identity: false })` semantics: drop `linkBy`, emit
  one-shot `logger.info` per design §9 resolution 3.

Dashboard:

- `/main/<org>/<project>/users` view rebuilt:
  - Operator types `(keyType, rawValue)` in an input field
    (`<IdentityLookupInput>` component).
  - Browser computes `clientHash = sha256(normalised)`.
  - URL becomes `/users?type=email&hash=<8-char-prefix>…<full-hex-in-state>` —
    raw value never enters URL / history / browser storage.
  - Renders cross-project event list, issue list, first/last
    seen, counts.
  - Empty / loading / error states per the v2.2 UX checklist.
- Issue Detail per-event display per design §5.6:
  - Shows `user.id`, `user.name`, identity types present (just
    the keys), fingerprint 8-hex prefix.
  - Never displays raw email / phone / sub.
  - "🔍 Look up across projects →" button → `/users?type=…&hash=…`.
- **Project carve-out UI:**
  `/main/<org>/<project>/settings/identity-scope`:
  - Toggle "Use org default scope" / "Use carved project scope".
  - Creating a carved scope generates a new salt server-side;
    operator chooses a name.
  - **Warning copy**: switching scopes orphans historical
    fingerprints; document the consequence explicitly.
- **DSR erase UI:**
  `/main/<org>/<project>/settings/data-subject-request`:
  - Input `(keyType, rawValue)`.
  - Dry-run first (returns count); operator must check "Yes,
    erase N events" before the live call.
  - Audit log link.

**Acceptance:**

- [ ] Migration applies cleanly on prod read replica clone.
- [ ] Existing events without `link_hashes` continue to ingest.
- [ ] `setUser({ linkBy: { email: 'lihao@golia.jp' } })` from
      `apps/rn-example` results in `identity_fingerprints` row;
      raw email nowhere on wire / in DB / in tracing logs (verified
      via `grep` over server log buffer + tcpdump check during
      ingest).
- [ ] Malformed `link_hashes` (non-hex / wrong length) → 400.
- [ ] Lookup endpoint returns matching events; cross-project
      enumeration works.
- [ ] Rate limit triggers on 61st request in a minute.
- [ ] DSR erase dry-run + live both work; audit log captures.
- [ ] Project carve-out UI creates a new scope and routes
      subsequent events through it.
- [ ] All dashboard UX states (empty / loading / error / edit /
      delete / confirm) covered per v2.2 UX checklist.
- [ ] Perf: SubtleCrypto identity hash < 5 ms for 3 keys on both
      sims (design §6 budget).
- [ ] CI green.
- [ ] Published as `@goliapkg/sentori-react-native@2.3.0-rc.2`
      via changesets.

**Ship vehicle:** server deploy + SDK rc.2 + web deploy.

---

## Phase 5 — Sentry compat layer (W6.3)

**Goal:** Drop-in compat per design §4, so any LLM-trained code
using `@sentry/react-native` API works against Sentori.

**Inputs:** Phase 4 (identity layer; compat's `setUser` translation
needs it).

**Deliverables:**

- New sub-module `sdk/react-native/src/compat/index.ts` exporting
  `{ Sentry }` namespace (per design §9 resolution 4; path is
  `/compat`, not `/sentry-compat`).
- `Sentry.init({ dsn, ... })`:
  - DSN parser: `https://<key>@<host>/<projectId>`. `key` must
    match `st_pk_…` else throws with clear message ("Sentori
    tokens look like st_pk_…; if you have a Sentry DSN, see
    docs/migration").
  - `host → ingestUrl`.
  - `projectId` ignored with one-shot dev hint.
- Translation table per design §4.2 fully implemented:
  - `Sentry.captureException(err)` / `Sentry.captureException(err, hint)`
  - `Sentry.captureMessage(msg)` / with severity.
  - `Sentry.setUser({ id, email, username, ip_address })` —
    `email` / `username` → `linkBy`; `ip_address` dropped + hint.
  - `Sentry.setTag` / `setTags`.
  - `Sentry.addBreadcrumb({ category, message, level, data, type })` —
    `category` → `type` via well-known map (`auth → user`,
    `fetch → http`, ...); else `tags.category`.
  - `Sentry.startTransaction({ op, name })` → `startTrace(name)`.
  - `Sentry.startSpan({ op, name }, fn)` → `withSpan`.
  - `Sentry.startInactiveSpan({ name })` → `startSpan`.
  - `Sentry.withScope(fn)` — internal push/pop, calls
    `fn(proxyScope)` exposing `setTag` etc.
  - `Sentry.configureScope` → same minus push/pop; hint
    "prefer withScope".
  - `Sentry.flush(timeoutMs)` / `Sentry.close()`.
- One-shot warn dedup: `(api_name, dropped_or_remapped_field)`
  keyed, session-scoped, info level.
- `Sentry.Integrations.*` refusal: throws clear error pointing to
  equivalent `init.capture` flag.
- Tests in `sdk/react-native/src/compat/__tests__/`:
  - One test per translation entry asserting the Sentori-native
    call shape it produces.
  - One real-Sentry sample-app shim (storybook-like) that runs
    against compat and asserts events arrive at the mock
    transport.

**Acceptance:**

- [ ] Every row in the design §4.2 translation table has a
      passing test.
- [ ] Importing `from '@goliapkg/sentori-react-native/compat'`
      works in `apps/rn-example` with `Sentry.init({ dsn:
      'https://st_pk_…@ingest.sentori.golia.jp/1' })`.
- [ ] DSN with wrong key prefix throws expected error.
- [ ] `Sentry.Integrations.NewRelic` registration throws expected
      refusal.
- [ ] `logLevel: 'silent'` suppresses all compat hints.
- [ ] CI green.
- [ ] Published as `@goliapkg/sentori-react-native@2.3.0-rc.3`.

**Ship vehicle:** SDK rc.3. No server / dashboard change.

---

## Phase 6 — v2.3 docs + release (W6.4)

**Goal:** v2.3 SDK matrix major release with full docs.

**Inputs:** Phases 3, 4, 5 (rc.1 / rc.2 / rc.3 dogfooded for ≥ 48h
each on Insight).

**Deliverables:**

Docs (`docs-site/src/content/docs/`):

- `getting-started.md` — Sentori-native first; v2.3 init shape.
- `compat/sentry.md` — drop-in migration guide.
- `privacy/identity.md` — the audit-safe explanation (legal-readable;
  cite design §5 + §5.7).
- `privacy/dsr.md` — operator workflow for DSR erase.
- `api/init.md` — every init field documented with default + rationale.
- `api/capture.md` — `captureException` + `captureMessage` +
  `addBreadcrumb` + `setUser`.
- `api/scope.md` — scope mutation surface.
- `api/tracing.md` — `startSpan` / `withSpan` / `startTrace` /
  `startMoment`.
- `api/logger.md` — `setLogLevel` + `setLogTransport`.
- `api/before-send.md` — `beforeSend` hook contract.
- Sidebar registration in `docs-site/astro.config.mjs` under
  "API" + "Compat" + "Privacy" sections.

Roadmap:

- `docs/roadmap/v2.3.md` — full L1 / L2 / L3 / L4 plan citing each
  phase's deliverables.
- `ROADMAP.md` flips v2.3 line to `✅ shipped` with commit shas.
- `CHANGELOG.md` v2.3 entry summarizing API changes + migration
  pointers.

Release:

- Changesets bump:
  - `@goliapkg/sentori-react-native@2.3.0` (major — `withSpan`
    rename, flat init removed in next major but kept in 2.3)
  - `@goliapkg/sentori-core@2.0.0` (major — logger + identity)
  - `@goliapkg/sentori-javascript@2.0.0` (major)
  - `@goliapkg/sentori-react@2.0.0`, `vue@2.0.0`, `svelte@2.0.0`,
    `solid@2.0.0` (peer-dep cascade per
    `.claude/memory/feedback_changeset_publish.md`)
  - `@goliapkg/sentori-next@2.0.0`, `expo@4.0.0`
- `git tag v2.3.0`; release notes from changelog.

**Acceptance:**

- [ ] Every public type / function in design §2 has a docs entry.
- [ ] `https://sentori.golia.jp/docs/compat/sentry/` renders the
      migration guide.
- [ ] `https://sentori.golia.jp/docs/privacy/identity/` renders
      the legal-readable explanation.
- [ ] ROADMAP.md + CHANGELOG.md updated.
- [ ] `bunx changeset version` run with `GITHUB_TOKEN=$(gh auth token)`
      per the publish gotcha memory.
- [ ] All npm packages published; `npm view @goliapkg/sentori-react-native version`
      reports `2.3.0`.
- [ ] `git tag v2.3.0` pushed.
- [ ] CI green throughout.

**Ship vehicle:** doc deploy + npm major matrix + git tag.

---

## Phase 7 — find-user lens (D) — v2.4

**Goal:** Open the find-user lens. Users module becomes a fully
designed surface around identity lookup + cohort.

**Inputs:** Phase 4 (identity), Phase 2 (`userIdEq` filter).

**Deliverables:**

Doc:

- `docs/roadmap/v2.4.md` — full L1 / L2 / L3 / L4 plan.

Web:

- Users view enriched beyond the Phase 4 lookup:
  - **Measure picker:** `event_count` / `issue_count` /
    `unique_devices` / `first_seen` / `last_seen`.
  - **Window picker:** `1d` / `7d` / `30d` / `all`.
  - **Dim toggle:** `dim=user` (default) for "top affected
    users", `dim=time_bucket` + `userIdEq=…` for one user's
    timeline.
  - **Cross-project drill:** clicking a user with multiple
    projects shows a project breakdown table.
- Issue Detail "Affected users" panel:
  - Shows top-N users (by event count for this issue) within
    the active window.
  - Each row clicks through to the Users view filtered by that
    user.
- **Audience module** (Phase 1 audit decides: keep as cohort view
  OR fold into Users view OR delete):
  - If kept: rebuilt as `/explore` consumer with
    `dim=user_cohort`. Cohorts defined as
    `(linkBy keyType, ingest source)` joins.
  - If folded: Users view gains a "Cohorts" tab.
  - If deleted: registry entry removed; this is part of Phase 1
    cleanup, not Phase 7.

Server:

- **Identity merge** (recovered defer from design §8):
  - `POST /admin/api/identity-scopes/{scope_id}/merge`:
    body `{ primary: { keyType, clientHash }, alias: { keyType, clientHash } }`.
  - Stores a merge edge in new `identity_merges(scope_id, primary_fp,
    alias_fp, merged_by, merged_at)` table.
  - Lookup endpoint transparently follows merge edges (alias →
    primary).
  - Audit log entry per merge.
- Merge UI on Users view: "These two are the same person" action
  with confirm dialog; undo within 7 days.

`/explore` additions (if needed):

- `dim=user_cohort` (only if Audience kept) → adds match arm in
  `explore.rs`.

**Acceptance:**

- [ ] `/main/<org>/<project>/users` renders top affected users
      with measure + window pickers, sorted desc.
- [ ] One-user timeline (`?userId=…`) renders with sparkline.
- [ ] Issue Detail "Affected users" panel renders top-N with
      drill.
- [ ] Identity merge: merging two fingerprints causes alias-hash
      lookups to return primary's events.
- [ ] Audience module verdict (per Phase 1 audit) implemented.
- [ ] Full UX checklist on every new view.
- [ ] `bun run check` + `bun run test` + `cargo check --tests` +
      `cargo test` green.
- [ ] CI green.
- [ ] Recipe `docs-site/recipes/find-users-affected.md` published.
- [ ] ROADMAP.md v2.4 line flipped to `✅ shipped`.

**Ship vehicle:** server deploy + web deploy. No SDK change
(identity emit landed in Phase 4).

---

## Phase 8 — find-slow lens (C) — v2.5

**Goal:** Open the find-slow lens around whichever datasource
Phase 1 picked (most likely Vitals or Moments).

**Inputs:** Phase 1 (datasource decision), Phase 2 (`p50`/`p95`
measures + `routeEq` filter), Phase 7 (stop-ship rule — Phase 7
ships first).

**Deliverables:**

Doc:

- `docs/roadmap/v2.5.md` — full L1 / L2 / L3 / L4 plan.

Web (depending on Phase 1 verdict):

- New top-level module flipped from `hidden: true` to visible.
- **Route view:** `dim=route`, measures `p95_duration` /
  `p50_duration` / `error_rate` / `event_count`, window picker.
- **Endpoint / HTTP view:** `dim=http_endpoint`,
  `op=sentori.http` filter, same measures.
- **Drill:** clicking a route → spans list for that route within
  the active window.
- **Compare mode:** select two values within the same dim
  (e.g. iOS 17 vs Android 14 for the same route) → side-by-side
  measure table with delta column.

Server:

- Possibly extend `explore.rs` with `dim=http_endpoint` if Phase 2
  didn't already cover it (audit at start of Phase 8).
- Spans list endpoint for drill-down if `traces` module stays
  hidden: a thin "spans for this route in this window" admin
  endpoint scoped tighter than re-opening Traces.

SDK:

- Only if Phase 1 audit said the chosen datasource needs SDK
  hygiene (e.g. metric channel changed). Default expectation:
  zero SDK change.

**Acceptance:**

- [ ] New lens module visible in dashboard sidebar.
- [ ] Route / endpoint view renders with all measure + window
      pickers.
- [ ] Drill to spans works.
- [ ] Compare mode renders A vs B side-by-side.
- [ ] Full UX checklist.
- [ ] CI green.
- [ ] Recipe `docs-site/recipes/find-slow.md` published.
- [ ] ROADMAP.md v2.5 line flipped to `✅ shipped`.

**Ship vehicle:** server deploy + web deploy. SDK only if
unavoidable (see above).

---

## Recovered defers

The v2.3 design doc §8 listed seven items as "Out of v2.3 scope
(defer to v2.4+)". This plan re-homes each:

| Defer item | Re-home |
|---|---|
| Project-level identity-scope carve | **Phase 4** (`identity_scopes.project_id` column + carve-out UI). |
| Operator-driven identity merge | **Phase 7** (`identity_merges` table + merge action on Users view). |
| GDPR DSR delete endpoint | **Phase 4** (`/erase` endpoint + dashboard UI with dry-run confirm). |
| Verify rig run for perf numbers | **Phase 0** (baseline) + **Phase 3** (diff vs baseline; +5% CPU / +1ms per-tick blocks ship). |
| Region scope (data residency) | **Kept deferred.** Reason: multi-region routing is a deploy-infrastructure project (Caddy + DNS + Postgres replication) that doesn't fit in any SDK / dashboard phase. Will get its own roadmap doc when there's customer pull. |
| Native API for in-SDK PII scrub hook (`beforeSend`) | **Phase 3** (init hook + dedicated docs page). |
| Salt rotation | **Kept deferred.** Reason: requires a historical fingerprint rebuild migration that is data-volume-dependent — design doc to be written when we have a forcing function (e.g. salt leak). Tracked as `docs/design/salt-rotation.md` placeholder to be authored during Phase 4. |

## Decisions

Takagi delegated to claude on 2026-06-03 ("I can give product +
technical requirements but not detail judgements"). Resolutions:

1. **Phase 7 before Phase 8 (D before C).**
   - Reason: Phase 4 leaves the Users view as a half-built surface
     (identity lookup works but no measure / window / cohort lens).
     Letting it sit in that state between Phase 6 and Phase 8 is the
     exact "feature gap is shipped" failure mode that the
     `feedback_webapp_ux_is_delivery` memory warns about. D
     closes that gap; C is a wholly new module that can wait.
   - Counter-reason rejected: "find-slow is a higher-stakes
     differentiator" — true, but lens stop-ship rule + UX-is-delivery
     rule together say finish what's half-done first.

2. **Phase 4 ships migration + SDK rc.2 together (no extra dogfood
   gate between them).**
   - Reason: migration is purely additive — new tables, new nullable
     columns; zero modification to existing event ingest path until
     a host actually sends `link_hashes`. Hosts on v2.0 / v2.1 / v2.2
     SDKs see no behaviour change at ingest. Splitting into two
     dogfood windows adds calendar time without surfacing additional
     bugs (the bug surface is the new write path on real linkBy
     payloads, which only opens with rc.2 anyway).
   - Mitigation: rc.2 publishes to npm `next` dist-tag, not `latest`.
     Insight upgrades manually with explicit dogfood intent.

3. **Phase 6 ships `core@2.0.0` as part of the coordinated major
   bump (no identity-package split).**
   - Reason: identity is SDK plumbing, not an optional add-on.
     Splitting into `@goliapkg/sentori-identity` violates design §3
     T3 "single entry surface" (host should not chase sub-packages
     for common ops) and §9 resolution 4's logic (compat is a
     sub-path inside the main package, exactly to avoid forced
     extra installs).
   - Logger module addition alone is already a meaningful API
     surface change to `core`; identity makes the major bump
     unambiguously correct rather than borderline. One coordinated
     release reduces peer-dep cascade churn
     (`feedback_changeset_publish`) compared to two staggered
     majors.

4. **Phase 8 datasource pre-judgement: lean Vitals, but Phase 1
   audit may override.**
   - Reason for lean: Vitals is natively a "perf observed from the
     client" surface — matches find-slow framing directly. Metrics
     (v0.8.3 `recordMetric` channel) is custom user-defined,
     wrong altitude for an opinionated lens. Moments is event-
     bounded (defined start + end), narrower than per-route p95.
   - Audit overrides this if: Vitals SDK side is dead / data is
     not flowing / table is empty. Then Moments is the fallback
     (still natively timing-shaped); Metrics is the dispreferred
     fallback because it forces dashboard to handle arbitrary
     user-defined names without an opinionated default cut.
   - Phase 1 acceptance updated to require an explicit "Phase 8
     uses X" verdict in the audit conclusion.

5. **Phase 4 is infra, not a new lens. Phase 7 is the lens open.**
   - Confirmed reading: lens stop-ship rule's purpose is to prevent
     `hidden: true → false` flips happening without a designed
     surface (`project_v22_lens`). Users was flipped visible in
     v2.2 already, in the half-built state. Phase 4 installs the
     plumbing the existing visible view depends on — it adds no
     new visible module, it makes an already-visible one work
     correctly. That is maintenance, not lens opening.
   - Phase 7 opens the lens proper: the Users view gains measure /
     window / cohort affordances; Audience may flip from hidden
     (per Phase 1 audit verdict); Issue Detail gets the affected-
     users panel. That batch is a designed lens surface and
     counts as the lens stop-ship "one lens at a time" turn.

## Sequencing summary

```
Phase 0   →  v2.2.1 SDK patch        (1 day)
Phase 1   →  audit doc               (1 day)
Phase 2   →  v2.3 server/web         (2-3 days)
Phase 3   →  v2.3.0-rc.1 SDK         (1-2 days)
            [48h dogfood]
Phase 4   →  v2.3.0-rc.2 + migration (3-4 days)
            [48h dogfood]
Phase 5   →  v2.3.0-rc.3 SDK         (2-3 days)
            [48h dogfood]
Phase 6   →  v2.3.0 major release    (1 day)
Phase 7   →  v2.4 find-user lens     (3-4 days)
Phase 8   →  v2.5 find-slow lens     (3-4 days, after Phase 7 closed)
```

Total wall-clock with dogfood gates ~3 weeks of focused work; the
gates absorb most of the calendar time. No phase is expected to
slip into the next without closing its acceptance list first.

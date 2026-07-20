# Single-DB Pivot — Decomposition Ground Truth

> Read-only decomposition produced 2026-06-22 by Plan agent prior to attack phase.
> Per `.claude/rules/decomposition-before-attack.md` `rule/decomposition-must-balance-budget`.
> **Do NOT edit during attack phase**. Treat as a contract between decomposition and attack.

## Context

v0.1 originally designed for **1-pg-database-per-tenant**. User rejected multi-database on SaaS on 2026-06-22. Decision:

- **SaaS**: single schema + `workspace_id` column on every table + Postgres RLS (`SET app.current_workspace = $1` per-request)
- **self-hosted**: same schema, single default `workspace_id` row
- **shared code path**: 17 钢筋 crates use identical migration + store implementation

## §0 Inventory totals

| Metric | Count |
|---|---:|
| Migration files | **15** |
| sqlx-touching crates | **17** (of 30 in `core/crates/`) |
| Total `sqlx::query*` invocations | **174** across 25 source files |
| Total integration tests | **279** across 16 `tests/integration.rs` |
| Tables needing `workspace_id` + RLS | **23** |
| Singleton indexes needing `((1))` → `(workspace_id)` widening | **3** |

## §1 Migrations — per-file verdict

Existing RLS coverage: **zero**. No `CREATE POLICY` / `ROW LEVEL SECURITY` anywhere. Every table below gets RLS at attack phase.

### 0001_workspace_identity.sql (137 lines)
Tables: `users`, `workspace_members`, `privacy_salts`, `projects`, `project_user_visibility`, `workspace_invites`, `app_user_identities`, `audit_logs`.
- `project_id` already on: `project_user_visibility` L81, `app_user_identities` L117, `audit_logs` L128.
- `workspace_id`: **none**.
- **Verdict**:
  - Add `workspace_id UUID NOT NULL` to all 8 tables.
  - Change `workspace_members_one_owner` partial-unique from `((1)) WHERE role='owner'` to `(workspace_id) WHERE role='owner'`.
  - Change `users_email_ci_idx` from global `LOWER(email)` to `(workspace_id, LOWER(email))`.
  - Enable RLS + policy on all 8.
  - **New table** `workspaces (id UUID PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`.

### 0002_auth_session.sql (71 lines)
Tables: `auth_sessions`, `email_verifications`, `password_resets`. None have project_id/workspace_id; all FK on `users(id)`.
- **Verdict**: Add `workspace_id` (inherit from user). RLS on all 3. Indexes keep current shape (janitors run as superuser, bypass RLS).

### 0003_event_pipeline.sql (75 lines)
Tables: `issues` L26, `events` L50. Both have `project_id NOT NULL`.
- **Verdict**: Add `workspace_id` (denormalized via project FK chain; write at INSERT). RLS on both. Existing project-prefixed composite indexes stay — RLS WHERE rewrite still hits them.

### 0004_issue_triage.sql (45 lines)
ALTER only on `issues`. 3 new indexes.
- **Verdict**: No shape change after 0003.

### 0005_span_pipeline.sql (109 lines)
Tables: `spans` (partitioned by `received_at` L17), `traces` L82. Both have `project_id`.
- **Verdict**: Add `workspace_id` to both. RLS. **Partition note**: `spans` PK is `(received_at, id)` — do NOT touch PK, RLS goes over it.

### 0006_push_tokens.sql (84 lines)
Tables: `push_tokens` L25, `push_credentials` L63. Both have `project_id`.
- **Verdict**: Add `workspace_id`. RLS. Existing project-prefixed unique indexes safe.

### 0007_replay_sessions.sql (59 lines)
Table: `replay_sessions` L21. Has `project_id`.
- **Verdict**: Add `workspace_id`. RLS.

### 0008_runtime_metrics.sql (143 lines)
Tables: `runtime_metrics_raw` (partitioned L27), `_1m` L78, `_1h` L96, `_1d` L114, `_dropped` L136. All 5 have `project_id`.
- **Verdict**: Add `workspace_id` to all 5. RLS on all 5. PK shapes safe.

### 0009_cert_observations.sql (65 lines)
Tables: `cert_watch_domains` L23, `cert_observations` L38. Both have `project_id`.
- **Verdict**: Add `workspace_id`. RLS.

### 0010_delivery_log.sql (72 lines)
Table: `delivery_log` L25. `project_id NULLABLE` (system-level notifications).
- **Verdict**: Add `workspace_id NOT NULL` (system notifs still workspace-bound). RLS. `delivery_log_dedup_idx` widen to `(workspace_id, dedup_key)`.

### 0011_integrations.sql (71 lines)
Tables: `integrations` L24 (project_id), `issue_integration_links` L50 (issue_id only).
- **Verdict**: Add `workspace_id` to both (denormalize on `issue_integration_links`). RLS. **Risky reverse-lookup index** `issue_integration_links_kind_external_idx` MUST widen to `(workspace_id, kind, external_id)` — otherwise webhook ingest can read wrong tenant.

### 0012_audit_log_indexes.sql (25 lines)
Pure index migration on `audit_logs`. 3 new indexes.
- **Verdict**: After 0001's audit_logs gets `workspace_id`, rewrite these as `(workspace_id, actor_user_id, created_at DESC)` etc.

### 0013_alert_rules.sql (81 lines)
Table: `alert_rules` L41. `project_id NULLABLE` (workspace-wide). `alert_rules_workspace_wide_idx` L73 = `((1)) WHERE project_id IS NULL` — singleton.
- **Verdict**: Add `workspace_id NOT NULL`. RLS. Rewrite singleton index to `(workspace_id) WHERE project_id IS NULL`.

### 0014_saved_views.sql (70 lines)
Table: `saved_views` L31. `project_id NULLABLE`, `user_id NULLABLE` (CHECK enforces scope ↔ FK polarity).
- **Verdict**: Add `workspace_id NOT NULL`. RLS. `saved_views_workspace_target_idx` widen to `(workspace_id, target)`.

### 0015_billing.sql (68 lines)
Tables: `workspace_billing` L30 (singleton via `workspace_billing_singleton_idx ON ((1))`), `usage_counters` L54.
- **Verdict**: Both get `workspace_id`. Singleton index must become `(workspace_id)` unique.

**Migration § summary**: 23 tables × 2 (column add + RLS policy) + 3 singleton index rewrites + 1 reverse-lookup index widening + 1 new `workspaces` table.

## §2 17-crate sqlx query inventory

| Crate | File | Lines | SEL | INS | UPD | DEL | sqlx | `project_id` | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| alert-rule | service.rs | 512 | 5 | 1 | 3 | 1 | 12 | 16 | **Hard** — project_id NULLABLE complicates every read/write |
| audit-event | service.rs | 400 | 3 | 1 | 0 | 0 | 4 | 17 | **Easy** — project-keyed; bind workspace_id on INSERT |
| auth-session | store/sessions.rs | 345 | 2 | 1 | 1 | 4 | 8 | 0 | **Medium** — user-scoped, add workspace_id everywhere |
| auth-session | store/email_verifications.rs | 199 | 3 | 1 | 1 | 1 | 5 | 0 | **Medium** |
| auth-session | store/password_resets.rs | 167 | 1 | 1 | 1 | 1 | 4 | 0 | **Easy** |
| billing | service.rs | 403 | 4 | 4 | 1 | 1 | 11 | 25 | **Hard** — workspace_billing singleton refactor |
| cert-monitor | monitor.rs | 507 | 4 | 2 | 1 | 1 | 8 | 34 | **Easy** — fully project-scoped |
| event-pipeline | store.rs | 288 | 4 | 2 | 1 | 0 | 7 | 19 | **Medium** — 2 ID-only SELECTs become RLS-protected |
| integration-traits | service.rs | 465 | 7 | 2 | 1 | 1 | 11 | 28 | **Hard** — reverse-lookup + denorm on links |
| issue-store | store.rs | 655 | 11 | 0 | 2 | 1 | 14 | 16 | **Medium** — 11 SELECTs ride RLS, UPDATEs need bind |
| notifier | service.rs | 397 | 4 | 1 | 3 | 0 | 8 | 13 | **Medium** — nullable project + dedup index |
| push-provider | tokens.rs | 217 | 3 | 1 | 1 | 1 | 6 | 18 | **Easy** |
| push-provider | credentials.rs | 210 | 1 | 1 | 1 | 1 | 4 | 20 | **Easy** |
| replay-store | store.rs | 332 | 3 | 1 | 0 | 1 | 5 | 13 | **Easy** |
| runtime-metrics | store.rs | 415 | 2 | 5 | 0 | 0 | 7 | 29 | **Medium** — 5 INSERTs across rollup tiers |
| runtime-metrics | partitions.rs | 183 | 1 | 0 | 0 | 0 | 3 | 0 | **Trivial** — partition DDL, superuser |
| saved-view | service.rs | 358 | 5 | 1 | 1 | 1 | 8 | 12 | **Medium** — nullable project + index rewrite |
| span-store | store.rs | 304 | 3 | 2 | 0 | 0 | 5 | 16 | **Easy** |
| span-store | partitions.rs | 273 | 1 | 0 | 0 | 3 | 5 | 0 | **Trivial** |
| tenant-scoping | guard.rs | 272 | 2 | 0 | 0 | 0 | 2 | 1 | **Heavy refactor** (see §3) |
| workspace-identity | store/users.rs | 181 | 3 | 1 | 0 | 0 | 6 | 0 | **Hard** — email-uniqueness becomes per-workspace |
| workspace-identity | store/members.rs | 276 | 5 | 1 | 0 | 3 | 12 | 0 | **Hard** — singleton-owner index reshape |
| workspace-identity | store/projects.rs | 198 | 5 | 2 | 0 | 1 | 7 | 3 | **Medium** |
| workspace-identity | store/invites.rs | 244 | 4 | 2 | 1 | 1 | 7 | 0 | **Medium** |
| workspace-identity | store/visibility.rs | 164 | 3 | 1 | 0 | 1 | 5 | 20 | **Easy** |

**§2 totals**: 174 sqlx invocations, 25 files. Hard ≈ 73; Medium ≈ 63; Easy ≈ 38.

**Budget contract for attack phase**: **130–264 atomic edits** (50–75% of 174 sqlx invocations × ≥1 edit, plus all INSERT bind sites). Exceed 264 = under-decomposed. Below 130 = missed binds.

## §3 tenant-scoping expansion API

Current state:
- `TenantGuard` `guard.rs:11` wraps a single `PgPool`.
- `UserId`, `ProjectId` exist as `id_newtype!` in `workspace-identity/src/model.rs:95–96`. **`WorkspaceId` does NOT exist** (grep confirmed).
- No `SET app.current_workspace` / `set_config` code anywhere.
- `TenantGuard::pool() → &PgPool` (L25) hands out raw pool to every caller.
- 2 inline queries: L80 (project list), L249 (visibility EXISTS check).

Required additions:

```rust
// workspace-identity/src/model.rs
id_newtype!(WorkspaceId, "Strongly-typed `workspaces.id` newtype.");

// tenant-scoping/src/scoped_pool.rs (NEW FILE)
#[derive(Clone, Debug)]
pub struct WorkspaceScopedPool {
    inner: PgPool,
    workspace: WorkspaceId,
}

impl WorkspaceScopedPool {
    pub fn new(pool: PgPool, workspace: WorkspaceId) -> Self { ... }

    pub async fn acquire(&self) -> Result<PoolConnection<Postgres>, TenantError> {
        let mut conn = self.inner.acquire().await?;
        sqlx::query("SELECT set_config('app.current_workspace', $1, true)")
            .bind(self.workspace.into_uuid().to_string())
            .execute(&mut *conn).await?;
        Ok(conn)
    }

    pub async fn begin(&self) -> Result<Transaction<'_, Postgres>, TenantError> {
        let mut tx = self.inner.begin().await?;
        sqlx::query("SELECT set_config('app.current_workspace', $1, true)")
            .bind(self.workspace.into_uuid().to_string())
            .execute(&mut *tx).await?;
        Ok(tx)
    }
}
```

Breaking changes:
- `TenantGuard::new(pool)` → `TenantGuard::new(pool, workspace_id)` — ripples into every test fixture (16) + every server bootstrap.
- `pool()` accessor return type changes (or deprecate + add `scoped_pool()`).
- Janitor / migration paths need a `SuperuserPool` escape hatch (raw `PgPool`, RLS bypassed via superuser default).

## §4 Test matrix impact

Inventory:
- 16 `tests/integration.rs`, **279** tests.
- `fresh_pool()` invocations: **264** call sites; definitions: 18.
- `seed_project()`: 128 invocations; 14 definitions.
- `seed_workspace()`: **0** (no concept exists yet).
- `CREATE DATABASE` admin connections: 16.

Current pattern (event-pipeline/tests/integration.rs L60–83):
1. Lazy `testcontainers Postgres` rig per process.
2. Per test: connect admin DB → `CREATE DATABASE "t_<uuid>"` → connect → run migrations → return pool.
3. Isolation = DB-level.

Post-pivot pattern:
- `ensure_rig` unchanged. **One shared DB per rig**, migrations baked at boot.
- New `fresh_workspace_pool() → (WorkspaceScopedPool, WorkspaceId)`:
  - `INSERT INTO workspaces (id, name) VALUES ($1, $2)` per test, ~1ms.
  - Wrap shared pool with new `WorkspaceId`.
- `seed_project(scoped_pool, slug)` — workspace_id comes from `scoped_pool`.

Isolation guarantees (replacing per-test DB):
- Per-test UUIDv7 `WorkspaceId` (collision ≈ 0).
- RLS enforces zero cross-workspace leak — a test that forgets `SET app.current_workspace` errors out (`current_setting()` returns `''` → policy filter rejects).
- **Sqlx pool connection reuse caveat**: must use `SET LOCAL` inside transactions OR `SET` per acquisition. `WorkspaceScopedPool::acquire/begin` handles both.

Expected test runtime: ~**100× speedup** on integration suite (per-test `CREATE DATABASE` ~50–200ms → per-test `INSERT INTO workspaces` ~1ms), IF RLS overhead < 5%.

## §5 Predictions for attack-phase verification

**Top-3 hardest crates** (the attack should NOT find these easy):

1. **workspace-identity** (4 files, 30 sqlx) — every table newly gains workspace_id; users email uniqueness becomes per-workspace; members singleton-owner index shape change; wide blast radius via `Identity::new(pool)` (12+ downstream).
2. **billing** (11 sqlx, 25 project_id refs) — `workspace_billing` singleton refactor + migration 0015 singleton index rewrite.
3. **tenant-scoping** (only 2 sqlx, but auth-gate for every other crate) — `WorkspaceScopedPool` + `SET app.current_workspace` + breaking `TenantGuard::new` signature ripples into 16 test files + every bootstrap.

**Top-3 easiest crates** (attack should land these in minutes):

1. **cert-monitor** (1 file, 8 sqlx, 34 project_id refs).
2. **push-provider/credentials.rs** (4 sqlx, all `WHERE project_id AND kind`).
3. **replay-store** (5 sqlx, 13 project_id refs).

**Translation rule** if attack-phase finds the predictions wrong:
- An "easy" crate turning hard = missed a NULL-project / singleton / denormalization edge case in §1 or §2.
- A "hard" crate turning easy = the RLS-protection-of-SELECTs assumption holds stronger than predicted (good news, but verify nothing leaked).

## §6 Files most critical for implementation order

1. `core/migrations/0001_workspace_identity.sql` — adds `workspaces` table + WorkspaceId infra
2. `core/crates/workspace-identity/src/model.rs` — `WorkspaceId` newtype
3. `core/crates/tenant-scoping/src/scoped_pool.rs` (NEW) — `WorkspaceScopedPool`
4. `core/crates/workspace-identity/src/store/members.rs` — singleton-owner refactor
5. `core/crates/billing/src/service.rs` — singleton-workspace_billing refactor

## §7 Branch + commit plan

- Working branch: `feature/v0.1-single-db` (cut from `feature/v0.1-fresh-start`).
- Commit per Phase: P1 migration → P2 tenant-scoping → P3 store crates (likely split into Easy/Medium/Hard sub-commits) → P4 SaaS layer → P5 self-hosted layer → P6 test fixture rewrite → P7 webapp/docs.
- Do NOT merge to `develop` until P6 全绿 + attack-phase budget assertion (130–264 edits) holds.

## §8 Out of scope (deferred)

- RLS perf bench (will run in P6, but if regression > 5% we keep design + add tuning, NOT revert).
- Cross-workspace admin tooling (SaaS support staff inspecting tenant data) — uses SuperuserPool escape, not productized.
- Workspace export / migration tooling — v0.2.
- Multiple workspaces per user (currently 1:1 in design) — v0.2.

# Legacy inventory — v0.2 foundation

Read-only inventory of legacy `server/` + `web/` + `sdk/` for v0.2 design.
Produced 2026-06-22 by Phase A inventory. **Do not edit** during Phase B/C/D —
treat as ground-truth contract for the v0.2 build.

## §0 Meta totals

| 项 | 数 |
|---|---:|
| Legacy migrations | ~82 (`server/migrations/0001-0082*.sql`) |
| Final schema tables | ~68 |
| Final schema columns | ~360 |
| Multi-tenancy mechanism | **Row-level via `org_id`** (NOT schema-per-tenant) — confirmed in ~55 tables since `0007_multi_tenant` |
| Partitioned tables | 2 (`events`, `spans`) — monthly by `received_at` |
| Named indexes | ~120 |
| SDK ingest endpoints | **28** (`/v1/*` 全部 Bearer `st_pk_<26 base32>`) |
| Admin endpoints | ~95 (`/admin/api/*`, cookie session) |
| Auth endpoints | ~13 (`/auth/*`) |
| Total endpoint surface | ~136 |
| SDK packages | core / react-native / javascript / react / next / vue / svelte / solid / angular / remix / expo / flutter / cli |

## §1 Migration schema — chronological

### Phase 5 (0001–0005) MVP

| File | Tables |
|---|---|
| `0001_init` | `projects`, `tokens`, `events` |
| `0002_issues` | `releases`, `issues` |
| `0003_partition_events` | events → RANGE partitioned by `received_at` (PK = `(received_at, id)`) |
| `0004_issue_denorm` | `issues.last_environment`, `issues.last_release` |
| `0005_release_artifacts` | `release_artifacts` |

### Phase 13 (0006–0009) Multi-tenancy

| File | Tables |
|---|---|
| `0006_notifications` | `notification_recipients` |
| `0007_multi_tenant` | **`users`, `orgs`, `memberships`, `email_verifications`, `auth_sessions`, `org_invites`** — `org_id` backfilled across all then-existing tables |
| `0008_tokens_meta` | `tokens.label`, `tokens.last4` |
| `0009_quotas` | `org_quotas`, `usage_counters` |

### Phase 18 (0010–0013) Org account structure

| File | Tables |
|---|---|
| `0010_phase18_orgs` | **`teams`, `team_memberships`, `project_teams`, `audit_logs`, `org_ownership_transfers`** |
| `0011_invite_team` | `org_invites.team_id` |
| `0012_viewer_role` | role enum: owner/admin/member/**viewer**; team: lead/member/**viewer** |
| `0013_audit_tombstone` | audit_logs FK to soft-deletable target |

### Phase 19–61 (0014–0061) Feature buildout

| Table | Migration | Purpose |
|---|---|---|
| `dsyms` | 0014 | iOS dSYM blob |
| `proguard_mappings` | 0015 | Android deobf |
| `saved_views` | 0018 | dashboard filters |
| `issue_comments` | 0019 | per-issue threads |
| `sessions` | 0021 | crash-free session pings (≠ auth_sessions) |
| `alert_rules` | 0022 | error rate rules + snooze |
| `digest_subscriptions` | 0023 | email digest scheduling |
| `webhook_deliveries` | 0025 | outbound webhook log |
| `spans` | 0026 | distributed tracing (partitioned by `received_at`) |
| `traces` | 0027 | per-trace materialized summary |
| `event_attachments` | 0032 | replay / screenshot blob |
| `integrations`, `issue_integration_links` | 0033 | external service connections |
| `user_reports` | 0036 | end-user feedback |
| `metrics` | 0037 | custom timeseries |
| `cert_watch_domains`, `cert_observations` | 0038 | SSL cert expiry tracking |
| `pii_findings`, `pii_scan_cursor` | 0041 | privacy scan |
| `culprit_commits` | 0042 | bug-fix commit refs |
| `password_resets` | 0044 | password reset flow |
| `track_events` | 0046 | analytics |
| `security_events` | 0047 | trust score inputs |
| `user_federation_links` | 0048 | SSO subject linkage |
| `activity_log` | 0049 | issue mutation history |
| `watchers`, `notifications` | 0052 | inbox |
| `notification_preferences` | 0056 | digest opt-in |
| `notifications_email_log` | 0058 | email delivery log |
| `issue_user_mutes` | 0060 | per-user issue mute |
| `org_labels` | 0061 | org-wide label catalog |

### Phase 65+ (0062–0082) Advanced

| Table | Migration | Purpose |
|---|---|---|
| `integration_templates` | 0063 | cross-org integration sharing |
| `identity_scopes` | 0065 | custom user fingerprinting rules |
| `identity_fingerprints` | 0066 | per-event identity hash |
| `identity_merges` | 0073 | GDPR alias→primary mapping |
| `runtime_metrics_raw / _1m / _1h / _1d` | 0068 | auto-instrumented perf rollups |
| `endpoint_checks / probes / probe_rollup` | 0070–0072 | HTTP health monitoring |
| `device_tokens` | 0075 | push device handles |
| `push_credentials` | 0076 | provider secrets (p8 / SA / VAPID) |
| `push_sends` | 0077 | outbound push log |
| `push_delivery_logs` | 0078 | per-send delivery status |
| `device_topics` | 0081 | per-device topic subscription |
| `push_preferences` | 0082 | per-user push category opt-in |

## §2 API endpoint full inventory

### 2.1 SDK ingest endpoints (28) — **HARD CONTRACT**

Auth: `Authorization: Bearer st_pk_<26 base32>` on every call.

| Endpoint | Method | Purpose |
|---|---|---|
| `/v1/events` | POST | Single error event ingest |
| `/v1/events:batch` | POST | Batched events (≤100) |
| `/v1/events/{event_id}/attachments/{kind}` | POST | Upload replay / screenshot / trail |
| `/v1/sessions` | POST | Crash-free-rate session close |
| `/v1/spans` | POST | Single trace span |
| `/v1/spans:batch` | POST | Batched spans (≤100) |
| `/v1/deploys` | POST | Release deployment marker |
| `/v1/heartbeat` | POST | Keep-alive ping |
| `/v1/user-reports` | POST | End-user feedback |
| `/v1/metrics:batch` | POST | Custom timeseries (≤500) |
| `/v1/runtime-metrics:batch` | POST | Auto-instrumented perf |
| `/v1/track:batch` | POST | Analytics events (≤500) |
| `/v1/security:report` | POST | Trust score inputs |
| `/v1/security/link` | POST | Federated identity upsert |
| `/v1/security/score` | GET | Query current trust score |
| `/v1/control/poll` | GET | SDK live-mode flag discovery |
| `/v1/push/tokens` | POST | Register device |
| `/v1/push/tokens/{handle}` | DELETE | Revoke device token |
| `/v1/push/tokens/{handle}/topics` | POST | Subscribe device to topic |
| `/v1/push/tokens/{handle}/topics/{topic}` | DELETE | Unsubscribe |
| `/v1/push/send` | POST | Send push |
| `/v1/push/receipts/{send_id}` | GET | Poll receipt |
| `/v1/push/sends/{send_id}/ack` | POST | Mark user-confirmed |
| `/v1/push/expo-compat/send` | POST | Expo SDK adapter |
| `/v1/push/expo-compat/receipts/{send_id}` | GET | Expo adapter receipt |
| `/v1/push/users/{fp_hex}/preferences` | GET | Fetch push category prefs |
| `/v1/push/users/{fp_hex}/preferences/{category}` | PUT | Update push category opt-in |
| `/v1/events/_recent` | GET | Live tick SSE feed |

### 2.2 Admin endpoints (~95) — `/admin/api/*`, cookie session

Categories (rough counts):
- Org / project / team management — 13
- Project detail + issue views — 28
- Token & credential management — 7
- Integration & automation — 10
- Push notification management — 13
- Notification & alert — 8
- Endpoint health monitoring — 5
- Search & audit — 2
- Super-admin only — 3

### 2.3 Auth endpoints (~13)

`/register`, `/login`, `/logout`, `/verify`, `/forgot-password`, `/reset-password`, `/change-password`, `/me`, `/oauth/providers`, `/oauth/{provider}/start`, `/oauth/{provider}/callback`, `/invites/{token}/accept`, `/users/me/activity`.

## §3 SDK actual calls — union(must-not-break set)

All 28 endpoints in §2.1 are confirmed called by SDK packages
(`fetch(\`${ingestUrl}/v1/...\`)` + `Authorization: Bearer ${token}`).

**Token format contract (永久):** `st_pk_<26 base32>` (132 bits). Stored as SHA-256
hash in `tokens.token_hash`. Per-project scope.

## §4 Module ↔ v0.1 crate mapping(改造路径)

| Legacy module | Purpose | v0.1 crate | Status |
|---|---|---|---|
| `events.rs`, `events_batch.rs` | error event ingest | `event-pipeline` | ⚠️ Partial — schema 不一致 |
| `sessions.rs` | session pings | — | ❌ New port |
| `spans.rs`, `traces.rs` | tracing + trace list | `span-store` | ⚠️ Partial |
| `issues.rs` | issue grouping + lifecycle | `issue-store` | ✅ Likely usable |
| `releases.rs` | release tracking + artifacts | — | ❌ New port |
| `metrics.rs`, `runtime_metrics.rs` | custom + perf timeseries | `runtime-metrics` | ⚠️ Partial |
| `track.rs` | analytics events | — | ❌ New port |
| `security.rs` | trust score + federation | — | ❌ New port |
| `push.rs` | push notification platform | `push-provider` | ⚠️ Partial |
| `integrations.rs` | external service adapters | `integration-traits` | ⚠️ Partial |
| `alert_rules.rs` | error rate rules | `alert-rule` | ⚠️ Partial |
| `admin_auth.rs`, `user_auth/` | session + RBAC + OAuth | `auth-session` + `workspace-identity` + `tenant-scoping` | ⚠️ Partial |
| `teams.rs` | team management | — | ❌ New port |
| `cert_monitor.rs`(若存在)| SSL cert tracking | `cert-monitor` | ⚠️ Partial |
| `replay_sessions.rs`(若存在)| replay storage | `replay-store` | ⚠️ Partial |
| `audit.rs` | audit log | `audit-event` | ⚠️ Partial |
| `saved_views.rs` | dashboard filters | `saved-view` | ⚠️ Partial |
| `notifier.rs`(若存在)| email / webhook delivery | `notifier` | ⚠️ Partial |
| `billing.rs`(若存在)| quotas + Stripe | `billing` | ⚠️ Partial |

**改造工艺**:
- ⚠️ Partial 6+ — crate 骨架保留,SQL/schema 假设改造适配 legacy table 名 + 字段
- ❌ New port — 从 legacy module 抽业务到新 crate(sessions / releases / track / security / teams)
- ✅ Likely usable — 业务模型对齐,只需 schema 假设调整

## §5 v0.2 简化映射建议

### 5.1 `orgs` → `workspaces`(rename only)

- 物理表名 `orgs` **不动**(零 SQL 风险)
- v0.2 API response 用 `workspace` 命名(`{ workspace: {...} }`)
- 应用层 alias:`WorkspaceId(uuid) = OrgId(uuid)`
- v0.1 已写的 `workspaces` 概念 = `orgs` table 的 application-level rename

### 5.2 `teams + team_memberships + project_teams` — defer

- 物理表 **保留**(legacy 已有数据 + 4 档 RBAC 内 team-level 行为)
- v0.2 API 默认 **不 expose**(saasadmin 才看到 team CRUD)
- 业务上退化为"分组标签",权限走 org-level
- v0.3+ 若客户提需求,API 重启动 teams 视图

### 5.3 `memberships.role` — 4 档 → 3 档 API,内部保 4 档

- 物理 enum 保留 owner/admin/member/viewer(数据保留)
- v0.2 API 暴露 3 档(owner/admin/user),内部映射:
  - `viewer` → `user`(read-only 子能力通过 ACL 实现,UI 层标"read-only")
  - `member` → `user`
- API simplify 不丢业务能力

### 5.4 SDK-exposed vs dashboard-only 分类

**Freeze schema(永久 backwards compatible)**:
- `projects`, `tokens`, `events`, `issues`, `sessions`, `spans`, `traces`, `releases`, `device_tokens`, `push_sends`, `push_credentials`, `push_delivery_logs`, `event_attachments`, `dsyms`, `proguard_mappings`, `release_artifacts`, `metrics`, `runtime_metrics_*`, `track_events`, `security_events`, `user_federation_links`, `user_reports`

**Eligible to refactor / simplify**:
- `alert_rules`, `saved_views`, `watchers`, `notifications`, `notification_*`, `integrations`, `audit_logs`, `activity_log`, `issue_comments`, `endpoint_checks`, `cert_*`, `pii_*`, `org_labels`, `org_quotas`, `usage_counters`, `digest_subscriptions`, `webhook_deliveries`

### 5.5 SDK endpoint(永久不变)vs admin endpoint(可重写)

- 28 个 `/v1/*` + `st_pk_` token format = ≥5 年 compatibility commitment
- `/admin/api/*` + `/auth/*` 可重写 / 改路径(legacy web/ 是 GOLIA 内部 dashboard,可同步发新版)

### 5.6 Token format wire-compat

```rust
// pseudo
fn validate_token(token: &str) -> Result<(ProjectId, OrgId)> {
    if let Some(rest) = token.strip_prefix("st_pk_") {
        // legacy 26 base32 chars — sha256 hash lookup in tokens table
        let hash = sha256(token.as_bytes());
        lookup_by_hash(hash)
    } else {
        Err("invalid token prefix")
    }
}
```

Future `st_pk_v2_...` prefix 留 future,但不在 v0.2 引入(增加复杂度,无必要)。

## §6 Key facts for v0.2 design

### Multi-tenancy
- **Row-level via `org_id`** — 50+ 表,migration 0007 起
- **NOT schema-per-tenant** — 单 PostgreSQL DB
- v0.1 single-db pivot ≡ legacy 既有形态,概念已对齐(只是 v0.1 用 `workspace_id` 命名)

### Token
- `st_pk_<26 base32>`(132 bits 熵)
- SHA-256 hash 存 `tokens.token_hash`
- Per-project scope
- Soft-delete via `tokens.revoked_at`

### Production maturity
- 最高 migration:`0082_push_preferences`
- 推断 ship version:**v1.1+**(feature 密度 + 82 migration 累计)
- Migrations append-only,无 downgrade

### Schema footprint
- 68 tables / ~360 cols
- 2 partitioned(events / spans,monthly by `received_at`)
- ~120 indexes
- 最大 volume:events 表(自动 partition 月度滚动)

### Legacy 约束
- **No universal backfill** — 新表/新列上线后不 backfill 老数据(例:`activity_log` 0049 只记录之后的 mutation)
- 业务层维护的 denorm 列:`issues.search_vector`, `issues.last_*`
- payload JSONB 无 GIN index — 复杂 query 全扫描

### Perf
- Events partitioning 让旧 month 一键 DROP
- `traces` 表 unpartitioned,百万级后 GROUP query 变贵
- payload JSONB 复杂 query → 全扫描

## §7 v0.2 binary 拓扑(我自拍)

| Binary | 用途 | 部署 |
|---|---|---|
| `sentori-server` | 主程,接 SDK + dashboard(自带 saasadmin 隐藏入口) | SaaS sentori.golia.jp + self-hosted docker |
| `sentori-saas-control` | 跨租户 management binary(saasadmin / Stripe webhook / 跨 org aggregation)| SaaS only |
| `sentori-cli` | release sourcemap upload / admin script | dev workstation + CI |

`sentori-server` 单 binary 既能 SaaS-mode 也能 self-hosted-mode(env-flag 切),保证**同版本号 同 SDK**约束自动达成。

## §8 Phase B 起手 cargo workspace 结构(我自拍)

```
core/
  Cargo.toml                # workspace 根
  crates/
    event-pipeline/         # legacy events ingest 改造
    issue-store/            # legacy issues
    span-store/             # legacy spans + traces
    session-store/          # legacy sessions (new port)
    release-store/          # legacy releases + artifacts (new port)
    runtime-metrics/        # legacy metrics + runtime_metrics
    analytics-store/        # legacy track (new port)
    security-engine/        # legacy security + federation (new port)
    push-provider/          # legacy push platform
    integration-registry/   # legacy integrations
    alert-rule/             # legacy alerts
    audit-event/            # legacy audit_logs
    saved-view/             # legacy saved_views
    notifier/               # legacy email/webhook
    billing/                # legacy quotas + Stripe wiring
    cert-monitor/           # legacy cert tracking
    replay-store/           # legacy event_attachments(replay)
    workspace-identity/     # legacy users + orgs + memberships + teams
    auth-session/           # legacy auth + OAuth + reset-flow
    tenant-scoping/         # ACL gate
    attachment-store/       # blob storage abstraction
    privacy-scrubber/       # PII scrub (legacy 0041)
  migrations/               # legacy server/migrations 演进 (ALTER 不 DROP)

sentori-server/             # 主 binary(SaaS + self-hosted 共用)
sentori-saas-control/       # SaaS-only 控制面 binary
sentori-cli/                # CLI(release upload 等)
webapp/                     # dashboard SPA(legacy web/ feature 集 + v0.1 webapp 视觉)
sdk/                        # SDK 不动
docs-v0.2/                  # v0.2 docs

server/                     # legacy(prod 跑的,dual-run 期保留,cutover 后删)
web/                        # legacy webapp(同上)
saas/                       # v0.1 写的 saas/server 占位,改造或删
self-hosted/                # v0.1 写的(改造或并入 sentori-server)
```

## §9 Phase B 第一动作清单

1. 在 `core/` 创建 cargo workspace skeleton(`Cargo.toml` 含全部 22 crate stub)
2. 从 v0.1 `core/crates/` 迁过来 17 crate(改 schema 假设 → legacy table 名 + 列)
3. 新建 5 crate stub:`session-store / release-store / analytics-store / security-engine / privacy-scrubber`
4. `core/migrations/` 从 legacy `server/migrations/` 复制 + 加 v0.2 alias view ALTER
5. 验证 `cargo check -p <crate>` 每个 crate 单独编译
6. 删 v0.1 `self-hosted/` `saas/` 目录(它们假设 fresh-start schema,跟 legacy 不兼容);保留 v0.1 `webapp/` 改造

Phase B 估时:**3-4 weeks**(每天 1-2 crate 改造)。

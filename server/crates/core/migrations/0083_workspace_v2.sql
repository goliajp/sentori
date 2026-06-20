-- v0.1 — Identity model 重整 (Phase A.1 Stage B-3 per
-- .claude/state/product-architecture.html §08 + sprint-0/S15)
--
-- 源状态: orgs + teams + memberships (4 role) + identity_scopes + 等。
-- 目标状态: workspace_members (3 role) + project_user_visibility + privacy_salts。
--
-- BREAKING — 跑后老代码 (api/orgs, api/teams) 不能跑 (但这些已在 B-3b 删)。
-- 全部操作在单 transaction 内 atomic — 失败 ROLLBACK 不留半截。
--
-- selfhosted / enterprise binary 跑这个 migration。
-- saas binary 跑这个 + 自家 saas/migrations/0001_tenants.sql + saas-specific
-- (orgs RENAME tenants + 保留 quotas 到 saas crate, see crates/saas/migrations/).

BEGIN;

-- ── Step 1: workspace_members 创建 (从 memberships 折叠 4 → 3 role) ──
CREATE TABLE IF NOT EXISTS workspace_members (
    user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL CHECK (role IN ('owner','admin','user')),
    added_by    UUID REFERENCES users(id) ON DELETE SET NULL,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- DB-level 强制每 workspace 恰好 1 owner (selfhosted: 一个 workspace = 整 instance)
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_one_owner
    ON workspace_members ((1)) WHERE role = 'owner';

-- 数据折叠: memberships (org × user × 4 role) → workspace_members (user × 3 role)
-- 一个 user 跨多 org 不同 role 时, 取最高 (owner > admin > member/viewer)
-- selfhosted/enterprise 实际只有 1 org (dev system org), 一对一映射
INSERT INTO workspace_members (user_id, role, added_by, added_at)
SELECT DISTINCT ON (user_id) user_id,
       CASE
         WHEN role IN ('owner','admin') THEN role
         ELSE 'user'  -- member + viewer 都折叠成 user
       END,
       NULL,
       created_at
FROM memberships
ORDER BY user_id,
         CASE role
           WHEN 'owner' THEN 1
           WHEN 'admin' THEN 2
           WHEN 'member' THEN 3
           WHEN 'viewer' THEN 4
         END
ON CONFLICT (user_id) DO NOTHING;

-- ── Step 2: project_user_visibility (给 'user' role 显式 grant) ──
CREATE TABLE IF NOT EXISTS project_user_visibility (
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, user_id)
);

-- 数据迁移: 老 team_memberships → project_user_visibility
-- (通过 team 看到 project 的 user 关系拆成 (project, user) 直接 grant)
-- 注: owner/admin 自动可见所有 project, 不写 visibility 表
INSERT INTO project_user_visibility (project_id, user_id, granted_at)
SELECT DISTINCT pt.project_id, tm.user_id, NOW()
FROM project_teams pt
JOIN team_memberships tm ON tm.team_id = pt.team_id
JOIN memberships m ON m.user_id = tm.user_id
WHERE m.role NOT IN ('owner', 'admin')
ON CONFLICT (project_id, user_id) DO NOTHING;

-- ── Step 3: workspace_invites (从 org_invites 折叠) ──
CREATE TABLE IF NOT EXISTS workspace_invites (
    id            UUID PRIMARY KEY,
    email         TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('admin','user')),
    invited_by    UUID NOT NULL REFERENCES users(id),
    token_hash    TEXT NOT NULL UNIQUE,
    expires_at    TIMESTAMPTZ NOT NULL,
    accepted_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO workspace_invites (id, email, role, invited_by, token_hash, expires_at, accepted_at, created_at)
SELECT id, email,
       CASE WHEN role = 'admin' THEN 'admin' ELSE 'user' END,
       invited_by, token_hash, expires_at, accepted_at, created_at
FROM org_invites
ON CONFLICT (id) DO NOTHING;

-- ── Step 4: privacy_salts (rename identity_scopes + project-level NOT NULL) ──
ALTER TABLE IF EXISTS identity_scopes RENAME TO privacy_salts;

-- 给 projects 加 privacy_salt_id (project-level 必填)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS privacy_salt_id UUID
    REFERENCES privacy_salts(id) ON DELETE RESTRICT;

-- backfill: 当前 project 用 identity_scope_id (override) 或 org's default scope
UPDATE projects p
SET privacy_salt_id = COALESCE(
    p.identity_scope_id,
    (SELECT scope_id FROM org_identity_scopes ois
      WHERE ois.org_id = p.org_id AND ois.is_default = true)
)
WHERE p.privacy_salt_id IS NULL;

-- 删 org-level scope mapping (不再用)
DROP TABLE IF EXISTS org_identity_scopes;
ALTER TABLE projects DROP COLUMN IF EXISTS identity_scope_id;

-- ── Step 5: app_user_identities (rename user_federation_links 命名清晰化) ──
ALTER TABLE IF EXISTS user_federation_links RENAME TO app_user_identities;

-- ── Step 6: audit_logs 改 project-scoped (删 org_id) ──
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE SET NULL;
UPDATE audit_logs SET project_id = (payload->>'project_id')::UUID
    WHERE payload->>'project_id' IS NOT NULL AND project_id IS NULL;
ALTER TABLE audit_logs DROP COLUMN IF EXISTS org_id;
DROP INDEX IF EXISTS audit_logs_org_created_idx;
CREATE INDEX IF NOT EXISTS audit_logs_project_created_idx
    ON audit_logs (project_id, created_at DESC);

-- ── Step 7: 删 teams / team_memberships / project_teams (per §08 砍 team) ──
DROP TABLE IF EXISTS project_teams;
DROP TABLE IF EXISTS team_memberships;
DROP TABLE IF EXISTS teams;

-- ── Step 8: 删 org_ownership_transfers (per §08.5 单边 transfer) ──
DROP TABLE IF EXISTS org_ownership_transfers;

-- ── Step 9: 其它表去 org_id (per S0 schema inventory) ──
ALTER TABLE IF EXISTS saved_views DROP COLUMN IF EXISTS org_id;
ALTER TABLE IF EXISTS alert_rules DROP COLUMN IF EXISTS org_id;
ALTER TABLE IF EXISTS digest_subscriptions DROP COLUMN IF EXISTS org_id;
ALTER TABLE IF EXISTS integrations DROP COLUMN IF EXISTS org_id;
ALTER TABLE IF EXISTS org_labels DROP COLUMN IF EXISTS org_id;
ALTER TABLE IF EXISTS org_labels RENAME TO project_labels;
DROP INDEX IF EXISTS alert_rules_org_idx;
DROP INDEX IF EXISTS org_labels_org_idx;

-- ── Step 10: 删 memberships / org_invites ──
DROP TABLE IF EXISTS org_invites;
DROP TABLE IF EXISTS memberships;

-- ── Step 11: 删 quotas / quota_usage (selfhosted/enterprise 无 quota; saas 自己加) ──
DROP TABLE IF EXISTS quotas;
DROP TABLE IF EXISTS quota_usage;

-- ── Step 12: 删 orgs (selfhosted/enterprise) ──
-- 注: saas crate 走自家 migration 把 orgs RENAME tenants, 不在 core 这里 DROP
-- 但 core 是统一 migration source, selfhosted apply 这个会 DROP。
-- saas binary 启动时 apply core migrations 再 apply saas/migrations 顺序很重要 —
-- saas/migrations/0001_tenants.sql 必须在 core 0083 之前 apply, 或 saas 重新创建 tenants
-- 这是 saas crate (B-3d) 设计点, 不在 core 这里 cover。
DROP TABLE IF EXISTS orgs;

-- ── Step 13: users.is_superadmin 删 (selfhosted/enterprise 无;saas 自己 saasadmin_users) ──
ALTER TABLE users DROP COLUMN IF EXISTS is_superadmin;
DROP INDEX IF EXISTS users_is_superadmin_idx;

COMMIT;

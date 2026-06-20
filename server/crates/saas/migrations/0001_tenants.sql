-- Phase A.1 Stage B-2 — saas crate first migration.
-- Per .claude/state/product-architecture.html §08.4 + sprint-0/S15-identity-migration.md.
--
-- 这个 migration 跑在 saas binary 的 public schema (跟 tenant-specific schema
-- 隔开 — per α schema-per-tenant 方案)。 每个 tenant 在自己的 schema 内有
-- 独立 workspace_members + projects + 全套 core 表。
--
-- 本 file 仅创建 tenants 顶层表 + saasadmin_users。 后续 saas migrations:
--   0002_subscriptions.sql      — subscriptions + stripe_events + invoices
--                                  (per §05.3.3 schema)
--   0003_quotas.sql              — quotas + usage_records (移自 core)
--   0004_revoked_licenses.sql   — license JWT revoke 黑名单
--
-- Stage B-3 起真接 Stripe + saasadmin UI 时, 这些 migration 才需要 apply 到
-- saas-prod。 selfhosted / enterprise binary 永远不 apply saas migrations
-- (per D2/D8)。

CREATE TABLE IF NOT EXISTS tenants (
    id          UUID PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    schema_name TEXT NOT NULL UNIQUE,   -- α schema-per-tenant: 物理 schema 名
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenants_slug_idx ON tenants (slug);

-- saasadmin_users — 跨 tenant 全局权限, 跟 sentori user
-- (workspace_members.role='owner') 解耦的 RBAC 边界。
-- selfhosted/enterprise 永远没有 saasadmin 概念 (users.is_superadmin 列
-- 在 selfhosted/enterprise migration 里被 DROP)。
CREATE TABLE IF NOT EXISTS saasadmin_users (
    user_id     UUID NOT NULL,        -- 引用 public.users (跨 schema-but-same-db 引用)
    granted_by  TEXT,                  -- 例: "founder bootstrap" 或 "promoted by <user>"
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id)
);

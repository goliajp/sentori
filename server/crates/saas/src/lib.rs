// Phase A.1 Stage B-2 — sentori-saas crate skeleton.
//
// saas-only multi-tenant 层 (per .claude/state/product-architecture.html §06):
//   - tenants 表 + scoping middleware (per §07 方案 α schema-per-tenant, S2 PoC)
//   - saasadmin 视角 (跨 tenant 看板, 跟 web/src/saas/ 配)
//   - Stripe 接入 (per §05.3 + S5 PoC) — Checkout / Customer Portal / webhook
//   - 内部 subscriptions / invoices / stripe_events 镜像表
//   - license JWT 签发 + revoke (per §05.2 + S4 PoC, signer 在 saas, verifier 在 core)
//
// 跟 sentori-core 解耦 — core 完全不知道 tenant 概念。 saas 在 core 之上
// 包一层 middleware + 提供 router merger。
//
// 真实 module impl 在 Stage B-3 起 (per execution plan)。 本 lib.rs 现在
// 仅 skeleton 占位让 cargo build / workspace member 跑通。

#![allow(dead_code)]

/// Placeholder — Stage B-3 替换为 tenants_module / billing_module 等。
pub fn _stage_b2_placeholder() {}

// Stage B-3 module 框架预留 (注释, 不 expose):
// pub mod tenants;          // src/tenants/mod.rs — CRUD + scoping middleware
// pub mod saasadmin;        // src/saasadmin/mod.rs — 跨 tenant API + 视角
// pub mod stripe;           // src/stripe/mod.rs — Checkout/Portal/webhook
// pub mod billing;          // src/billing/mod.rs — subscriptions + license signer
// pub mod license_signer;   // src/license_signer.rs — JWT 签发 (verifier 在 core)

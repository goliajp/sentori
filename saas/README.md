# Sentori v0.1 — `saas/`

GOLIA 内部运营的 sentori SaaS 多 tenant 实现。 完整 cargo workspace + web + migrations + docker + helm。

按 [cement-stone methodology](../.claude/state/refactor-standards.md), 这里全部是 **水泥** — 具体业务流实现, composed from `core/` 内的 石头 + 钢筋。

## Layout

- `server/` — axum binary entrypoint + handler 业务流
- `web/` — saasadmin + tenant 视角 React UI (复用 `webapp/` shared components)
- `migrations/` — saas-specific schema (tenants + subscriptions + stripe_events + saasadmin_users), per `.claude/state/sprint-0/S15` + `S5` 设计
- `docker/` — Stripe-mode docker-compose 内部 deploy
- `helm/` — 内部 Helm chart
- `tests/e2e/` — full signup → trial → upgrade → cancel scenarios

## Status

`[ ]` Phase 3 水泥 ship (per `.claude/state/v0.1-execution-plan.md` §B Phase 3) — 等 Phase 1 + 2 ship 后启动。

## Acceptance

- 业务 e2e test 覆盖关键 flow
- 性能 / mem / disk 跟 ceiling-first 标准 (per `refactor-standards.md` §2)
- UX 标准: 响应延迟 < 100ms 给视觉反馈, 错误信息 actionable, A11y WCAG 2.1 AA, 双 mode, mobile-responsive

## 0 dependency on `legacy server/`

legacy `server/` 是 read-only ref, saas/ 不 import 它的任何东西。 read 它理解业务逻辑, fresh 实现。

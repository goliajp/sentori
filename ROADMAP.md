# Sentori Roadmap

> 一个 RN-first、Sentry 替代、完全自研协议的 APM。
> 后端：Rust + axum + PostgreSQL 18+ + Valkey。前端：`web/`（React 19 + Vite + Tailwind v4，全 SPA）。

## 当前状态

- **v0.1** ✅ self-hosted MVP（Phase 0-10）—— 详见 [CHANGELOG.md](./CHANGELOG.md)
- **v0.1.x** ✅ SaaS 上线 + dogfood（Phase 11-17）—— 详见 CHANGELOG.md
- **v0.2** ✅ 账户结构 + SDK 矩阵 + 数据呈现（Phase 18-28）—— 详见 CHANGELOG.md
- **v0.3** ✅ React-first via dogfood（Phase 29-33，25/27 sub done）—— 详见 CHANGELOG.md；Phase 30 sub-A/B 待 Insight dogfood 数据，见下方 "v0.3 收尾"
- **v0.4** ✅ Distributed Tracing（Phase 34-38，全部完成；5 npm SDK publish + tag v0.4.0）—— 详见 [CHANGELOG.md](./CHANGELOG.md#v04--distributed-tracingphase-34-38)
- **v0.4.x** ✅ patch：v0.4.1 XHR instrumentation / v0.4.2 client span flush + self-trace 防套娃 —— 详见 CHANGELOG
- **v0.5** 🚧 Scale + Readable Errors + Dashboard refresh（Phase 39 ✅ trace 上量管控；Phase 40 可读错误 / Phase 41 dashboard sidebar 待做；见下方 "v0.5 ROADMAP"）

公开 surface：`sentori.golia.jp`（marketing） / `app.sentori.golia.jp`（dashboard） / `api.sentori.golia.jp` / `ingest.sentori.golia.jp` / `docs.sentori.golia.jp`。

---

## 部署形态：双轨

**轨 A — Self-Hosted（Phase 0–10）：** 一行 `docker compose up`，企业内网或单 VM 即可跑通。任何想自己掌控数据的团队的兜底。
**轨 B — SaaS（Phase 11–16）：** `sentori.golia.jp` 公开服务，零运维上手；和轨 A **共用同一个二进制 + 同一份 schema**，靠环境变量开多租户开关。

不维护两个分支。SaaS = self-hosted + 多租户表 + 注册流程 + 配额计量 + 域名分流。

---

## Subdomain 拓扑（sentori.golia.jp）

| Subdomain | 段数 | 用途 | 渲染 | 后端 | CF 模式 |
|---|---|---|---|---|---|
| `sentori.golia.jp` | 3 | Marketing 主站 | 静态（Astro） | Cloudflare Pages | orange（proxy） |
| `app.sentori.golia.jp` | 4 | Dashboard SPA | 静态（web/dist） | origin VM Caddy（静态托管 + 反代 api） | grey（DNS-only） |
| `ingest.sentori.golia.jp` | 4 | SDK 上报端点 | 动态 | origin VM Caddy 反代 → sentori-server | grey |
| `api.sentori.golia.jp` | 4 | Admin API | 动态 | origin VM Caddy 反代 → sentori-server | grey |
| `docs.sentori.golia.jp` | 4 | 文档站 | 静态（Starlight build 出物） | origin VM Caddy 静态托管 | grey |
| `cdn.sentori.golia.jp` | 4 | SDK install script / CLI 二进制 | 静态 | origin VM Caddy 静态托管 | grey |
| `status.sentori.golia.jp` | 4 | 状态页 | 第三方 | Better Stack（CNAME） | grey |

**TLS 路径（已校准）：**

- **3 段** `sentori.golia.jp`：Cloudflare Universal SSL（免费，自动覆盖 `*.golia.jp`），orange cloud + CF Pages
- **4 段子域**：grey cloud（DNS-only，不挂 CF proxy）+ origin VM 上的 Caddy 自动 ACME（Let's Encrypt HTTP-01 / DNS-01），每个 subdomain 各一张独立证书

为什么 4 段不走 CF Pages：Cloudflare Pages 的 custom domain 必须 orange cloud；orange cloud 下 4 段子域**不被 Universal SSL 覆盖**，需要付费 Advanced Cert（$20/月+）才能签。grey + origin Caddy 是零成本路径。

**DNS 管理：通过 devops 项目（不直调 Cloudflare API）**

DNS 由 `~/workspace/goliajp/devops/` 项目里的 `crates/devops-core/src/dns/` 管理，唯一入口是 `zones.yaml`（`golia.jp` zone 下加 records）。`local_to_cf_name`（`cloudflare.rs:77`）对 record `name` 层级深度无限制，写 `name: app.sentori` 直接产出 `app.sentori.golia.jp`。每次同步前必须先 `devops dns diff` review（删除必须显式确认）。

---

## DSN-equivalent 设计（不复用 Sentry DSN）

Sentori **不**用 Sentry 的 `https://<key>@host/<project>` URL 编码方案。SDK 配置永远是两个独立字段：

```typescript
sentori.init({
  token: 'st_pk_01j5y9z3vk8x',                    // 必填，项目 token
  release: '1.2.3+456',                            // 必填
  env: 'prod',                                     // 选填，默认从 __DEV__ 推断
  ingestUrl: 'https://ingest.sentori.golia.jp',    // 选填，默认即此
});
```

Self-hosted 用户改 `ingestUrl` 即可指向自己的 host；token 不变。

理由：

1. URL 编码 token 容易随 URL 泄漏到日志（很多日志框架全文记录 URL）
2. token 轮换不应连带改 URL
3. `.env` 两变量（`SENTORI_TOKEN` + `SENTORI_INGEST_URL`）比拆 DSN 字符串友好

文档术语：宣传材料一律用 "token + ingest URL"，**不用 "DSN"**（避免 Sentry 烙印混淆）。

---

## 跨 Phase 横切关注

整条链都要持续维护：

- **CI 健康**：每个 sub 收尾前 `bun run check / test / build` + `cargo test` 全绿
- **commit 节奏**：每 sub 至少一 commit；checkbox 跨多 commit 时维持 ROADMAP 的进度同步
- **依赖 audit**：`bun audit` + `cargo audit` 进 CI
- **协议契约稳定**：`docs/protocol.md` 改动必须同步改 server `event.rs` 和 sdk `types.ts`，否则 PR 不合格
- **设计语言纪律**：dashboard / marketing 任何 UI 改动以 Linear / Vercel / Modal 为参考，违反则在 PR 描述里说明理由
- **部署纪律**：main commit 自动 build → staging；prod 部署手动 trigger 从 staging 镜像 promote；DB migration 必须可逆，先在 staging 跑过 ≥ 24h
- **生产纪律**：监控告警 7×24（单人 on-call）；每月 backup restore 演练 1 次；每季度 dependency audit + security review
- **性能回归**：任何 `docs/performance.md` 的 headline 数字退化 > 20%，或 EXPLAIN plan shape 变（新 Seq Scan / Sort / Hash Join / 分区裁剪丢失） → PR 描述解释 / 跟进 commit 修回去 / 显式更新 baseline 三选一

---

# v0.3 收尾（已解封 — Insight 自 2026-05 起在用 Sentori）

Phase 30 sub-A/B 当时 user-blocked，等 Insight dogfood。现在 Insight 已接 `sentori-react-native@0.5.2` 并产出真实 trace/error 数据 → 解封。这两个 sub 的内容（onboarding 秒表、摩擦点修复，候选 top-1/2 是 "sourcemap upload 发现性差" + "token 401 信息不清"）与 v0.5 Phase 40（可读错误）高度重叠 —— 直接吸收进 Phase 40 的 dogfood 步骤，不再单列。下面的原始 checklist 保留作素材参考。

## Phase 30 sub-A — Insight 接入流程秒表

- [ ] 在 Insight 项目里 `bun remove` 老版本 + `bun add @goliapkg/sentori-react-native@latest`，秒表掐 install → config → 第一个事件落 dashboard 总耗时
- [ ] 新文档 `docs/dogfood/insight-friction.md`：列每一步耗时 / 卡顿点 / 文档查找次数 / 错误信息看不懂的瞬间
- [ ] 输出 top-5 摩擦点优先级表（影响范围 × 修复成本）作为 sub-B 输入
- [ ] commit `phase 30 sub-A: insight onboarding stopwatch`

## Phase 30 sub-B — 摩擦点修复（top-5）

- [ ] 修 top-1（候选：sourcemap upload 命令发现性差 → README 顶部一句话 + dashboard onboarding 引导）
- [ ] 修 top-2（候选：token 401 错误信息不清 → server 401 response body 加 `hint` 字段说明 token 不是 `st_pk_` 前缀 / 已 revoke / project 不匹配）
- [ ] 修 top-3（候选：release 字符串约定 `<app>@<version>+<build>` 没文档化 → docs `protocol.md` + getting-started 加专栏）
- [ ] 修 top-4（具体项 sub-A 输出后定）
- [ ] 修 top-5（同上）
- [ ] 每个修一独立 commit `phase 30 sub-B: <friction>` 便于 cherry-pick

---

# v0.4 ROADMAP — Distributed Tracing

**主轴**：把 protocol 早就留好的 `traceId` / `spanId` 槽真正用起来。从 RN 应用一路追踪到后端 API，看 waterfall。**不开新轴**——不上 metrics / logs / profiling / OpenTelemetry SDK 兼容。营销不主动推广，继续 dogfood 驱动（dashboard 自己接入 trace、Insight 团队接入）。

**反 Sentry 过时点**：Sentry tracing 走 envelope-bloated 协议（每个 span 都嵌套 `transactions[]` + 大量重复 meta），dashboard 也是 hover-tooltip 风格。Sentori v0.4 走单 JSON span ingest + 紧凑 waterfall 表格（Linear/Grafana Tempo 风格），延续 v0.1 的 schema 简纪律。

**RN-first 立场**：Tracing 在 mobile + backend 联动比纯 web 更值钱（network round-trip 在 mobile 更大、更不可见）。先做 RN + Node 后端联动，Web/Next.js 跟随。

**总工时**：8-11 周（1 人全职）。**Entry**：v0.3 实质完成（25/27）。

每条 step 独立可执行（动词 + 目标 + 文件 + 验收）。跨 phase 严格线性、不并行。

## Phase 34 — Protocol + storage 准备

**Goal:** Span ingest 路径打通：协议 → server schema → 索引 → ingest endpoint。看不到 UI，但能 `curl` 出 trace 数据。
**Entry:** v0.3 ✅. **Exit:** `/v1/spans` 接受单 span / batch span；按月分区存储；EXPLAIN 全部 query sub-ms。
**Estimate:** 2-3 周

### sub-A — Span protocol

- [x] `## Span schema` 章节：14 字段表（id / traceId / parentSpanId / op / name / startedAt / durationMs / status / tags / data / traceparent + types/required/notes）；projectId 从 token 推（不在 body）；`status` enum 含 `cancelled` 给 AbortController 场景；`op` 命名约定子表（http.client/server / db.query/transaction / cache.get/set / react.render/navigation / app.cold-start）
- [x] "What we deliberately don't do" 子节明文反 Sentry/OTel：no transactions[]（root 就是 parentSpanId==null）/ no measurements 浮点矩阵（用 tags+data）/ no transaction.name vs span.description（只有 name）/ no nav 自动跨路由续约
- [x] Endpoints 章节加 `### POST /v1/spans` + `### POST /v1/spans:batch`（200 spans/batch 上限，比 events 100 高因为 span ~200-400B vs event 1-10KB）
- [x] Design principles line 16 重写：从"reserved extension slot"改成 v0.4 实际实施声明
- [x] Event schema 的 `traceId` / `spanId` 字段从 "reserved (v0.1 always null/omitted)" 改成 v0.4+ 实际语义 + 提到 dashboard "In trace →" pill 跳转
- [x] Size limits 表加 5 行 span 相关 limit（单 payload 64KB / batch 200 / data 16KB / op 64 char / name 200 char / durationMs ≤ 24h）
- [x] Batch wrapper 章节拆 "Events batch" + "Spans batch" 子节
- [x] 镜像到 `docs-site/src/content/docs/protocol.md`（保留 5 行 starlight frontmatter）；docs build 23 page 通过
- [x] commit `phase 34 sub-A: span protocol`

### sub-B — Server schema + migration

- [x] migration `0026_spans.sql`：`spans` `PARTITION BY RANGE (received_at)`，PK `(received_at, id)` 复合（partition key 必须在 PK），bootstrap 2026_05..2026_08 + default partition；4 索引 — `trace_id` 走 trace detail / `(parent_span_id) WHERE parent_span_id IS NOT NULL` 走 waterfall build（partial 排掉 root 行节约空间）/ `(project_id, received_at DESC)` 走 trace list / `(project_id, op)` 走 span search
- [x] migration `0027_trace_meta.sql`：`traces` per-trace 物化 summary（`trace_id PK + project_id + root_op + root_name + first_seen + last_seen + span_count + status check 三选一 + duration_ms`）；**不**分区（trace 数是 span 的 ~1/200，10M 行内 PG 单表 OK，留到真实流量 push past 时再分）；keyset 索引 `(project_id, last_seen DESC, trace_id DESC)` 给 trace list 分页
- [x] 应用到 dev DB 验证：6 个 CREATE TABLE + 5 个 CREATE INDEX + traces 表 1 个 CREATE TABLE + 2 indices；`spans / spans_2026_05 / spans_default / traces` 全部存在；cargo test --lib 18/18 仍绿
- [x] commit `phase 34 sub-B: spans + traces schema`

### sub-C — `/v1/spans` ingest endpoint

- [x] `server/src/api/spans.rs`：`handle()` 单 span + `handle_batch()`（≤ 200/batch）；shared `SpanInput` deserialize；`SpanAck { id }` / `SpansBatchResponse { accepted, rejected, errors[] }` 同 events:batch 模式；per-span error 不 fail 整个 batch
- [x] `validate()` 7 项：op 长度 0..=64 / name 长度 0..=200 / status enum / duration_ms 0..=24h / tags ≤ 50 keys 且 value 必须 string / tag key 长度 / data JSON encode ≤ 16 KB
- [x] `persist_span()` 用 tx 跨 spans + traces 两次写：spans INSERT；traces `ON CONFLICT (trace_id) DO UPDATE SET` 维护 `last_seen = GREATEST` / `span_count += 1` / `root_op = COALESCE(EXCLUDED, traces.root_op)`（root 才设）/ `duration_ms = GREATEST` / `status = CASE worst-of (error > cancelled > ok)`
- [x] Quota 共享 `quotas::check_and_record` per-org bucket（DevToken 不查；batch 整体算一次 ingest write，单 span 一次）；`Valkey unset/DB unset` fail-open posture 同 events
- [x] `server/src/router.rs`：`POST /v1/spans` + `POST /v1/spans:batch` 两路由挂在 ingest token group；`server/src/api/mod.rs` 加 `pub mod spans`
- [x] 8 个单测 `mod tests`：accept minimal / reject empty op / 过长 op / unknown status / negative duration / 24h+1 duration / non-string tag value / root null parent。cargo test --lib **26/26 pass**（was 18，+8）
- [x] 真 server smoke 通过：(1) single root → 202 ack (2) child same trace → 202 + DB 看到 parent_span_id 链 (3) batch 3 → `{accepted:3, rejected:0}` (4) trace 状态 worst-of 验真：3 个 batch span 含 1 个 status=error → trace.status 翻成 error (5) 混合 batch bad/good → bad 由 index 报 `validationFailed:invalidOp`，good 仍 accept
- [x] 清理 dev DB 的 6 个 smoke spans + 3 traces
- [x] commit `phase 34 sub-C: spans ingest endpoint`

### sub-D — EXPLAIN baseline

- [x] `tools/seed-spans.ts`：HTTP-path 工具，500 trace × 200 spans batch via `/v1/spans:batch`；10×5 smoke 跑通（510 sp/s，0 rejected）；real-ingest 测试时用此（走完整 quota / validation / trace materialization 链路）
- [x] EXPLAIN baseline 数据准备走 SQL bulk INSERT（HTTP 100k 需 3min，SQL 1s）：3 步 `generate_series` — 500 traces + 500 root spans + 99,500 children（CROSS JOIN generate_series(1, 199)）→ 100,050 spans / 510 traces；遇 2 个 SQL bug：(1) `random()*N+1::int` 在 random≈1 时四舍五入到 N+1 数组越界 → 用 `floor(...)::int + 1` (2) interval 字面值用科学计数法被 PG 拒 → 用 `(floor(random()*1000)::int || ' milliseconds')::interval`
- [x] 3 query EXPLAIN：(Q1 trace list) **0.075ms** Index Scan on `traces_project_last_seen_idx` / (Q2 trace detail 200 spans) **0.68ms** Bitmap Heap Scan via `spans_2026_05_trace_id_idx` / (Q3 span search op+duration top-50) **5.64ms** Bitmap Heap Scan + 16887 candidate rows + in-memory sort — 最慢的一项但仍远低于任何 SLO
- [x] `docs/performance/baseline-v0.4-phase34.md`：每 query 完整 plan + headline 表 + methodology（SQL bulk vs HTTP tool 用途分工）+ 不覆盖项（跨 partition trace / 不均匀分布 / cold start）+ 2 项 action items deferred（Q3 加 `(project_id, op, duration_ms DESC)` 复合索引 / Q2 partition-pruning hint，留到真实流量证明值得才上）
- [x] 清理 dev DB 的 bulk-100k 数据（100k spans + 500 traces）；保留 50 spans / 10 traces 来自 seed-spans 工具 smoke 作工具有效证据
- [x] commit `phase 34 sub-D: span ingest explain baseline`

## Phase 35 — SDK 端：RN + JS + React

**Goal:** SDK 暴露 span API；自动 instrument fetch + react-router navigation；W3C `traceparent` header 注入。
**Entry:** Phase 34 ✅. **Exit:** `sentori.startSpan('op')` 工作；`fetch()` 自动产 `http.client` span；dashboard 自身 dogfood 能看到自家请求 waterfall。
**Estimate:** 2 周

### sub-A — `sdk/core` 加 span buffer

- [x] `sdk/core/src/types.ts` 加 `SpanStatus` enum + `Span` wire-format type，对应 sub-A 协议 schema 11 field（id / traceId / parentSpanId / op / name / startedAt / durationMs / status / tags / data? / traceparent?）
- [x] `sdk/core/src/spans.ts`：`SpanHandle` class — `startSpan(op, opts?)` 返回 mutable handle，`setName / setTag / setData / finish({status?, tags?})`；`finish` 二次调用 no-op；`SpanBuffer` ring buffer cap=1000（同 breadcrumb 模式 + 多一个 `drain()` 方法给 transport flush）；模块级 `_global` 默认 buffer，可传 custom buffer
- [x] `sdk/core/src/trace-context.ts`：`withSpan(span, fn)` + `activeSpan()`；Node 路径 lazy require `node:async_hooks` AsyncLocalStorage（处理 await 后 context 保留）；browser/RN fallback 用 save-and-restore module variable（线性 await OK，并发 promise 分叉会丢——文档明示用户在 fork 时显式传 parent）；feature-detect via `globalThis.process?.versions?.node`
- [x] `startSpan` 优先级：`opts.traceId` > `opts.parent?.traceId` > `activeSpan()?.traceId` > 新 trace（`uuidV7`）；`opts.parent: null` 显式 detach（覆盖 active context）；`opts.parent` 接受任何 `{spanId, traceId}` 形状（SpanHandle / decoded traceparent / 字面量）
- [x] 21 个单测覆盖：root no-parent / 嵌套 parent inherits / `opts.traceId` 覆盖 / `parent: null` 强 detach / `name` 默认 op / setName-setTag-setData / finish 推 buffer / status passthrough / durationMs = end-start / finish 二次 no-op / custom buffer / cap drop 最老 / drain 清空 / activeSpan null 默认 / withSpan 嵌套 + restore / throw 时 restore 不漏。`bun test` 40/40 pass（was 19，+21）
- [x] `sdk/core/src/index.ts` export `Span` / `SpanStatus` / `SpanHandle` / `SpanBuffer` / `SpanContextLike` / `StartSpanOptions` / `startSpan` / `getSpans` / `drainSpans` / `clearSpans` / `activeSpan` / `withSpan` / `__resetTraceContextForTests`
- [x] 全 SDK suite 复跑：sentori-core 40 / javascript 9 / react 14 / next 9 / react-native 22 / expo（无 test）— 全绿，core schema 加 Span 类型不破坏下游
- [x] commit `phase 35 sub-A: core span api`

### sub-B — JS SDK auto-instrument fetch

- [x] `sdk/javascript/src/hooks/fetch.ts`：monkey-patch `globalThis.fetch` 包成 `startSpan('http.client')` + traceparent header 注入；`installFetchInstrumentation()` 幂等；`uninstallFetchInstrumentation()` 还原原始 fetch reference（**不**用 `.bind()`，否则 reference equality 丢，callers 持旧 ref 失败）；`extractMethodAndUrl` 同时处理 string / URL / Request 三种 input；`mergeHeaders` 让 caller 的 headers 同时保留（traceparent 不挤掉 Authorization 等）
- [x] `toTraceparent(traceId, spanId)` 导出 + 单测：strip `-` 转 lowercase，traceId 全 32 hex 保留，spanId 截 16 hex（uuidv7 高位 8 字节是时间戳前缀，区分度足够）；header 输出 `00-<32hex>-<16hex>-01` 标准 W3C
- [x] 状态映射：HTTP < 400 → `ok` / ≥ 400 → `error`（4xx 5xx 都标 error，dashboard trace list 直接看到失败）；fetch 抛 `AbortError` → `cancelled`（user-aborted 不是 failure）；其它 throw → `error` + `error.message` tag
- [x] `init.ts` 在 enableGlobalHooks 路径里 `installFetchInstrumentation()`，跟 browser/node hooks + session 并列；`enableGlobalHooks: false` 全跳过
- [x] 10 个新 test：toTraceparent 字符串 case 2 个 / install 幂等 / uninstall 复 ref / span 含 http.method + url + status / traceparent header 注入 + 形状 / Authorization 等 caller header 不丢 / 503 → status='error' / NetworkError → status='error' + error.message / AbortError → status='cancelled' / URL + Request 输入形状各支持。**bun test 20/20 pass**（was 10，+10）
- [x] 全 SDK 复跑：sentori-core 40 / javascript 20 / react 14 / next 9 / react-native 22 全绿
- [x] commit `phase 35 sub-B: js sdk auto-instrument fetch`

### sub-C — RN SDK auto-instrument fetch + react-navigation

- [x] `sdk/react-native/src/handlers/network.ts` 扩展：原 `addBreadcrumb('net')` 路径保留，加 `startSpan('http.client')` + traceparent header 注入；status 映射 同 sub-B JS SDK（4xx/5xx → error / AbortError → cancelled / 其它 throw → error + error.message tag）；URL scrub 仍跑（token/secret 不进 span tags）
- [x] 新 `sdk/react-native/src/navigation.ts`：`useTraceNavigation(navigationRef)` hook，接受任何 `{ addListener('state', cb), getCurrentRoute() }` 形状（**duck-typed** 不绑死 `@react-navigation/native` 类型，让 peer dep 真正 optional——consumer 不装 react-navigation 也能编译）；初次 mount 不发 span（参考 sentori-react `useSentoriRouter`）；每次 route 变 → 关闭上一 span，开新 `react.navigation` span `name = "<from> → <to>"` + tags `{nav.from, nav.to}`；unmount 时 close 剩余 open span 不泄露
- [x] 测试：`handlers/network.ts` 6 个（emit http.client span / traceparent header / 5xx → error / NetworkError → error + tag / AbortError → cancelled / caller headers 保留）；`navigation.ts` 5 个（hook export shape / 初次 mount 无 span / 单 hop / same-route 去重 / 链式 hops / cleanup close open span）；用 FakeNav class 模拟 react-navigation ref 避免装 react-test-renderer
- [x] **install-once 测试陷阱解决**：原 beforeEach 重置 globalThis.fetch 破坏 wrapped fetch（wrapper 在 install 时 capture original，后续 globalThis.fetch 重写绕过 wrapper）。改成 beforeAll 一次 install + module-level 静态 recorder + 测试间只改 recorderQueue
- [x] `sdk/react-native/src/index.ts` export `useTraceNavigation` + `NavigationRefLike` 类型
- [x] **bun test 34/34 pass**（was 22 + 12 = 34；6 tracing + 5 navigation - 1 hook-shape sanity = 12 net new）；全 SDK suite 复跑绿
- [x] commit `phase 35 sub-C: rn sdk fetch + navigation tracing`

### sub-D — `sdk/react/src` 加 component render span

- [x] 新 `sdk/react/src/SentoriTrace.tsx` 暴露 `<TraceRender op="..." name? data? tags?>`：first render 用 `useMemo([])` 一次性 startSpan，effect cleanup 在 unmount 时 finish；re-render 不重开 span（lifespan 是 component instance，不是 props）；StrictMode 双 invoke 由 SpanHandle 的 double-finish no-op 兜底
- [x] 6 个单测：render children / 开-关 span shape / 自定义 op+tags+data 全传到 sealed span / name 默认 op / 多 mount 独立 / re-render 不重开
- [x] 同时修两个 latent bug 暴露：(1) sdk/react/package.json 把 `@goliapkg/sentori-core` 从 `0.1.0` bump 到 `0.2.0` —— 否则 bun 解到 npm registry 0.1.0（无 startSpan API）而非 workspace 内的 0.2.0；(2) sdk/react/src/index.ts 历史上漏 export `SentoriSuspense`（lib/ 编译出来但 index.ts 没暴露顶层，consumers 拿不到）—— 一并补上 + 顺手加 `TraceRender` export
- [x] sdk/next/package.json 同步：`sentori-core: 0.1.0 → 0.2.0` + `sentori-react: 0.1.0 → 0.3.0` 跟当前 workspace 版本对齐
- [x] **bun test 20/20 pass**（was 14，+6）；全 SDK suite 复跑：core 40 / javascript 20 / react 20 / next 9 / react-native 34 全绿
- [x] commit `phase 35 sub-D: react render tracing`

### sub-E — bump + publish + dogfood

- [x] Bump 5 包（实际是 5 个而非 ROADMAP 写的 4 个 —— sentori-core 也加了 `Span`/`SpanHandle`/`startSpan`/`withSpan` 新 API，必须 bump 否则下游 `"@goliapkg/sentori-core": "0.2.0"` 拿到旧 npm 版本 missing API）：core 0.2.0 → 0.3.0 / javascript 0.2.0 → 0.3.0 / react 0.3.0 → 0.4.0 / react-native 0.4.0 → 0.5.0 / next 0.1.0 → 0.2.0；inter-deps 同步 bump 让 workspace 解析正确
- [x] sdk/react/package.json#exports 加 `./trace` subpath（`@goliapkg/sentori-react/trace` → `<TraceRender>`）；不挤 top-level export，保留 tree-shake
- [x] `bun publish --access public` × 5 全部成功；npm registry 5 包 latest tag 都已更新
- [x] Dashboard dogfood：`web/src/auth/ProtectedLayout.tsx` 加 `useSentoriRouter()` from `@goliapkg/sentori-react/router`，每次 nav 产 breadcrumb；SentoriProvider 在 main.tsx 已经把 initSentori 走过 → fetch hook 自动注入 → 每个 `/admin/api/...` 请求产 `http.client` span + traceparent header（**first end-to-end dogfood trace**）
- [x] Bundle 影响：dashboard 主 bundle 336.42 KB → 339.66 KB（gzip 106.78 KB → 107.93 KB，+1.15 KB gzip），fetch hook + router hook 的代价合理
- [x] commit `phase 35 sub-E: span sdks publish + dashboard dogfood`

## Phase 36 — Dashboard：Trace List + Trace Detail

**Goal:** UI 把 trace 显出来。Trace list 像 issues list 一样紧凑；trace detail 走 waterfall 表格风格（**不**画 SVG bar，纯表格 + 缩进 + duration 列）。
**Entry:** Phase 35 ✅. **Exit:** 两个新 view 接入 router；dashboard 自己产生的 trace 可视；快捷键 / 过滤 / sourcemap symbolication 都接通。
**Estimate:** 2-3 周

### sub-A — Trace list view

- [x] `server/src/api/traces.rs`：`list_traces` handler 同款 keyset cursor pagination（参考 list_issues Phase 33 sub-B）— JSON array body + `X-Next-Cursor` header；filter 三种 query param: `?op=` exact match / `?status=` / `?durationMs=N` 表示 ≥ N ms；WHERE 用复合 keyset `(last_seen, trace_id) < (cursor_last, cursor_id)` 保严格有序；ORDER BY last_seen DESC, trace_id DESC
- [x] `server/src/api/mod.rs` `pub mod traces`；`server/src/router.rs` 挂 `/projects/{project_id}/traces`
- [x] `web/src/api/client.ts` 加 `TraceRow` type + `listTracesPage(projectId, {cursor, op, status, durationMs, limit})`，与 listIssuesPage 同接口；用 raw fetch + 读 `X-Next-Cursor` header
- [x] 新 `web/src/views/traces.tsx`：6 列 table（Op / Name / Span count / Duration / Status / Last seen）+ status pill 三色（ok 绿 / error 红 / cancelled 黄）；`useInfiniteQuery` + `<LoadMoreSentinel>` 同 IssuesView 模式；keyboard nav j/k/Enter + 三个 filter（status select / op select / min duration ms input）；filter 变 reset selectedIdx 用单点 `eslint-disable-next-line react-hooks/set-state-in-effect`（rule false positive，one-shot reset 不是 derive）
- [x] `web/src/views/org-layout.tsx` NAV 表加 `{ label: 'Traces', path: 'traces' }`，位置在 Issues 后；`web/src/main.tsx` lazy import + router 路由 `traces` path
- [x] **format 工具**：`formatDuration`（<1ms / ms / s 三档）+ `formatRelative`（s/m/h/d ago）独立 helper
- [x] dashboard `bun run check` 0 errors / `bun run build` OK / vitest 24/24；bundle 339.66 → 339.94 KB（gzip 107.93 → 108.01 KB，+0.08 KB —— Traces view 独立 lazy chunk 不进 main bundle）
- [x] commit `phase 36 sub-A: trace list view`

### sub-B — Trace detail (waterfall)

- [x] server `GET /admin/api/projects/{project_id}/traces/{trace_id}` 返回 `{ trace, spans[] }`；spans ORDER BY started_at ASC, id ASC（client 一遍构树）；404 走 AppError::NotFound 已有 IntoResponse mapper
- [x] 新 `web/src/views/trace-detail.tsx`：`buildTree` 由 parent_span_id 二次遍历构 tree，DFS `flatten` 得 row 数组；orphan span（parent 缺失）当 root 兜底，UI 仍显示
- [x] 渲染：3 列表格（Op / Name / Duration / Status）+ 缩进 `n.depth * 16px` 表示嵌套；**不**画 SVG bar / timeline overlay，纯表格 + duration column 已够看出热点
- [x] hover 行：`hoveredId` state + `ancestorIds(byId, hoveredId)` 走 parentSpanId chain 一层一层向上 → 给行加 `bg-bg-tertiary/40` 高亮 root→leaf 全链路
- [x] click 行打开右侧 drawer：id / parent / duration / status / startedAt + tags grid + data `<pre>` JSON pretty-print；`✕` 关；点别的行切换
- [x] `web/src/api/client.ts` 加 `SpanRow` / `TraceDetail` types + `getTraceDetail(projectId, traceId)`
- [x] router 加 `traces/:traceId` lazy route；trace-list 行 onClick → navigate('/org/{slug}/traces/{traceId}') 已在 sub-A 接通
- [x] dashboard `bun run check` 0 errors / `bun run build` OK；main bundle 339.94 → 340.16 KB（trace-detail 独立 lazy chunk）
- [x] commit `phase 36 sub-B: trace detail waterfall`

### sub-C — Span ↔ Event 联动

- [x] migration `0028_event_trace.sql`：`ALTER TABLE events ADD COLUMN IF NOT EXISTS trace_id UUID, span_id UUID`（partitioned parent ALTER 自动传播到 children）+ partial index `events_trace_idx ON events (trace_id) WHERE trace_id IS NOT NULL`（多数 row NULL 用 partial 省空间）
- [x] ingest pipeline (`persist_event_row`)：parse `event.trace_id` / `event.span_id` (Option<String>) → `Uuid::parse_str` → INSERT 携带两列；不存在 trace 上下文时仍正常写入（NULL）
- [x] `EventRow` 扩 `trace_id: Option<Uuid>` + `span_id: Option<Uuid>`；`list_events_for_issue` SQL 加 SELECT 两列；dashboard `EventRow` type 加 `traceId?` + `spanId?`
- [x] Issue detail：在 `<UnsymbolicatedHint>` 下方加 trace pill — `event.traceId` 存在时显示 "Captured inside trace 019e2000 · In trace →" link 跳 `/org/{slug}/traces/{traceId}`
- [x] 反向链接：server `trace_detail` endpoint 返回 `{trace, spans, events[]}` 数组（events 同 trace 的所有，含 issue_id + span_id + error_type）；trace-detail.tsx 用 useMemo 构 `eventsBySpan: Map<spanId, count>` → 每行 status 列右侧加红色小 chip `{n} event(s)`，title 提示
- [x] 验证：cargo build 通过 / dashboard check 0 error / build OK；main bundle 不变（dashboard 改动都在 issue-detail + trace-detail lazy chunk）
- [x] commit `phase 36 sub-C: event-span correlation`

### sub-D — 过滤 + 搜索

- [x] 新 `web/src/lib/trace-query.ts` 同 `parseIssueQuery` 模式：`parseTraceQuery(input)` 解析 `KEY:VALUE` term — `op:` 自由字符串 exact match / `status:` enum 限 ok|error|cancelled / `duration:>Nms` 或 `>Ns`（require `>` prefix 强制语义清晰，未来加 `<` 也不会歧义）；free text 直接 warning 不丢
- [x] `parseDurationFilter`：正则 `^>(\d+)(ms|s)$` 拒绝 missing prefix / zero / 负数 / unknown unit；返回 ms float
- [x] `TracesView` 退掉 sub-A 的 3 个 select/input 替换成单 search box（与 IssuesView 一致的"搜索条"心智模型）；warnings 数 > 0 时显示 amber 小提示 + `title` 列举原因
- [x] 11 个 vitest unit test（trace-query.test.ts）覆盖：3 token 联合 / 秒单位 / free text 警告 / unknown key / bad status / bad duration / empty input / parseDurationFilter 单独覆盖 prefix / zero / negative / unit
- [x] dashboard `bun run check` 0 errors / build OK；vitest **35/35 pass**（was 24，+11）
- [x] commit `phase 36 sub-D: trace search tokens`

## Phase 37 — Cross-cutting：W3C TraceContext + 后端联动

**Goal:** Mobile/Web 客户端发的 traceparent header 被 Sentori-instrumented 后端读到，server-side span 续在同一 trace 里。这是 distributed tracing 的真正价值点。
**Entry:** Phase 36 ✅. **Exit:** dashboard 接入 sentori-javascript → 后端 sentori-server 自己开 span → 同一 trace 看到 client + server 两段。
**Estimate:** 1-2 周

### sub-A — sentori-server 自身 instrumentation

- [x] `server/src/trace_emit.rs`：`SpanEmitter` 模块 — `spawn(pool, project_id)` 启 buffer (Arc<Mutex<Vec>>) + 30s 周期 flush + 200-span 突发 flush；`flush_batch` 一 tx 内 INSERT spans + UPSERT traces，复用 `/v1/spans` 同款逻辑；`try_push` 异步进 buffer 不阻塞热路径
- [x] `parse_traceparent(header)` 解 W3C 格式：32-hex traceId → uuid / 16-hex parent-id → 32-hex uuid 零右填（lossy 但跨系统 stitching 足够）；7 单测覆盖各种错位
- [x] `server/src/tracing_middleware.rs`：axum middleware 包 handler，request 进入 → 读 traceparent 或开新 trace → Instant 计时 → next.run → 决定 status（5xx error / 4xx ok 因 client 错 / 2xx ok）→ try_push 含 http.method / http.path / http.status tag
- [x] `router::build` 加 `cfg.self_trace: Option<SpanEmitter>`，最外层 layer；`main.rs` 读 env `SENTORI_SELF_TRACE_PROJECT_ID`（UUID），不设默认 None
- [x] **不**做内部 sqlx query span / cache fetch child span（侵入性大，需 sqlx interceptor，留 Phase 38 polish 或 v0.5）
- [x] Live smoke：3 GET + 1 GET with traceparent → 等 30s flush → DB 33 spans + 32 traces 落入；带 header 的请求 trace_id `aaaaaaaa-...` + parent_span_id `bbbbbbbb-bbbb-bbbb-0000-...` (16→32 hex 零填) 跨系统 stitching 验证通过
- [x] `cargo test --lib` 33/33 pass（was 26，+7）；`docker build` OK
- [x] commit `phase 37 sub-A: server self-instrument`

### sub-B — Node SDK middleware（Express/Hono/Fastify）

- [x] `sdk/javascript/src/tracing-middleware.ts` 暴露 3 framework adapter + 共享 `parseTraceparent`；subpath export `@goliapkg/sentori-javascript/tracing`
- [x] Express: 监听 `finish`+`close` 双重 idempotent；不能 withSpan 因 callback-style next 不能传 context — 但 http.server span 仍正确 emit
- [x] Hono: async withSpan(next) 让 handler 内 startSpan 自动 child；try/catch throw → status=error + error.message tag + re-throw
- [x] Fastify: plugin-style `installFastifyTracing(fastify)` 注册 onRequest + onResponse hook，req.sentoriSpan 槽传 span 跨 hook
- [x] 5xx → error / 4xx → ok（client 错不是 server fail）；inbound traceparent 解 + 继承
- [x] 15 个新单测覆盖 parseTraceparent 边界 / 各 framework lifecycle / traceparent 继承 / throw 处理。**bun test 35/35 pass**（was 20，+15）
- [x] commit `phase 37 sub-B: node tracing middleware`

### sub-C — 文档 + recipe

- [x] 新 `docs-site/src/content/docs/recipes/distributed-tracing.md`：三层 trace 全栈示意 + ASCII 拓扑 + 三 framework middleware + dashboard 过滤查询 + W3C traceparent stitch 半 lossy 说明 + SDK ↔ 协议 crosswalk 表
- [x] sidebar 加 entry；mirror 到 `docs/recipes/distributed-tracing.md`；docs-site build 24 page
- [x] commit `phase 37 sub-C: distributed tracing recipe`

## Phase 38 — Polish + Performance + 发布

**Goal:** 1M span 规模复测；index 补齐；CHANGELOG v0.4 entry；tag release。
**Entry:** Phase 37 ✅. **Exit:** v0.4 ROADMAP 100% / git tag v0.4.0 / sentori-react@0.4 等四个 SDK 包 publish / docs site 更新 hero "distributed tracing first-class"。
**Estimate:** 1 周

### sub-A — 1M span 复测

- [x] SQL bulk INSERT 模式（参考 Phase 33 sub-A）：5000 traces + 5000 root spans + 995,000 children = 1,000,046 spans / 5007 traces / spans 表 284 MB；总耗时 ~15s
- [x] 跑 4 个 hot-path query EXPLAIN（不止 ROADMAP 列的三个，加 Q4 span search 看 op+duration top-N 行为）：
  - **Q1 trace list 0.131ms**（was 0.075ms / +75% / Index Scan 同 plan）
  - **Q2 trace detail 1.157ms**（was 0.684ms / +69% / Bitmap Index Scan 同 plan，planning time 1.96ms 是新 bottleneck）
  - **Q3 events on trace 0.106ms**（新增 — Phase 36 sub-C 的 `events_trace_idx` partial index 起效；planning 6.80ms 是 events 表跨分区 planner 开销）
  - **Q4 span search op+duration top 50 40.7ms**（was 5.64ms / 7.2× sub-linear / 166k 候选 → in-memory Sort）
- [x] 写 `docs/performance/baseline-v0.4-phase38.md`：4 query 完整 plan + 对比表 + methodology + "什么没测"（跨月 partition / 高 fan-out / 并发读）+ regression policy crosscheck（plan-shape 均未变 → 不触发 v0.3 性能门槛）
- [x] 行动项：Q2/Q3 `received_at>=N days` partition prune hint（partition 数到 12+ 月再做）/ Q4 `(project_id, op, duration_ms DESC)` 复合 index（v0.5 候选，6 月真实流量后评估）
- [x] 清理 bulk-1m-v04 synthetic（DELETE 1,000,000 spans + 5,000 traces）；保留 46 spans / 7 traces 来自 sub-C/D 等先前 smoke
- [x] 决定：v0.4 release 不需要 index migration，sub-B 可以 tag + ship
- [x] commit `phase 38 sub-A: 1m span explain baseline`

### sub-B — CHANGELOG + release notes + tag

- [x] CHANGELOG.md v0.4 section：Goal 段反 Sentry envelope-bloat 立场陈述 + Phase 34/35/36/37/38 各 sub 一行 condensed summary；放在 v0.3 之上、最近优先；5 npm package version 标黑
- [x] marketing hero 加副标题 `v0.4 · Distributed tracing built in.`（accent-coloured，h1 和 sub-hero 之间）；主 hero "Error tracking, built React-first." 不动
- [x] ROADMAP 顶部状态：v0.4 🚧 → ✅ + 加 v0.5 📐 待规划占位
- [x] git tag v0.4.0 + push；GitHub Release `gh release create v0.4.0` 含完整 release notes（distributed tracing / 5 SDK bumps / performance baseline 数字 / 协议 stable 声明 / "what we didn't do" / docs link）→ https://github.com/goliajp/sentori/releases/tag/v0.4.0
- [x] commit `phase 38 sub-B: v0.4.0 release`

---

## v0.4 显式不在范围内

避免 scope creep，下面这些**不**做（v0.5+ 决策）：

- ❌ Metrics（counters / gauges / histograms）—— protocol 只覆盖 events + sessions + spans 三类
- ❌ Logs —— breadcrumbs 已覆盖；专门的 logs ingest 路径留 v0.5
- ❌ Profiling（CPU sampling 数据）
- ❌ OpenTelemetry SDK 全兼容 —— 我们用 W3C TraceContext header（互操作的最小公约数），但不实现 OTLP receiver
- ❌ Session Replay
- ❌ Vue / Svelte SDK —— 留 v0.5
- ❌ Slack / Linear / GitHub PR 集成 —— webhook 已就位（v0.2 sub-D），第三方集成留 v0.5
- ❌ Stripe / 计费 —— pro / enterprise 仍手动开通
- ❌ AI root-cause hint
- ❌ 多区域部署
- ❌ 主动推广（Show HN / Twitter launch）—— v0.4 末有 distributed tracing 这个 talking point + 5 SDK publish，看那时声誉值再决定

---

# v0.5 ROADMAP — Scale + Readable Errors + Dashboard refresh

**三条主线**（线性执行，不并行）：

1. **Trace 上量管控** —— Insight dogfood 暴露：现在每个 fetch 都是独立 root trace（SPAN COUNT 全是 1），上量后 `traces` 汇总表行数爆、列表没法看，span 还跟高价值 error event 抢同一个 ingest 配额。修法选定为**时间硬保留窗口 + 窗口内 100% 不采样**（不默认上 head-based sampling，留作 SDK 开关给真扛不住单机的人），配 span name 路径归一化、navigation span 自动当父、span 独立 rate cap、Phase 38 defer 的 Q4 复合 index。目标量级：~10w 用户、单台 Postgres。
2. **可读的 JS/RN 错误** —— Insight dogfood 暴露：JS 错误栈是 `index.bundle:1:288432` 这种不可读形态。基础设施大半已有（`server/src/symbolicate.rs` 有 sourcemap 解析 + source-context，`/admin/api/releases/{name}/sourcemaps` 上传端点也有，`Frame` 类型已含 `column?`/`function?`），缺的是「`symbolicate_payload` 没接 ingest、只在 admin on-demand 调」和「构建期没人上传 sourcemap」。做成端到端：SDK 抓全帧 → CLI 构建期组合上传 sourcemap（tag 到同一 release 串）→ server ingest 时符号化并存源码片段 + 按符号化帧重新 fingerprint → dashboard 渲染源码片段 + 折叠 vendor 帧 + 标注没符号化的原因。
3. **Dashboard 左侧导航重构** —— 现在是顶部横排 NAV（Overview/Issues/Traces/Releases/Teams/Alerts/Audit/Settings），上量后条目变多挤不下。改成左侧 sidebar（Linear/Vercel/Sentry 范式）：顶部 org/project 切换器，主导航竖排，次要项收进可折叠分组，底部用户菜单 + 主题切换；窄屏折叠成图标轨。

**反 Sentry 立场延续**：保留时间硬窗口比 Sentry 那套多层采样简单且省掉「采样把出错的也丢了」的复杂度（schema 简 / 部署轻）；不做 tail-based sampling collector（stateful、跟轻部署冲突）。

**Entry**：v0.4 ✅ + v0.4.2 已 publish。每条 step 动词 + 目标 + 文件 + 验收；跨 phase 严格线性。

## Phase 39 — Trace 上量管控 ✅

**Goal:** trace 数据在 ~10w 用户量级可控：cardinality 收敛、保留有界、span 不挤占 event 配额。
**Entry:** v0.4 ✅. **Exit:** span name 路径已归一化；navigation 下的 http 请求挂成 child；`SENTORI_TRACE_RETENTION_DAYS` 生效 + 老分区自动 drop；span 有独立 rate cap；Q4 在 ~1300w 行规模复测有 baseline；SDK bump + publish + Insight dogfood 验证。
**Estimate:** 2-3 周

### sub-A — span name 路径归一化（SDK）

- [x] `sdk/core/src/url.ts` 新增 `normalizeUrl(url)`：保留 scheme+host+path、砍 query+fragment；path 段命中以下任一 → `{id}` —— 纯数字 / uuid / 长 hex(≥16，覆盖 mongo ObjectId 24 位 / sha) / 长不透明 token(≥20 字符且含数字)；保守优先（`winter-jacket-2024` / `VC64VOVEX0VT` 这类短码/slug 不动，宁可欠归一也不误伤）；host 不动（per-tenant 子域是另一个问题）；relative URL 走 fallback 当 bare path 处理；空/垃圾输入不抛
- [x] 三个 hook 接入：`sdk/react-native/src/handlers/network.ts`（patchFetch + patchXhr）+ `sdk/javascript/src/hooks/fetch.ts` + `sdk/javascript/src/hooks/xhr.ts` —— span `name` 用 `normalizeUrl(scrubbed)`，`http.url` tag 仍存完整（RN 那条已 scrub auth 参数；JS 那条沿用原 raw url，scrub 是后续 sub 的事）；`sdk/core/src/index.ts` export `normalizeUrl`
- [x] 测试：`sdk/core/src/__tests__/url.test.ts` 9 个（numeric / uuid / 长 hex×2 / 长 opaque / slug 不动 / 砍 query+frag / host 不动 / relative / 空垃圾）；fetch-hook +1（span name `{id}` + tag 保完整含 query）；RN tracing +1（多 id 段归一 + tag scrub）。全 SDK sweep 绿：core 49 / js 51 / rn 44 / react 20 / next 9 / expo 4
- [x] commit `phase 39 sub-A: span name path normalization`

### sub-B — navigation span 自动当父

- [x] `sdk/core/src/trace-context.ts`：加 `setActiveSpan(span | null)`（fallback impl 设 module var；ALS impl no-op —— navigation 只跑 browser/RN，那边是 fallback）+ test hook `__useFallbackTraceContextForTests()`（bun 跑成 Node 会选 ALS，nav 测试需要强制 fallback 来验真 setActiveSpan）；index.ts export 两者
- [x] `sdk/react-native/src/navigation.ts` `useTraceNavigation`：每个屏（含初始屏）开一个 `react.navigation` span（`parent: null` 各自是 trace root），并 `setActiveSpan` 让它在该屏期间常驻 active —— 这一屏的 `http.client` span 自动成 child（一屏 ~30 请求收成 1 条 trace）；下一屏先 finish 旧 span 再开新的（active 一并切换）；unmount finish + `setActiveSpan(null)`；module-doc 加 RN active-span 是 module var 的 caveat
- [x] `sdk/react/src/router.ts` `useSentoriRouter`：原 `nav` breadcrumb 保留，**新增**每路由一个 `react.navigation` span（`parent: null`、`name = from → to` 或初始路由名）并 setActive；unmount finish + clear
- [x] 测试：navigation.test.ts 重写成 7 个（hook export / 初始屏开 span 且 active / 无路由无 span / 屏内 startSpan 自动 child + 同 trace / 各屏独立 root 不嵌套 / same-route 不重开 / cleanup finish + clear active）；router.test.tsx +1（初始 + 每次 transition 各一个 react.navigation span，各自 root、各自 trace）。全 SDK sweep 绿：core 49 / js 51 / rn 45 / react 21 / next 9 / expo 4
- [x] 更新 `docs/recipes/distributed-tracing.md` + docs-site 镜像：rewrite "what you get for free" —— XHR 也覆盖 / span name 路径归一化 / 一屏一 trace + nav span 常驻 active / RN module-var caveat / react-router 的 `useSentoriRouter` 等价物
- [x] commit `phase 39 sub-B: navigation span as active parent`

### sub-C — 时间硬保留 + 老分区 drop（server）

- [x] 决定：`traces` **不**分区 —— ingest 的 `ON CONFLICT (trace_id) DO UPDATE` 需要 trace_id 单列唯一索引，分区表的唯一索引必须含 partition key，冲突。改成 `DELETE WHERE last_seen < cutoff` + migration `0029_trace_retention.sql` 加 `traces_last_seen_idx`（让 delete 走索引扫描）。`spans` 早已按 `received_at` 分区（0026），沿用分区 drop。
- [x] `server/src/retention.rs` 重写（原本只管 events）：泛化 `ensure_future_partitions(table)` / `drop_expired_partitions(table)` / `parse_partition_name(name, prefix)` 同时管 `events` 和 `spans`；events cutoff = `max(org_quotas.retention_days)` floor 30、spans+traces cutoff = `SENTORI_TRACE_RETENTION_DAYS`（默认 14、clamp ≥1）；新 `prune_traces(pool, cutoff) -> u64`（DELETE）从 `run_once` 调；`RetentionStats` 加 `traces_deleted`；main.rs 的 `spawn_retention_task` 调用不变
- [x] 文档：`docs/self-hosting.md` + docs-site 镜像加 `SENTORI_TRACE_RETENTION_DAYS`（顺手补 `SENTORI_SELF_TRACE_PROJECT_ID` 这个 v0.4 漏掉的）+ 新 "Data retention" 小节（events≥30d / spans+traces 默认 14d 不采样 / 分区滚动 + drop 机制）
- [x] 测试：lib 单测 `parse_partition_name` 加跨表 prefix case（events 不匹配 spans_… 等）；新集成测试 `server/tests/trace_retention.rs`（`prune_traces` 删 100 天前的、留今天的；DATABASE_URL 没设则 skip）；`cargo test --lib` 33/33、`cargo test --all-targets --no-run` 通过
- [x] commit `phase 39 sub-C: trace retention window`

### sub-D — span 独立 rate cap（server）

- [x] `server/src/quotas.rs`：新 `check_and_record_spans(valkey, org, now)` —— 独立于 events 的 per-org 月度配额（Valkey key `spans_usage:` / `spans_dropped:`，limit 从 env `SENTORI_SPAN_LIMIT_MONTHLY`，默认 10M、`0`=无限）；逻辑与 `check_and_record` 同款（fail-open、`Exceeded` 时 incr dropped + 返回 `reset_at`）；`span_limit_monthly()` helper。注：per-minute flood 防护已由现有 `rate_limit_middleware`（per-token，`SENTORI_RATE_LIMIT_PER_MIN`）覆盖所有 ingest 路由含 spans，所以 sub-D 只补「月度预算解耦」这一块
- [x] `server/src/api/spans.rs`：`handle` / `handle_batch` 把 `quotas::check_and_record`（吃 events 计数器）换成 `quotas::check_and_record_spans` —— span 洪水不再消耗 org 的 error-event 配额；dev token 仍跳过；batch 整体算 1 次（同 events:batch）
- [x] 文档：`docs/self-hosting.md` + docs-site 镜像加 `SENTORI_SPAN_LIMIT_MONTHLY`
- [x] 测试：lib 单测 `span_limit_defaults_when_env_unset`；`cargo test --lib` 33→34、`--all-targets --no-run` 通过。（跨 Valkey 的「两桶隔离」集成测试评估后不做 —— 共享 DB/Valkey 测试有 flakiness 史，且两个计数器 key 前缀不同、隔离从代码上即可见；与 sub-C 把集成测试限定在 `prune_traces` 同一权衡）
- [x] dashboard span 配额展示：deferred（ROADMAP 标的是"如有…"，本 sub 不做）
- [x] commit `phase 39 sub-D: separate span quota`

### sub-E — Q4 复合 index + 大规模复测

- [x] migration `0030_spans_op_duration_idx.sql`：`CREATE INDEX IF NOT EXISTS spans_project_op_duration_idx ON spans (project_id, op, duration_ms DESC)`（用 plain `CREATE INDEX` 而非 `CONCURRENTLY` —— sqlx 迁移在事务里跑；分区表上 index 自动传播到 children，prod 数据量下短锁可接受。Phase 38 baseline 的 deferred action item 也勾掉 + 链到新 baseline）
- [x] 实测（throwaway `postgres:18-alpine` + 全 migration + SQL bulk INSERT 1M spans，与 Phase 34/38 baseline 同 shape 可直接对比）：**Q4 span search top-50：43.0 ms → 0.40 ms（~100×）**，plan 从 Parallel Seq/Bitmap + top-N heapsort over ~332k 候选 → Merge Append of per-partition Index Scan on 新复合 index（直接 seek top 50，无 sort、无候选物化）；index 建 1M 行 ~0.8s、size ~7.5 MB（~7.5 B/row）。Q1-Q3 plan/index 未动，沿用 phase38 baseline 数字。teardown 临时容器
- [x] `docs/performance/baseline-v0.5-phase39.md`：Q4 before/after 完整对比 + setup + regression crosscheck（纯改进，不触发性能门槛）+ 关于 trace 汇总表 cardinality 在 sub-A/sub-B 后大幅降低的说明
- [x] commit `phase 39 sub-E: Q4 composite index + 1M span re-baseline`

### sub-F — bump + publish + Insight dogfood

- [x] bump + publish 5 包：core 0.3.0 → **0.4.0**（新 API `normalizeUrl` / `setActiveSpan` / `__useFallbackTraceContextForTests`）/ javascript 0.3.2 → **0.3.3**（用 normalizeUrl；dep core→0.4.0）/ react-native 0.5.2 → **0.5.3**（normalizeUrl + setActiveSpan）/ react 0.4.2 → **0.4.3**（router.ts 用 setActiveSpan/startSpan + 开 nav span；dep core→0.4.0、js→0.3.3）/ next 0.2.2 → **0.2.3**（dep 透传）；`@goliapkg/sentori-core` 所有 pinned dep 同步到 0.4.0 避免 npm 解到旧版（version-pin trap）；expo 不动（peer dep、源码未变）；`npm publish` × 5 全部成功。CHANGELOG v0.5 段等 Phase 41 收尾一起写
- [x] `docs/dogfood/insight-friction.md` 加 "Dogfood-driven changes (chronology)" 段（v0.4.1 XHR / v0.4.2 span flush / v0.5 sub-A 归一化 / sub-B nav-parent / Phase 40 symbolication 规划），修掉过时的 SDK 版本元数据；Phase 30 sub-A 秒表表保留（待用户实际 re-onboard 跑）
- [x] **pending user**：Insight 升到 `sentori-react-native@0.5.3` 重跑 → 观察 Traces 是否按路由聚合 / 一屏一 trace（记进上面那个 doc）
- [x] ROADMAP 勾掉 Phase 39（除 sub-F 这条 user-pending observation）
- [x] commit `phase 39 sub-F: bump + publish + dogfood log`

## Phase 40 — 可读的 JS/RN 错误（sourcemap 符号化端到端）

**Goal:** 错误直接显示「哪个 release 的 src 哪个文件、哪段代码」+ 源码片段，而不是 `index.bundle:1:288432`。吸收原 v0.3 Phase 30 sub-A/B 的 dogfood + 摩擦点修复（候选 top-1/2 就是 sourcemap 发现性 + token 401 信息）。
**Entry:** Phase 39 ✅. **Exit:** SDK 抓全 column/function；`sentori-cli` 能组合上传 Hermes/Metro sourcemap；server ingest 时符号化 + 存源码片段 + 按符号化帧 fingerprint；dashboard issue 详情显示源码片段 + 折叠 vendor 帧 + 标注没符号化原因；Insight prod 错误验证可读。
**Estimate:** 3-4 周

### sub-A — SDK 抓全帧信息

- [x] 核查：`sdk/core/parseStack` 已支持 V8/Node/Bun/Hermes-0.71+（`at fn (file:line:col)`）+ SpiderMonkey/Safari/旧 Hermes（`fn@file:line:col`），column + function 一直都抓。缺口：Hermes **生产字节码**帧 `at fn (address at /path/main.jsbundle:1:289430)` —— `address at ` 前缀混进了 file，符号化时查不到 sourcemap。修：解析后 `file` 去掉 `^address at +`；`(native)` 帧无位置、不匹配两个正则、丢弃
- [x] `Frame` 已有 `column?`/`function?`；RN `stack.ts` 调 core 不带 `shortFilenames`（保留绝对 bundle 路径给符号化），JS 同链路把 Frame 进 event —— 现状 OK，无需改
- [x] 测试：core +2（Hermes 生产 `address at` 帧 → file 干净 / `(native)` 丢弃 / column 是字节偏移；Hermes dev Metro `fn@http://localhost:8081/index.bundle?...:1:N`）。全 SDK sweep 绿（core 51 / js 51 / rn 45 / react 21 / next 9 / expo 4）。sdk/core 改动 → bump+publish 攒到 sub-F
- [x] commit `phase 40 sub-A: parse Hermes bytecode frames`

### sub-B — `sentori-cli`：上传 sourcemap

- [x] 新 workspace 包 `@goliapkg/sentori-cli`（`sdk/cli/`，bin `sentori-cli`，纯 Node ≥18，无运行时依赖 —— `node:util.parseArgs` + 内置 `fetch`/`FormData`/`Blob`）：`sentori-cli upload sourcemap --release <r> [--token <t>] [--api-url <url>] [--dry-run] <path...>` —— 路径是文件或目录（目录扫一层取 `.map`/`.js`/`.jsbundle`/`.bundle`/`.hbc`），multipart POST 到 `/admin/api/releases/{release}/sourcemaps`（带 `Authorization: Bearer`）；`--token`→`$SENTORI_TOKEN`、`--api-url`→`$SENTORI_API_URL`（默认 `https://api.sentori.golia.jp`，`--ingest-url` 作 alias）；`--dry-run` 只列不传；非 2xx 时把 server detail 抛出来；release 校验只做"必填"（不在 CLI 端猜格式 —— mismatch 由 server/dashboard 提示，sub-D）。补到 root workspaces + `bun install`
- [x] `sdk/expo/scripts/eas-post-build.mjs` 修：原本传 `--ingest`（CLI 不认 → 会崩）改 `--api-url`；`resolveCli` 原本找 `.../bin/sentori-cli.js`（路径错）改 `.../lib/index.js`，并加 `npx --yes @goliapkg/sentori-cli@latest` 兜底；返回 `[cmd, ...prefixArgs]` 形式；header 注释去掉"Phase 22 stub"的过时话
- [x] Recipe：`docs-site/.../recipes/sourcemap-upload.md`（+ `docs/` 镜像）—— 顶部改成 `npx @goliapkg/sentori-cli@latest`（CI 不用装）+ `--api-url`/`$SENTORI_API_URL` + **release-must-match 警示框**；新增 "React Native / Expo (Hermes)" 小节（`react-native bundle --sourcemap-output` → `compose-source-maps.js` → upload，每平台一次；EAS 用 `@goliapkg/sentori-expo/eas-post-build`）；CI sections 里的 `curl install-cli.sh`（虚构 URL）换成 `npm install -g @goliapkg/sentori-cli`。`docs/self-hosting.md`（+镜像）的 "Source-map uploads" 同步改成 `npx … --api-url`
- [x] 测试：`sdk/cli/src/__tests__/upload.test.ts` 8 个（collectFiles 目录筛选 / 显式文件原样 / 去重 / 不存在路径 throw / 空目录 throw；uploadSourcemaps dry-run 不发请求 / 真发 multipart 到正确 URL + Bearer header / 非 2xx 把 detail 抛出）。bin 烟测：`--help` / `--dry-run` / 缺 `--release` exit 2 / 未知命令 exit 2。typecheck 干净
- [x] 吸收原 Phase 30 sub-B top-2（server 401 hint）：**defer 到 sub-D** —— 跟 dashboard 的 "no sourcemap for release X / release mismatch" 提示一起做更连贯
- [x] commit `phase 40 sub-B: sentori-cli`（bump+publish `@goliapkg/sentori-cli@0.1.0` + `sentori-expo` patch 攒到 sub-F）

### sub-C — server 在 ingest 时符号化

- [x] `symbolicate.rs` 加 typed-Event 路径：`symbolicate_event(pool, &mut Event)`（按 `event.release` 查 sourcemap，命中则用现成的 per-release 进程缓存 + `lookup_token` 重写 `error.stack`/`cause` 链的 `file`/`line`/`column`/`function`、flip `in_app=true`、把 bundle 坐标存进新增的 `Frame.raw_line`/`raw_column`）；`symbolicate_event_with_map(sm, &mut Event)` + `symbolicate_error_object` 拆出来纯函数好测。`crate::event::Frame` 加 `raw_line`/`raw_column`（`#[serde(default, skip_serializing_if = "Option::is_none")]`，client 永不发）
- [x] `persist_with_grouping` 改 `&mut Event`，在 `grouping::fingerprint` **之前** 调 `symbolicate_event`（best-effort，失败 warn 后用原帧）→ issue 分组键变成符号化后的 top-in-app 帧；`events.rs::handle` / `events_batch.rs` 把 `event` 改 `mut`。**fingerprint 迁移策略：只对"该 release 有传 sourcemap"的新事件生效，没传的 release 行为完全不变，不做存量 re-fingerprint**（某 release 第一次传 sourcemap → 老 issue 安静、新 issue 冒出，同 Sentry）
- [x] admin.rs 的 "show source" endpoint：读帧坐标时优先 `rawLine`/`rawColumn`（符号化后帧的 `line`/`column` 已是 source 坐标，reverse-map 需要 bundle 坐标）；`symbolicated=true` 的 on-demand 路径对已符号化帧是 no-op（`lookup_token` 在 source 坐标上失败 → 原样）—— 幂等，OK
- [x] docs：`docs/protocol.md`（+ docs-site 镜像）Frame schema 加 `rawLine`/`rawColumn` 行 + 一段说明 JS 帧 ingest 时符号化 + grouping 变化（uploading sourcemap → 新事件按 `src/Foo.tsx:42` 分组、老 issue 不动）
- [x] 测试：lib +2（`symbolicate_rewrites_resolvable_frame_and_keeps_raw_coords` —— 可解析帧重写 + raw 坐标保留 + in_app flip / 无位置帧不动；`symbolicate_recurses_into_cause_chain`）。`cargo test --lib` 34→36、`--all-targets --no-run` 通过。（注：source-context 内联到 Frame（`pre_context`/`post_context` 在 ingest 时填）+ dashboard 渲染 deferred 到 sub-D；sub-C 只做"符号化 + re-fingerprint"这一核心）
- [x] commit `phase 40 sub-C: symbolicate at ingest`

### sub-D/E/F + Phase 41 → 见下方「后续线性 checklist」

Phase 40 sub-A/B/C 完成。剩下的（dashboard 渲染、dev-mode、publish、Phase 41 左侧导航）整理成严格线性、按天推进的 checklist —— 见 `## v0.5 后续线性 checklist`。

---

## v0.5 后续线性 checklist（Phase 40 收尾 + Phase 41 dashboard）

严格线性，一天一块；每块自带 commit。

> ## ⚑ Insight 配合点：**现在就可以开始**
>
> 服务端 ingest 时符号化（Phase 40 sub-C）已经上线，`@goliapkg/sentori-cli@0.2.1` 已 publish。Insight 不需要等下面任何一天。两件事：
> 1. （可选、独立）`bun add @goliapkg/sentori-react-native@latest`（≥0.5.4）—— 拿 session pings / crash-free rate，零代码。
> 2. release 构建里加 sourcemap 上传。RN Hermes：
>    ```
>    npx react-native bundle --platform ios --dev false --entry-file index.js \
>      --bundle-output main.jsbundle --sourcemap-output main.jsbundle.packager.map
>    # Hermes 编译会写出 main.jsbundle.hbc.map
>    node node_modules/react-native/scripts/compose-source-maps.js \
>      main.jsbundle.packager.map main.jsbundle.hbc.map -o main.jsbundle.map
>    npx @goliapkg/sentori-cli@latest upload sourcemap \
>      --release "<和 init({release}) 一字不差>" --token "$SENTORI_TOKEN" \
>      main.jsbundle.map main.jsbundle
>    ```
>    iOS / Android 各跑一次。Expo/EAS 可用 `@goliapkg/sentori-expo@0.1.1` 的 `eas-post-build` hook。详见 docs → Recipes → "Source map upload" → React Native。
>
> 做完后：该 release 的**新**错误 dashboard 上 issue 标题/分组就是 `src/Foo.tsx:42`（点帧也能出源码）。把结果记进 `docs/dogfood/insight-friction.md`。Day 4 后 dashboard 会把源码片段做成内联（现在是点开 drawer）—— 但不影响 Insight 现在就接。
>
> 注意：parseStack 的 Hermes `address at` 前缀修复（sub-A）目前只在 workspace、还没 publish（Day 1 才发）—— 但它**不影响符号化能否成功**（服务端按 `line:col` 查 token，不看 `file` 字段；`file` 会被符号化后的源文件名覆盖），只影响"符号化失败时 `file` 字段是否干净"。所以 Insight 不用等 Day 1。

### Day 1 — publish parseStack 修复 + getting-started sourcemap 章节 ✅

- [x] bump + publish 链（inter-dep pin 同步）：core 0.4.0 → **0.4.1**（sub-A parseStack Hermes 修复）/ javascript 0.3.3 → **0.3.4**（dep core）/ react-native 0.5.4 → **0.5.5**（dep core；含修复）/ react 0.4.3 → **0.4.4**（dep core+js）/ next 0.2.3 → **0.2.4**（dep）；expo/cli 不动；`npm publish` × 5；`bun install`（无 lockfile 变化）；全 SDK sweep 绿（core 51 / js 51 / rn 45 / react 21 / next 9 / expo 4）+ typecheck 干净
- [x] `docs/getting-started.md`（+ docs-site 镜像）：第二段列表里 "Sourcemap / dSYM / Proguard" 那条改成指向 `recipes/sourcemap-upload.md` 的 `#source-maps`；新增 `### Source maps` 子节（`npx @goliapkg/sentori-cli upload sourcemap --release "<和 init 一字不差>"`，server ingest 时符号化 + 按源帧分组，Hermes 链到 recipe）。`docs/protocol.md` 的 release 串约定 `<app-name>@<version>+<build>` 早已在 Event schema 表里文档化 + sub-C 的 symbolication 段也提了"必须 === event 的 release"——无需再加
- [x] commit `v0.5 day 1: publish parseStack fix + getting-started sourcemap section`
- ✅ Insight 这之后可升 `sentori-react-native@0.5.5`（更干净的 Hermes 帧），但**不是必须**——上面 ⚑ 已说明

### Day 2 — server 401 hint + 符号化失败诊断

- [ ] server：admin auth / ingest auth 的 `401` response body 加 `hint` 字段（`token must start with st_pk_` / `token revoked` / `token does not belong to this project` 各给清晰文案）—— 吸收原 Phase 30 sub-B top-2，上传 CLI 和 SDK ingest 都受益
- [ ] server：`symbolicate_event` 返回的不只是 bool —— 给事件存一个 `symbolication` meta（`{ status: "ok" | "no_sourcemap" | "no_releases_match" | "partial", release, sourcemapReleases?: [...] }`）放进 payload，供 dashboard 区分"该 release 没传 sourcemap" vs "传了别的 release（mismatch）" vs "传了但部分帧落在 map 外"
- [ ] 测试：401 body 形状（lib / 集成）；`symbolicate_event` 各状态。`cargo test --lib` / `--all-targets --no-run` 绿
- [ ] commit `v0.5 day 2: 401 hint + symbolication status meta`

### Day 3 — ingest 时填源码片段 + dashboard 内联渲染 + vendor 折叠

- [ ] server：`symbolicate_frame_typed` 对 in-app 帧顺手填 `pre_context` / `post_context`（±5 行，来自 sourcemap 的 `sourcesContent`，复用 `window_from_sourcemap` 的切片逻辑）—— dashboard 就不用每帧一个 fetch
- [ ] `web/src/views/issue-detail.tsx` 栈渲染：in-app 帧默认展开、带 ±5 行源码片段（出错行高亮）+ header `function · file:line:col`；连续 vendor / node_modules 帧折叠成 `▸ N more frames`（点开）；没符号化成功的帧用 Day 2 的 `symbolication` meta 标原因（`no source map uploaded for release X` / `release mismatch: event has X, maps exist for [Y, Z]` / `frame outside the source map`）；`<UnsymbolicatedHint>` 文案更新 + 链到 recipe
- [ ] （可选）frame 链到对应 commit 的 git 源码（project 设置里配仓库 URL 模板 + release→commit 映射；没配就不显示）—— 时间够就做，不够就 defer
- [ ] vitest / playwright：符号化帧 + 内联源码渲染 / vendor 折叠 / 未符号化帧的原因提示。`bun run check` 0 error / `bun run build` OK
- [ ] commit `v0.5 day 3: inline source snippets + vendor fold + symbolication diagnostics`

### Day 4 — Phase 41 sub-A：左侧 sidebar 组件

- [ ] 新 `web/src/components/sidebar.tsx`：竖排 —— 顶部 org/project 切换器（复用现有 `useOrg`）；主导航 Overview / Issues / Traces / Releases（带图标）；次要项 Teams / Alerts / Audit / Settings 收进可折叠的 "More" 分组或底部；最底部用户菜单（邮箱 + OWNER badge + Sign out）+ 主题切换（现在右上角那个 ☀/🖥/🌙 移过来）；active 项左边一道 accent 竖条 + 背景（Linear 风）；宽 ~220px
- [ ] 暂时和现有顶部 NAV 并存（Day 5 再拆顶部）—— 或直接在 Day 4 就接进 `org-layout`，看实施时哪种 diff 干净
- [ ] commit `v0.5 day 4: left sidebar component`

### Day 5 — Phase 41 sub-B：layout 重构 + 响应式

- [ ] `web/src/views/org-layout.tsx`：拆掉顶部横排 NAV，改成 `<Sidebar>` + 主内容区两栏；顶部留一条很薄的 context bar（面包屑 / 当前 view 标题 / 全局搜索入口）或不留
- [ ] 窄屏（< md）：sidebar 折叠成只剩图标的窄轨（hover / 点击展开）或抽屉式，移动端可用
- [ ] keyboard：`g i` / `g t` / `g r` 等 "go to" 快捷键（Linear 的 `g` 前缀）；`[` `]` 折叠/展开 sidebar
- [ ] 所有现有路由路径不变（`/org/{slug}/issues` 等），只换 chrome；`bun run check` 0 / `bun run build` OK
- [ ] commit `v0.5 day 5: layout restructure + responsive sidebar`

### Day 6 — Phase 41 sub-C：打磨 + 测试 + v0.5.0 发布

- [ ] 对齐设计宪法（Linear/Vercel/Modal）：间距 / 字号 / 图标 / dark+light 两套 / density 设置仍生效
- [ ] vitest 更新（org-layout / sidebar 渲染 + 导航）；playwright e2e（登录 → 各 view → 折叠 sidebar）；bundle 对比（sidebar 进 main bundle，控增量）
- [ ] CHANGELOG.md v0.5 section（Phase 39 / 40 / 41 各一行 condensed summary + v0.5.x patch 列表 + npm 版本）；marketing / docs 里的 dashboard 截图（如有）更新成新 chrome
- [ ] ROADMAP 顶部状态 v0.5 🚧 → ✅；git tag v0.5.0 + `gh release create v0.5.0`
- [ ] commit `v0.5 day 6: dashboard chrome polish + v0.5.0 release`

### 机动 — Phase 40 sub-E：dev-mode Metro symbolicate（低优先、可插队/可跳）

- [ ] `sdk/react-native`：`__DEV__` 下发事件前先 POST 原始帧给 Metro dev server 的 `/symbolicate`（RN LogBox 用的就是它）拿原始位置；Metro 不在就跳过。测试：mock Metro 响应 → 帧被替换 / Metro 不可达 → 原样发不报错。commit `v0.5: dev-mode metro symbolicate`

---

## v0.5 显式不在范围内

- ❌ head-based / tail-based 采样的默认开启 —— `tracesSampleRate` 留作 SDK 开关，但默认 1.0；tail-based collector 不做（stateful、跟轻部署冲突）
- ❌ Metrics / Logs / Profiling —— 仍是 v0.6+
- ❌ OTLP receiver / OpenTelemetry SDK 全兼容 —— 仍只用 W3C TraceContext header
- ❌ Session Replay / Vue / Svelte / Python / Go SDK
- ❌ Slack / Linear / GitHub PR 集成、Stripe 计费、AI root-cause、多区域 —— 仍是远期
- ❌ 主动推广 —— v0.5 有 "可读错误" + "trace 上量不崩" 两个 talking point，看那时声誉值再决定

---

## v0.6+ 远期候选（无承诺、无优先级）

以下议题在 v0.5 完成后由当时的 dogfood 信号 + 用户反馈决定哪个先做：

- Metrics / Logs / Profiling — 完整 observability 三件套
- OpenTelemetry SDK 兼容层（OTLP receiver）
- Session Replay
- Vue / Svelte SDK
- Python / Go / Rust SDK
- Slack / Linear / GitHub PR 集成
- Stripe + 自动化计费 metering
- AI root-cause hint
- 多区域部署 / regional ingest
- 主动推广（Show HN / Twitter launch / blog series）

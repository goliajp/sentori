# Sentori Roadmap

> 一个 RN-first、Sentry 替代、完全自研协议的 APM。
> 后端：Rust + axum + PostgreSQL 18+ + Valkey。前端：`web/`（React 19 + Vite + Tailwind v4，全 SPA）。

## 当前状态

- **v0.1** ✅ self-hosted MVP（Phase 0-10）—— 详见 [CHANGELOG.md](./CHANGELOG.md)
- **v0.1.x** ✅ SaaS 上线 + dogfood（Phase 11-17）—— 详见 CHANGELOG.md
- **v0.2** ✅ 账户结构 + SDK 矩阵 + 数据呈现（Phase 18-28）—— 详见 CHANGELOG.md
- **v0.3** ✅ React-first via dogfood（Phase 29-33，25/27 sub done）—— 详见 CHANGELOG.md；Phase 30 sub-A/B 待 Insight dogfood 数据，见下方 "v0.3 收尾"
- **v0.4** 🚧 Distributed Tracing（Phase 34-38，约 8-11 周）—— 见下文，草稿待 review 后执行

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

# v0.3 收尾（user-blocked，可与 v0.4 并行）

Phase 30 sub-A/B 是 v0.3 唯一未完成的部分，等用户在 Insight 项目跑 dogfood 才能落地。做完任何一个都可以增量 commit 进 v0.3.x patch，不阻塞 v0.4 启动。

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

- [ ] CHANGELOG.md v0.4 section
- [ ] GitHub Release v0.4.0 + release notes 高亮：distributed tracing + 5 个 SDK bump + protocol stable v1 (no breakage from v0.1)
- [ ] marketing/index.astro hero 加副标题 "Distributed tracing built in"（不替换 React-first 主标）
- [ ] commit `phase 38 sub-B: v0.4.0 release`

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

## v0.5+ 远期候选（无承诺、无优先级）

以下议题在 v0.4 完成后由当时的 dogfood 信号 + 用户反馈决定哪个先做：

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

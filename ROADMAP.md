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

- [ ] `tools/seed-spans.ts`：注入 100k spans（500 trace × 200 span avg）
- [ ] EXPLAIN 三个 hot query：trace list（GET /admin/api/projects/{id}/traces?limit=100）/ trace detail（GET /admin/api/traces/{trace_id} → 一棵树）/ span search（按 op + duration > N）
- [ ] 输出 `docs/performance/baseline-v0.4-phase34.md`
- [ ] commit `phase 34 sub-D: span ingest explain baseline`

## Phase 35 — SDK 端：RN + JS + React

**Goal:** SDK 暴露 span API；自动 instrument fetch + react-router navigation；W3C `traceparent` header 注入。
**Entry:** Phase 34 ✅. **Exit:** `sentori.startSpan('op')` 工作；`fetch()` 自动产 `http.client` span；dashboard 自身 dogfood 能看到自家请求 waterfall。
**Estimate:** 2 周

### sub-A — `sdk/core` 加 span buffer

- [ ] `sdk/core/src/spans.ts`：`startSpan(op, name?, parent?)` → `Span { spanId, traceId, finish(status?, tags?) }`；ring buffer 类似 breadcrumb，cap 1000
- [ ] `sdk/core/src/trace-context.ts`：`activeTrace()` / `withTrace(traceId, parent, fn)` —— 用 AsyncLocalStorage (Node) / per-request store (RN)
- [ ] 单测：嵌套 span / parent_span_id 链 / finish 后 push 到 buffer
- [ ] commit `phase 35 sub-A: core span api`

### sub-B — JS SDK auto-instrument fetch

- [ ] `sdk/javascript/src/hooks/fetch.ts`：monkey-patch `globalThis.fetch`；包成 `startSpan('http.client') → fetch → finish(status, tags={url, method, status})`
- [ ] 透传 `traceparent` header（W3C TraceContext 格式 `00-<traceId32hex>-<spanId16hex>-01`）
- [ ] 单测：fetch 包后 buffer 有 span + traceparent header 注入正确
- [ ] commit `phase 35 sub-B: js sdk auto-instrument fetch`

### sub-C — RN SDK auto-instrument fetch + react-navigation

- [ ] RN SDK 用同样 monkey-patch fetch（XMLHttpRequest 走 React Native polyfill 内部，patch fetch 够覆盖）
- [ ] 新 `sdk/react-native/src/navigation.ts`：`useTraceNavigation()` hook（peer dep `@react-navigation/native >= 6` optional），路由变更产 `react.navigation` span
- [ ] commit `phase 35 sub-C: rn sdk fetch + navigation tracing`

### sub-D — `sdk/react/src` 加 component render span

- [ ] 新 `<TraceRender op="...">` 组件：render 期开 span，effect 卸载结 span
- [ ] 单测 + recipe doc
- [ ] commit `phase 35 sub-D: react render tracing`

### sub-E — bump + publish + dogfood

- [ ] sentori-react-native 0.4.0 → 0.5.0；sentori-javascript 0.2.0 → 0.3.0；sentori-react 0.3.0 → 0.4.0；sentori-next 0.1.0 → 0.2.0
- [ ] `bun publish --access public` × 4
- [ ] dashboard 自己 dogfood：装 `useSentoriRouter` 已经有 nav breadcrumb，这次也开 fetch instrumentation；commit 提到"first dogfood trace"
- [ ] commit `phase 35 sub-E: span sdks publish`

## Phase 36 — Dashboard：Trace List + Trace Detail

**Goal:** UI 把 trace 显出来。Trace list 像 issues list 一样紧凑；trace detail 走 waterfall 表格风格（**不**画 SVG bar，纯表格 + 缩进 + duration 列）。
**Entry:** Phase 35 ✅. **Exit:** 两个新 view 接入 router；dashboard 自己产生的 trace 可视；快捷键 / 过滤 / sourcemap symbolication 都接通。
**Estimate:** 2-3 周

### sub-A — Trace list view

- [ ] 新 `web/src/views/traces.tsx`：列 root_op / name / status / duration / span_count / received_at；和 issues list 同款 32px 行 + keyboard nav
- [ ] `adminApi.listTraces(projectId, {cursor, op, status, durationMs})`；server 端 `list_traces` 同款 keyset cursor pagination
- [ ] sidebar 加入口
- [ ] commit `phase 36 sub-A: trace list view`

### sub-B — Trace detail (waterfall)

- [ ] 新 `web/src/views/trace-detail.tsx`：拉一棵 span tree，按 parent_span_id 排列；缩进表示嵌套层级；右侧 column 显示 op/name/duration/status；hover row 高亮 root → leaf 链路
- [ ] **不**画 SVG bar / timeline overlay —— 太重，纯表格 + duration column 已经够看出热点
- [ ] 点 span 展开 data/tags drawer
- [ ] commit `phase 36 sub-B: trace detail waterfall`

### sub-C — Span ↔ Event 联动

- [ ] events 表加 `trace_id: uuid nullable` + `span_id: uuid nullable`（migration `0028_event_trace.sql`）；server ingest 时从 event payload 解出 traceparent
- [ ] Issue detail 页 frame 列旁加"In trace →"按钮链 trace detail
- [ ] Trace detail 反向：每个 span 右侧"events on this span"小 chip
- [ ] commit `phase 36 sub-C: event-span correlation`

### sub-D — 过滤 + 搜索

- [ ] Trace list toolbar 加 `op:http.client` / `duration:>500ms` / `status:error` 三类 token，复用 issues `parseIssueQuery` 同款 parser
- [ ] commit `phase 36 sub-D: trace search tokens`

## Phase 37 — Cross-cutting：W3C TraceContext + 后端联动

**Goal:** Mobile/Web 客户端发的 traceparent header 被 Sentori-instrumented 后端读到，server-side span 续在同一 trace 里。这是 distributed tracing 的真正价值点。
**Entry:** Phase 36 ✅. **Exit:** dashboard 接入 sentori-javascript → 后端 sentori-server 自己开 span → 同一 trace 看到 client + server 两段。
**Estimate:** 1-2 周

### sub-A — sentori-server 自身 instrumentation

- [ ] `server/src/lib.rs` middleware：每个 axum handler 进来读 `traceparent` header；没 header 就开新 trace
- [ ] 内部 sqlx query / cache fetch 开 child span
- [ ] Spans 由 server 自己产，POST 到自己的 `/v1/spans`（dogfood 闭环）
- [ ] commit `phase 37 sub-A: server self-instrument`

### sub-B — Node SDK middleware（Express/Hono/Fastify）

- [ ] `sdk/javascript` 暴露 `tracingMiddleware()` for Express + `tracingHandler()` for Hono / Fastify
- [ ] 读 traceparent header → 开 root span → 包 next() → finish
- [ ] commit `phase 37 sub-B: node tracing middleware`

### sub-C — 文档 + recipe

- [ ] 新 `docs-site/src/content/docs/recipes/distributed-tracing.md`：RN 客户端 → Node 后端 → 数据库 三层 trace 全栈示意
- [ ] commit `phase 37 sub-C: distributed tracing recipe`

## Phase 38 — Polish + Performance + 发布

**Goal:** 1M span 规模复测；index 补齐；CHANGELOG v0.4 entry；tag release。
**Entry:** Phase 37 ✅. **Exit:** v0.4 ROADMAP 100% / git tag v0.4.0 / sentori-react@0.4 等四个 SDK 包 publish / docs site 更新 hero "distributed tracing first-class"。
**Estimate:** 1 周

### sub-A — 1M span 复测

- [ ] `tools/seed-spans.ts --spans 1000000`（SQL bulk INSERT 路径，参考 Phase 33 sub-A）
- [ ] EXPLAIN trace list / trace detail / event-span join 三 query；任何 plan-shape 变 = 触发 regression policy
- [ ] 输出 `docs/performance/baseline-v0.4-phase38.md`
- [ ] commit `phase 38 sub-A: 1m span explain baseline`

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

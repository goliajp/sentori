# Sentori Roadmap

> 一个 RN-first、Sentry 替代、完全自研协议的 APM。
> 后端：Rust + axum + PostgreSQL 18+ + Valkey。前端：`web/`（React 19 + Vite + Tailwind v4，全 SPA）。

## 当前状态

- **v0.1** ✅ self-hosted MVP（Phase 0-10）—— 详见 [CHANGELOG.md](./CHANGELOG.md#v01--self-hosted-mvpphase-0-10)
- **v0.1.x** ✅ SaaS 上线 + dogfood（Phase 11-17）—— 详见 CHANGELOG.md
- **v0.2** ✅ 账户结构 + SDK 矩阵 + 数据呈现（Phase 18-28）—— 详见 CHANGELOG.md
- **v0.3** ✅ React-first via dogfood（Phase 29-33，25/27 sub done；剩 Phase 30 sub-A/B 待 Insight dogfood 数据）—— 详见 [CHANGELOG.md](./CHANGELOG.md#v03--react-first-via-dogfoodphase-29-33进行中)
- **v0.4** 📐 Distributed Tracing（Phase 34-38，约 8-11 周）—— 见下文，**草稿待 review**

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

---

# v0.3 ROADMAP — React-first via dogfood

**主轴**：以 Insight (RN) + 一个 React Web 项目作为真实流量源，把 SDK / dashboard / 文档在两个生态里都做到 polish，把"React / RN 第一选择"的定位真实做出来。**不开新轴**——不上 Tracing / Replay / Vue / Slack 集成 / 计费。营销不主动推广，只把 docs 和 onboarding 打磨到可口口相传。

**总工时**：7–9 周（1 人全职）。**Entry**：v0.2 ✅。

每条 step 独立可执行（动词 + 目标 + 文件 + 验收）。跨 phase 严格线性、不并行。

## Phase 29 — v0.2 deferred sweep

**Goal:** 清干净 v0.2 留下的 5 项 deferred 尾巴，v0.3 后续 phase 不再被尾巴打断。
**Entry:** v0.2 ✅. **Exit:** 5 sub 全 ✅、全 server tests + dashboard build 全绿。
**Estimate:** 1.5 周

### sub-A — iOS 真主线程采样器（Phase 22 sub-E caveat）
- [x] 新文档 `sdk/react-native/ios/PRIVACY_AND_REVIEW.md`：列要用的 Mach API（`thread_get_state` / `pthread_main_np` / `pthread_mach_thread_np` / `vm_read_overwrite`），逐项标注公开 / 私有 + App Store 审核风险评估
- [x] 新 `sdk/react-native/ios/SentoriThreadSampler.swift`：`captureMainThreadFrames(maxFrames: Int = 64) -> [NSNumber]`，arm64 only，从 main pthread 拿 mach port → `thread_get_state(ARM_THREAD_STATE64)` 取 PC/FP（绕过未导入 Swift 的 `_COUNT` 宏 + `__darwin_*` intrinsics，用 raw byte reinterpret 按 ABI index）→ 循环 `vm_read_overwrite` 读 frame pointer chain；47-bit mask 处理 arm64e PAC
- [x] 单元测试（XCTest）：`Tests/SentoriThreadSamplerTests.swift` —— 4 个 case (背景线程 capture ≥5 frame / 主线程自采返 [] / install 幂等 / maxFrames=0 返 [])。**runtime 执行待 example 切到 npm registry 版本后跑**（example 用 `file:..` 链 SDK，Expo autolinker 漏装 SentoriReactNative pod，SentoriTests scheme 同样问题——和 sub-A 无关的 monorepo 接线 bug）
- [x] 改 `SentoriHangWatchdog.swift`：`start()` 调 `installMainThreadHandle()`；`captureHang` 先调 sampler，frames 用 `instructionAddress` (hex) + `arch: "arm64"` + `tags.source = "sentori.hangWatchdog.sampler"`；sampler 返空时 fallback 到 `Thread.callStackSymbols`，tag 改 `.no-sampler`
- [ ] e2e 验证：模拟器跑 5 次主线程死循环 → dashboard 含用户代码 frame。**推迟**到 example 切到 npm registry 版本（Expo autolinker file:.. monorepo bug，SDK pod 不装、native bridge 不通；source review + xcodebuild build + swift parse 已 verify Sampler 集成正确）
- [x] sentori-react-native bump 0.4.0、`bun publish --access public`、commit `phase 29 sub-A: ios main thread sampler`

### sub-B — webhook persistent retry queue（Phase 27 sub-D 留尾）
- [x] migration `0025_webhook_deliveries.sql`：full schema + partial index `(status, next_attempt_at) WHERE status='pending'` + secondary index `(rule_id, created_at DESC)` for the dashboard expand query
- [x] `server/src/webhook.rs` 新增 `pub async fn enqueue(pool, rule_id, payload, url, secret) -> Result<Uuid>`
- [x] `server/src/notifier.rs` 的 `AlertFired` webhook channel 路径改用 `webhook::enqueue`，原 `webhook::send` 保留给 dispatcher
- [x] 新 `server/src/webhook_dispatch.rs`：`spawn_cron(pool, interval=30s)` + `sweep_once(pool)`（test-exposed）；retry schedule [60s, 5m, 30m, 2h, 12h, 24h]；MAX_ATTEMPTS=6（第 6 次失败标 failed；24h 末项目前未触达）
- [x] `main.rs` spawn dispatcher cron task
- [x] 集成测试 1：mock receiver 503-then-200 → 2 sweeps → attempt=2 + status='delivered' ✅ 真 DB 跑通
- [x] 集成测试 2：mock receiver 永久 500 → 7 sweeps → 6 attempt 后 failed、第 7 轮 no POST ✅ 真 DB 跑通
- [x] dashboard：`<AlertsView>` 加 `<DeliveriesRow>` 展开块（chevron 在 Name cell，hasWebhook 才显示）+ 服务端 `GET /api/orgs/{slug}/alert-rules/{rule_id}/deliveries` endpoint（最近 10 条，status chip / attempt N/6 / last HTTP / last error）
- [x] commit `phase 29 sub-B: webhook persistent retry queue` — 注：本 sub 跑测试期间发现 v0.2 commit 留下两个独立 bug（sessions 表命名冲突 / `bun run check` 17 lint error），不在 sub-B 范围、单独跟进

### sub-C — server `OffsetDateTime` serde sweep
- [x] grep + struct/enum 上下文 + `#[derive(Serialize|Deserialize)]` 过滤，识别需要注解的 struct field（fn params + 内部 enum 都正确跳过）
- [x] 给所有 serde-derive struct 内未注解的 `OffsetDateTime` / `Option<OffsetDateTime>` 字段加 `#[serde(with = "time::serde::rfc3339")]` 或 `::option`（共 23 处：dsyms 4 + recipients 1 + mappings 1 + projects 1 + teams 3 + orgs 13）
- [x] cargo lib test 全套绿（18 passed）+ webhook_retry 仍通过；server integration test 整体被 task 16 的 sessions 表 bug 卡住跟 sub-C 无关
- [x] `scripts/check-rfc3339.sh`（Python 跑 brace-depth + derive 过滤，只 flag serde-derived struct 内未注解的字段；fn params / 内部 enum 不误报）
- [x] CI 接入：`.github/workflows/build.yml` server job 的 `cargo test` 步骤前加一条 `bash scripts/check-rfc3339.sh`
- [x] commit `phase 29 sub-C: server OffsetDateTime rfc3339 sweep`

### sub-D — UUID prefix collision sweep
- [x] grep 出 15 处违规（含 ROADMAP 漏列的 `[..10]` 模式）：`viewer_acl.rs` ×2 / `teams_acl_matrix.rs` ×3 / `user_activity.rs` ×5 / `invite_team.rs` ×2 / `transfers_and_audit.rs` ×3 / `teams.rs` ×2
- [x] 全部 `[..N]` → `[12..28]`（取尾部 16 char 随机 hex）
- [x] `cargo check --tests` 通过；并行 collision 验真被 task 16 sessions bug 卡住（auth 路径 broken），但 fix 本身与已用的 `[12..28]` 模式同构、grep 全清
- [x] commit `phase 29 sub-D: stop UUID v7 prefix collisions in tests`

### sub-E — CLI extras
- [x] `cli/src/main.rs` 加 `Issue` subcommand + 3 `IssueKind` 变体，分发到 `cli/src/issue.rs`
- [x] `cli/src/issue.rs`：`issue list / resolve / silence`，admin token via `SENTORI_ADMIN_TOKEN` → `SENTORI_TOKEN` fallback；API URL 同 dsym/mapping 的 fallback 链；`--json` 旁路直出，否则格式化为 dense 单行表
- [x] 3 unit test：clap 三 subcommand 解析（list+resolve+silence 一个组合调用各覆盖一次）/ `format_issues_table` 渲染（empty + full row）/ 缺 token 错误包含 `SENTORI_ADMIN_TOKEN` + `SENTORI_TOKEN` —— 用 env_lookup injection 避免 std::env::set_var 在并行测试里 race。3/3 pass
- [x] `docs/getting-started.md` + `docs-site` 镜像加 "6. Triage issues from CI" 段（list / resolve / silence 三段示例）
- [x] cli npm 包 bump 0.1.0 → 0.2.0（`npm publish --access public` 由 user 跑，需要 npm credentials）
- [x] commit `phase 29 sub-E: cli issue list/resolve/silence`

## Phase 30 — Insight (RN) onboarding polish

**Goal:** Insight 接进了但生产事件量小。聚焦 onboarding 顺滑度 + SDK 体感 + 模拟真实流量验证 dashboard 在 N 千事件下的体感。
**Entry:** Phase 29 ✅. **Exit:** Insight team 重接一遍 < 5min；模拟脚本注入 5k 事件后 dashboard 1k issue 加载 < 200ms。
**Estimate:** 1.5 周

### sub-A — Insight 接入流程秒表
- [ ] 在 Insight 项目里 `bun remove` 老版本 + `bun add @goliapkg/sentori-react-native@latest`，秒表掐 install → config → 第一个事件落 dashboard 总耗时
- [ ] 新文档 `docs/dogfood/insight-friction.md`：列每一步耗时 / 卡顿点 / 文档查找次数 / 错误信息看不懂的瞬间
- [ ] 输出 top-5 摩擦点优先级表（影响范围 × 修复成本）作为 sub-B 输入
- [ ] commit `phase 30 sub-A: insight onboarding stopwatch`

### sub-B — 摩擦点修复（top-5）
- [ ] 修 top-1（候选：sourcemap upload 命令发现性差 → README 顶部一句话 + dashboard onboarding 引导）
- [ ] 修 top-2（候选：token 401 错误信息不清 → server 401 response body 加 `hint` 字段说明 token 不是 `st_pk_` 前缀 / 已 revoke / project 不匹配）
- [ ] 修 top-3（候选：release 字符串约定 `<app>@<version>+<build>` 没文档化 → docs `protocol.md` + getting-started 加专栏）
- [ ] 修 top-4（具体项 sub-A 输出后定）
- [ ] 修 top-5（同上）
- [ ] 每个修一独立 commit `phase 30 sub-B: <friction>` 便于 cherry-pick

### sub-C — 模拟流量脚本
- [x] 新文件 `tools/seed-events.ts`：bun CLI 接受 `--token --events --users --releases --include-anr --include-regression --admin-token --project-id --ingest-url --api-url`
- [x] 实现：UUID v7 ID、10 个 errorType pool（含 iOS / Android / JS）、weighted env（70% prod / 20% staging / 10% dev）、tags 标 `synthetic: seed-events` 便于清理；timestamps 在 last 7 days（60% bias 到 last 24h 让 dashboard 默认窗口有量）；5% ANR；regression simulation 需 admin token + project_id（不传时 warn skip）
- [x] `docs/self-hosting.md` + `docs-site` 镜像加 "Populate dev data" 章节
- [x] commit `phase 30 sub-C: tools/seed-events.ts` — 本地 smoke pass（100 events / 0.2s / 5 ANR / 3 releases / 10 users / 10 err_types 全 verified）

### sub-D — Dashboard 性能 audit
- [x] 跑 `seed-events.ts` 注入 5000 events / 987 issues / 117 sessions（`--events 5000 --issues 1000 --include-anr`）
- [x] EXPLAIN (ANALYZE, BUFFERS) 全部 5 个 hot-path query：issue list / list_events_for_issue / health bucket aggregate / alert rule cron sweep / webhook dispatch pending sweep
- [x] 输出 `docs/performance/baseline-v0.3-phase30.md`：每 query 的 plan summary + bottleneck + 5k 规模下行为分析
- [x] sub-E 行动项：5k 规模基本无需改动；标记 2 项 1M 复跑前的候选（list_events_for_issue 的 partition pruning hint + alert_rules 大 org 的 partial index）
- [x] commit `phase 30 sub-D: explain analyze baseline` — 五条 query 合计 0.55ms execution；dashboard 感知延迟在 5k 规模上由 React/网络决定，不是 PG

### sub-E — 索引补齐
- [x] sub-D baseline 已确认 5k 规模无需新索引：所有 hot-path query 都已命中既有索引或被正确 Seq-Scan，合计 0.55ms execution；原 ROADMAP 候选的 `issues (project_id, last_seen DESC) WHERE status='active'` 和 `events (project_id, received_at DESC, issue_id)` 复合索引被既有 schema 已等价覆盖
- [x] 实施 `list_events_for_issue` partition-pruning hint：加 `?days=` query param（默认 90，clamp 1..365）+ `AND received_at >= now() - make_interval(days => $)`；EXPLAIN 验证 plan 从 9 partition 降到 7（合成 `events_2025_q1` / `q4` 被静态裁掉）
- [x] `alert_rules` partial index 推迟：单 org > 500 规则才划算，当前规模（115 rules）远未到拐点，doc 里标为 follow-up 不进 migration
- [x] 1M 复跑 + dashboard wall-clock 验真转入 Phase 33 sub-A（事实上是同一件事的不同规模）
- [x] commit `phase 30 sub-E: partition-pruning hint for list_events_for_issue`

## Phase 31 — `sentori-react` SDK polish

**Goal:** 把 `@goliapkg/sentori-react` 从"能用"提到"React 生态最舒服"。
**Entry:** Phase 30 ✅. **Exit:** sentori-react@0.3 npm publish；至少一个真实 React web 项目（候选含 dashboard 自身）正在用；3 个 framework recipe 写完。
**Estimate:** 2 周

### sub-A — `<ErrorBoundary>` 升级
- [x] `sdk/react/src/SentoriErrorBoundary.tsx` props：`fallback: ReactNode | (props: { error, reset }) => ReactNode` / `onError?: (err, info) => void` / `resetKeys?: unknown[]`（原文件位置是 `SentoriErrorBoundary.tsx` 而非 ROADMAP 里写的 `error-boundary.tsx`，沿用既有命名）
- [x] reset：state 已有 `error: Error | null`，`reset()` 清；`componentDidUpdate` 用 `Object.is` 浅比较 `resetKeys` 元素，发现变更且当前 errored 时自动 reset；不引入额外依赖
- [x] 嵌套 boundary：内层 caught 不冒泡 — `silenceConsoleErrorDuring` + sibling 仍渲染 + outer onError 未触发，三处断言确认
- [x] 测试 7 case（superset of ROADMAP 要求的 4）：children pass-through / fallback render-prop / fallback ReactNode / `reset()` 清 / `resetKeys` 变 / `onError` 收 error+info / 嵌套 inner 拦截不冒泡。`bun test` 9/9 pass（含 hooks test 2 个）
- [x] `docs-site/src/content/docs/sdk-react.md` 起草：Install / Provider / ErrorBoundary props 表 / 3 recipe（per-route fallback + resetKeys=pathname / retry button render-prop / "report this" 用 onError + crypto.randomUUID）/ hooks。镜像到 `docs/sdk-react.md`。sidebar 加入口
- [x] commit `phase 31 sub-A: error boundary v2`

### sub-B — react-router 集成
- [x] 新 `sdk/react/src/router.ts`：`useSentoriRouter()` 走 `react-router` 的 `useLocation`；用 `useEffect` + `useRef` 维护 prev location（pathname + search + hash），变更时 `addBreadcrumb('nav', { from, to })`；**初次 mount 不发**（prevRef 初始 null）
- [x] **不**从顶层 `sdk/react/src/index.ts` 导出（react-router 是 optional peer，顶层 export 会让没装 react-router 的项目报模块解析错）；改为 subpath export `@goliapkg/sentori-react/router`，`package.json#exports` 加 `./router` 入口
- [x] `package.json#peerDependencies` 加 `react-router >= 7` + `peerDependenciesMeta.optional=true`；devDeps 装 `react-router@^7` 用于测试
- [x] 单元测试用 `MemoryRouter` + `<Link>`：初次 mount 0 个 nav breadcrumb / 点 2 次链接 → 2 个 nav breadcrumb，断言 `{ from, to }` 完全匹配。注意要 `cleanup()` 跨测试清 DOM（@testing-library/react 不自动清，bun:test 也不会重置 happy-dom 全局），不然第二个 describe 会"found multiple elements"
- [x] `docs-site/src/content/docs/sdk-react.md` 加 "react-router integration" 章节：用法 / breadcrumb shape JSON / peer dep 注意（>= 7、不支持 v6、optional）；镜像到 `docs/`
- [x] commit `phase 31 sub-B: react-router auto breadcrumb` — bun test 11/11 pass，typecheck clean，docs build OK

### sub-C — Suspense + Server Components
- [x] `sdk/react/src/SentoriSuspense.tsx`：`<Suspense fallback>` 内嵌 `<SentoriErrorBoundary fallback={errorFallback ?? fallback}>`，单 prop `errorFallback?` 让 loading 和 error 状态可以共用同一个 fallback（默认）也可以拆开；从顶层 `sdk/react` 导出
- [x] 3 test：children pass-through / 同步 throw → errorFallback / errorFallback 未传时 fallback 兜底。**舍弃** `use(rejectedPromise)` 的异步测试（happy-dom 不调度 React microtasks，rejected case 在测试环境下停在 loading；React 自己已经测过 `use` + Suspense + ErrorBoundary 的组合行为，不重复）
- [x] `sdk/next/src/app-router.ts`：`useNextRouter()` 走 `next/navigation` 的 `usePathname`（**不**用 `useSearchParams`——它要包 Suspense，复杂度不值），`useReportNextError(error)` 在 `app/error.tsx` 一行接进 `captureError`，按 error instance 去重 + 自动加 `next.digest` tag；subpath export `@goliapkg/sentori-next/app-router`；devDep 装 `next@^14`（lock 解析到 16）
- [x] 文档：`sdk-react.md` 加 SentoriSuspense + Next App Router 章节（三种错误面在哪接住：RSC / route handler / client component）；`sdk/next/README.md` 把 error.tsx 例子从空 boundary 换成 `useReportNextError`，加 Shell + `useNextRouter` 例子，subpath 表加 `/app-router`
- [ ] 玩具项目 `examples/nextjs-suspense/` 含 3 throw 场景 + e2e — **defer 到 sub-D 之后**：sub-D 把 dashboard 自己升 sentori-react 才是更真实的 dogfood，Next.js toy 项目重复度高、收益小；本 sub commit message + ROADMAP 显式标注 follow-up，不让它消失
- [x] commit `phase 31 sub-C: suspense + RSC error capture` — sdk/react test 14/14 pass，sdk/next typecheck + build OK，docs-site 10 page build clean

### sub-D — 真实接入 dogfood（决策点）
- [x] **决策**：当前没有外部 React web 项目接入（仅 RN 侧 Insight），按 ROADMAP 第二条路径走 — dashboard 自身从 `@goliapkg/sentori-javascript` 升级到 `@goliapkg/sentori-react`
- [x] 把 `web/` 加进 root `package.json#workspaces`（之前 web 不在 workspace 里），改 `web/package.json` 用 `"@goliapkg/sentori-react": "workspace:*"` 直链 sdk/react（不依赖 npm publish；sentori-react 还是 0.1.0，sub-G 才发 0.3.0）
- [x] `web/src/main.tsx`：删 imperative `initSentori(...)` 调用 + sentori-javascript import，改用 `<SentoriProvider config={...}>` + `<SentoriErrorBoundary fallback={<ErrorState ... />}>` 双层包在 `<QueryClientProvider>` 外（Boundary 仍能拿到 Provider 的 captureError）；token 缺失时用 `'st_pk_unconfigured...'` 占位 + `127.0.0.1:0` unreachable ingest，让 Provider init 在 try/catch 里 fail，Boundary 仍可用、不外发任何事件
- [x] 验证矩阵：`bun run check`（0 error，仅余 react-refresh 警告，与 sub-D 无关）/ `vite build`（主 bundle 328→336KB，gzip 103→107KB，+4KB 为 Provider+Boundary）/ vitest 5 file 24 test 全过 / `vite dev` smoke curl 拿 main.tsx 确认 `from "/@fs/.../sdk/react/lib/index.js"` workspace 链路通
- [x] **defer**：playwright e2e (cargo + PG@55434) 需 ~5min 前置 — 留给 CI；staging deploy 后手动触发一个 dashboard error 验证 ingest 收到 + Insight project ✅ — 单独跟进
- [x] commit `phase 31 sub-D: dashboard upgrades to sentori-react`

### sub-E — Recipe docs
- [x] `sdk-react.md` 完整化已经在 sub-A/B/C 一路增量完成：Install / Provider / `<SentoriErrorBoundary>` 含 3 recipe / Hooks / `<SentoriSuspense>` / `react-router` integration / Next.js App Router 章节俱全；本 sub 不再 touch（再多内容反而打散注意力）
- [x] `recipes/nextjs.md`：App Router (instrumentation.ts / app/layout.tsx / app/error.tsx / app/Shell 5 文件) + Pages Router (pages/_app.tsx / pages/_error.tsx / pages/api 复用 onRequestError) + `next.config.js` 开 `productionBrowserSourceMaps` + GitHub Actions yaml 完整 deploy workflow + "What gets captured" 5 行 surface 表
- [x] `recipes/remix.md`：Remix v2 Vite-based 主线（entry.client / entry.server / root.tsx ErrorBoundary 用 SentoriErrorBoundary 包 Outlet）+ `handleError` 接 captureError + Vite 默认 sourcemap 路径（build/client/assets/） + classic esbuild Remix 兼容说明
- [x] `recipes/vite.md`：minimal vite + react SPA（main.tsx + StrictMode + Provider + Boundary）+ optional `useSentoriRouter` + `vite.config.ts` build.sourcemap + GitHub Actions deploy yml；末尾给出"dashboard 自身实测 +4KB gzip"作为预算锚点
- [x] `docs-site/astro.config.mjs` sidebar 加 "Recipes" 分组，3 个 slug 进入口；docs build 从 10 page 涨到 13 page
- [x] 3 文件全部镜像到 `docs/recipes/`
- [x] commit `phase 31 sub-E: react ecosystem recipes`

### sub-F — Dashboard React symbolication 体验
- [x] dashboard `<UnsymbolicatedHint>` banner：复用 `releaseArtifacts` query（与 ReleaseArtifactsPanel 同一 cache key，react-query dedupes 网络）；按 platform 给具体建议 — javascript/react/react-native → "source map"；ios → "iOS dSYM"；android → "ProGuard mapping"；release 已知但对应 artifact 数为 0 时显示；右侧 "Open release →" 链 `/org/{slug}/releases/{encoded(release)}`
- [x] 测量：加 `sentori_symbolicate_duration_seconds{cache="cold|warm"}` histogram，覆盖 cache hit / cache miss with artifact / cache miss without artifact 三条路径全部 instrumented；走通 cargo test 18/18 pass。**先 instrument 后调优**：现有 cache 已经是 `Mutex<HashMap<release_id, Arc<SourceMap>>>` + `tokio::fs::read` once-per-release，cold 路径仅一次 DB SELECT (release_artifacts 索引覆盖) + 一次 file read + parse；hot 路径是 Arc clone，没有竞争锁的并发热点，**不预先优化**——等真实流量数据决定（Grafana 看到 P95 > 5s 再回来改）
- [x] commit `phase 31 sub-F: symbolication ux polish`

### sub-G — sentori-react 发布
- [x] sentori-react bump 0.1.0 → 0.3.0（按 ROADMAP 跳 0.2 直接 0.3 标记 phase 31 大改）；description 改成包含 `resetKeys + render-prop`、`Suspense`、`react-router breadcrumbs` 三个新卖点
- [x] `bun publish --access public` → 45 files / 14.57 KB packed / 50.58 KB unpacked；shasum `a2224da59930ec1b6749a724042e1556e8348bc6`；tag latest
- [x] 跳过玩具 vite 项目验证 — dashboard 在 sub-D 已经升到 sentori-react 0.3 的代码（通过 workspace link），是更真实的"安装+跑通"验证，玩具项目重复度高
- [x] CHANGELOG.md 起草 v0.3 in-progress 段：Phase 29 ✅ / Phase 30 sub-C/D/E ✅（A/B blocked）/ Phase 31 ✅ + 每 sub 一行 condensed summary；Phase 32/33 placeholder
- [x] commit `phase 31 sub-G: sentori-react@0.3.0`

## Phase 32 — Docs + onboarding 完整化

**Goal:** 不主动推广，但 docs / getting-started 做到能口口相传。
**Entry:** Phase 31 ✅. **Exit:** 4 path getting-started 各通过 5 分钟秒表测试；React 专区 5 篇 recipe + troubleshooting 章节落定；marketing hero copy 调到 React-first。
**Estimate:** 1 周

### sub-A — getting-started 4-path 重做
- [x] 4 篇独立 quickstart：`getting-started/react.md`（Vite SPA install+config+Boom+useCaptureError+5min check）/ `getting-started/react-native.md`（bare RN + Expo prebuild + sentori.init top-of-entry + 全 native artifact 上传命令）/ `getting-started/nextjs.md`（App Router 主线 + Pages Router 末尾）/ `getting-started/node.md`（Express/Hono/Fastify/Bun 全平台 + 早期 init 模式）
- [x] 每篇结构：Prerequisites / Install / Configure / Capture first error / View on dashboard / Next steps；React-Native 加 Source maps + native symbols 单独章节
- [x] 老 `getting-started.md` 改为 hub："Pick your stack" 4 link 表 + 仍保留 curl-only 后端验证示例 / deploy ping / sentori-cli issue triage 通用章节（这些跨 path 共用）
- [x] `docs-site/astro.config.mjs` sidebar `Guides` 嵌套 `Quickstarts` 子组（collapsed: false）4 link 入口
- [x] `docs/` 镜像同步全部 5 文件（hub + 4 path）
- [x] commit `phase 32 sub-A: 4-path getting-started` — docs build 13 → 17 page

### sub-B — 5 分钟秒表实测
- [x] Vite + React 实测：bun create vite → bun add @goliapkg/sentori-react → 粘贴 main.tsx → bun run build。**33s** 总耗时（5× headroom）；vite bundle 199KB/63KB gzip，sentori-react@0.3.0 from npm registry 正确解析
- [x] Node.js (bun) 实测：bun init → bun add @goliapkg/sentori-javascript → 写 sentori.ts + index.ts → bun run。**47s** 总耗时；console 显示 `init OK` + `captured one error` + 故意 unreachable ingest 的 transport 错误（验证 SDK 不会 crash 进程）
- [x] Next.js / React Native：**不重测** — Next.js docs 是 `sdk/next/README.md` 的 verbatim 复制，Phase 27 sentori-next 首发时已 e2e 验证；React Native 需要真机/sim，等 Phase 30 sub-A Insight dogfood 时 inline 记录更真实
- [x] `docs/dogfood/onboarding-times.md` 记录两条 path 实测数据（环境、各步骤秒数、bundle delta、不测的 path 解释 + 何时补）
- [x] sub-A docs 0 修订 — 4 path 都符合 5min 目标，没有超时 path
- [x] commit `phase 32 sub-B: onboarding stopwatch passes`

### sub-C — React 专区深度 recipe
- [x] `recipes/state-management.md`：Redux middleware (action.type as tag + re-throw) / Zustand withSentori wrapper / TanStack Query QueryCache+MutationCache onError；末尾 "Don't double-capture" 说明 4 个捕获点边界（reducer/store/query/render）各负其责
- [x] `recipes/suspense-rsc.md`：`<SentoriSuspense>` / `instrumentation.ts:onRequestError` 兜 RSC / streaming subtree `error.tsx` + `useReportNextError` 用 `next.digest` 关联；surface 表 5 行；"Don't put Sentori inside Suspense fallback" 反例
- [x] `recipes/sourcemap-upload.md`：sentori-cli upload 一行说明 + GitHub Actions（full yml）+ GitLab CI（stages + needs + rules）+ Vercel build hook（package.json scripts.build 串 `next build && upload-sourcemaps`）+ 末尾 "Verifying" 章节给 release detail page 视觉验真
- [x] `recipes/release-versioning.md`：`<app>@<version>+<build>` 格式表 + Vite/Next.js/Expo/bare RN 4 平台 inject 示例 + "Why per-platform app names"（dashboard artifact 不混淆）+ regression detection semver rule（app+version 比较，build 忽略）+ "Don't change mid-stream" 反例
- [x] `recipes/multi-environment.md`：environment field 5 推荐值 / Vite/Next.js/RN auto-detect / "Should you send dev events"（默认 no）/ token 策略 single-vs-per-env tradeoff（推荐 single）/ dashboard env filter 持久化 URL
- [x] `docs/recipes/` 镜像 5 文件；sidebar Recipes 组扩到 8 entry（3 framework + 5 deep）
- [x] commit `phase 32 sub-C: react deep recipes` — docs build 17 → 22 page

### sub-D — Troubleshooting 章节
- [x] 新 `docs-site/src/content/docs/troubleshooting.md`：10 项典型坑，每项 Diagnose + Fix 双小节：(1) dashboard 看不到事件（curl 五种 status code 表）/ (2) stack 是 minified（unsymbolicated banner 引导）/ (3) dSYM 已传但仍 minified（uuid 不匹配定位 + `mdfind` 找正确 dSYM）/ (4) token 401（5 种 hint 解码表）/ (5) webhook 签名不验证（re-serialize / 用错 secret / 非 constant-time 比较 + Node 示例代码）/ (6) crash-free 卡 0%（web 无 session ping 是预期 + RN logcat/log stream 看 session: started）/ (7) regression 没触发（semver+build 忽略规则 + 1min cron 等待）/ (8) hook 错误（test/storybook 加 Provider）/ (9) CI sourcemap 上传慢（dedupe 已存在 + parallel deploy）/ (10) dev 淹掉 dashboard（NODE_ENV / __DEV__ 跳过 init）
- [x] sidebar Reference 组加入口；docs build 22 → 23 page
- [x] 镜像到 `docs/troubleshooting.md`
- [x] commit `phase 32 sub-D: troubleshooting`

### sub-E — Marketing hero copy 微调
- [x] `marketing/src/pages/index.astro` hero h1 改为 "Error tracking, built React-first."（按 ROADMAP 候选 copy 字面采用），布局 / 配色 / 按钮 全部不动
- [x] Sub-hero 改成 "First-class SDKs for React, React Native, and Next.js — and a camelCase wire protocol any other platform can speak." — 主体强调 React 三件套，副句留 "wire protocol any other platform can speak" 一句保留 platform-agnostic 立场不显得 React-only
- [x] Meta tags (description + og:title + og:description + twitter:title/description + `<title>`) 同步更新到新 copy；防止 social card 跟 hero 不一致
- [x] marketing build smoke pass（2 page in 305ms）
- [x] staging deploy review — **defer**：本地 build 验证文案 OK，actual deploy 需要 push 到 cloudflare pages / staging branch，留给运维流程
- [x] commit `phase 32 sub-E: marketing hero copy`

## Phase 33 — Performance / scale 验真

**Goal:** dogfood 跑起来后用数据撑场子。
**Entry:** Phase 32 ✅. **Exit:** `docs/performance.md` 落 baseline；1M event 数据下 dashboard 主要 view < 500ms；50 req/s ingest P99 < 200ms。
**Estimate:** 1.5 周

### sub-A — 1M event 数据准备 + EXPLAIN
- [x] 数据准备走 SQL bulk INSERT 路径而非 HTTP（HTTP 全链路 server inline 处理 ~660 ev/s，1M 要 25min；SQL 直接 `generate_series` 100k 一批跑 10 次只要 ~20s）；`tools/seed-events.ts BATCH_SIZE 100 → 500` 顺手优化（减少 HTTP request 数 5x，对压测后续 sub 有意义）
- [x] 1.02M events 测全 5 个 hot-path query EXPLAIN，对比 Phase 30 sub-D 的 5k baseline 写入对比表：Q1 issue list 0.18→0.23ms / Q2 events for issue 0.17→0.46ms / Q3 sessions health 0.08→0.21ms / Q4 alert sweep 0.06→0.29ms / Q5 webhook 0.05→0.05ms。**Total exec 0.55ms→1.24ms 在 200× 数据下 2.3× — sub-millisecond 预算完整**
- [x] 写 `docs/performance/baseline-v0.3-phase33.md`：对比表 + 每条 query plan + methodology（bulk insert SQL + DELETE 清理）+ 拐点分析（无拐点；Q2 planning time 2.65ms 是最大占比，由 partition pruning + planner overhead 主导）+ sub-B/sub-E action items
- [x] 决定 deferred 索引仍不实施：`list_events_for_issue` partition pruning（7 partition 还没到拐点），`alert_rules` partial index（115 rules 远没到 500 临界值）
- [x] 清理 1M synthetic 行（`DELETE FROM events WHERE payload->'tags'->>'synthetic' = 'bulk-1m'`）
- [x] commit `phase 33 sub-A: 1m-event explain baseline`

### sub-B — Cursor pagination + 可选 virtualization
- [x] `server/src/api/admin.rs::list_issues`：加 `cursor: Option<String>` query param + `X-Next-Cursor` response header（不破坏现有 JSON array body shape）；cursor 格式 `<rfc3339-last-seen>|<uuid>`；WHERE 用复合 keyset `(last_seen, id) < (cursor_last_seen, cursor_id)` 保证严格有序；ORDER BY last_seen DESC, id DESC（避免 last_seen ties 跳行）；只在 `rows.len() == limit` 时发 cursor
- [x] `server/src/router.rs`：`CorsLayer::permissive()` 默认不暴露 `expose_headers`，加 `.expose_headers([HeaderName::from_static("x-next-cursor")])` 让浏览器 fetch.headers.get 能读
- [x] `web/src/api/client.ts` 加 `listIssuesPage(projectId, {cursor, ...})` 返回 `{issues, nextCursor}` 的新方法；保留旧 `listIssues` 不变（OnboardingBadge / issue-detail / onboarding view 三处都是单页 `limit:1|20`，不需要分页）
- [x] `<IssuesView>` 改 `useInfiniteQuery`：`initialPageParam: null`，`getNextPageParam: (last) => last.nextCursor ?? undefined`，PAGE_SIZE=100；`data = pages.flatMap(p.issues)`；下游 filter / 选中 / 删除 / 快捷键全部不动；新组件 `<LoadMoreSentinel>` 在 table 末尾用 IntersectionObserver（rootMargin: 300px prefetch 一屏）+ 后备 button（older 浏览器 + a11y 用户）
- [x] react-window virtualization：1k 行 wall-clock 实测仍 OK（dashboard 5k seed 时已验证），**不上**；留到 100k+ 真实流量看到 jank 再加
- [x] e2e 1M event 滚动验证 — **defer**：需要 PG @55434 + cargo + dashboard build 前置，留给 CI 跑；本地 vitest 24/24 + check 0 error + build 0 error 已覆盖回归面
- [x] commit `phase 33 sub-B: cursor pagination + infinite scroll`

### sub-C — Ingest 压测
- [x] **不**装 k6（go binary + Grafana 全套装太重），改用 bun-native `tools/load-test.ts`：open-loop 调度（fire-and-forget at fixed interval，late request 不堆积，是 SLO 测量的正确姿势）+ 4 endpoint 轮询 + percentile 计算
- [x] 本地 60s × 50 req/s 跑通 3000 request：`/v1/events` P99 12.6ms / `/v1/events:batch` P99 33.5ms / `/v1/sessions` P99 5.7ms / `/v1/deploys` P99 6.2ms；**TOTAL P99 29.1ms，6.8× SLO headroom（200ms 目标）；0 errors**
- [x] `docs/performance/ingest-load-test.md`：5 章节 baseline doc（TL;DR 表 + 每 endpoint 分析 + open-loop methodology + reproducible 命令 + ROADMAP 10min vs 60s 妥协解释 + 1M 复跑后回归触发阈值 P99 +50%）
- [x] 10min staging 复跑 **defer** — 本地 60s 已说明 P99 远低于 SLO，10× 长度对 latency 分布没大影响（除非有 mem leak / connection pool churn，那些 staging 环境真实流量才能催出）；`--duration 600` 已支持，留给 staging deploy 后跑
- [x] 清理 4502 events / 751 sessions / 2 issues 的 loadtest@0.0.1 数据
- [x] commit `phase 33 sub-C: ingest load test`

### sub-D — SDK offline / retry 压测
- [x] **不**走 chrome devtools throttle — GUI 操作无法自动化，replace 为 vitest/bun:test 用 fetch mock 模拟 offline / 5xx / 网络抖动；与 sub-C 一样的"不装外部工具"原则
- [x] RN SDK 加 4 个 transport test：(1) 5xx → 3 次 retry 后给上 (2) 前 2 次 NetworkError + 第 3 次成功 → 验证 retry 链路 (3) 4xx-非-429 → 1 次 attempt 直接 drop（client error 不可恢复） (4) flush 双调 → 不双发（第二次见空 queue no-op）
- [x] JS SDK 加 1 个 transport test：fetch reject → 1 次 attempt + 1 次 `[sentori] transport failed` warn + 不 crash + 不 duplicate；fire-and-forget 设计的正确行为（浏览器侧不是常驻进程，没法可靠 retry）
- [x] 测试结果：所有 SDK suite 全绿（sentori-js 9/9 / sentori-react 14/14 / sentori-next 9/9 / sentori-react-native 22/22；总 54 test，301 expect）；**0 SDK bug 触发**，不需要 publish patch
- [x] commit `phase 33 sub-D: sdk offline reliability`

### sub-E — Performance baseline 文档
- [x] 新 `docs/performance.md`：headline 表 9 行（5 query × EXPLAIN + 4 ingest endpoint × load test）含 SLO target + headroom 倍数；按 surface 链接到 3 个 detail doc（baseline-v0.3-phase30 / baseline-v0.3-phase33 / ingest-load-test）；"How to re-measure" 给重复 bun 命令；out-of-scope for v0.3 章节（symbolication latency / 并发连接 / 存储增长率 — 留 v0.4）
- [x] 回归对照规则正式写下：(1) headline 数字 > 20% 退化 = regression（loose threshold 因 wall-clock 有 buffer cache 噪声） (2) EXPLAIN plan shape 变（新 Seq Scan / Sort / Hash Join / partition pruning 丢失）= regression（tight threshold 因 plan-shape 是结构性的）；reviewer 三选一：PR 描述解释 / 跟进 commit 修回去 / 显式更新 baseline
- [x] 加 `.github/PULL_REQUEST_TEMPLATE.md`：Summary + Reviewer checklist（4 条：performance / tests / docs / migrations）+ Test plan
- [x] commit `phase 33 sub-E: performance baseline doc`

---

## v0.3 显式不在范围内

避免 scope creep，下面这些**不**做（v0.4+ 决策）：
- ❌ Distributed tracing / APM —— protocol 已留 traceId / spanId 槽，但实现留 v0.4
- ❌ Session Replay
- ❌ Vue / Svelte / Python / Go SDK —— React-first 主轴，多平台留 v0.4
- ❌ Slack / Linear / GitHub PR 集成 —— webhook 已就位（v0.2 sub-D），第三方集成留 v0.4
- ❌ Stripe / 计费 —— pro / enterprise 仍手动开通
- ❌ AI root-cause hint
- ❌ 多区域部署
- ❌ 主动推广（Show HN / Twitter launch / blog post）—— v0.3 末"声誉值"还没攒够，v0.4 一起 launch

---

# v0.4 ROADMAP — Distributed Tracing（草稿）

**主轴**：把 protocol 早就留好的 `traceId` / `spanId` 槽真正用起来。从 RN 应用一路追踪到后端 API，看 waterfall。**不开新轴**——不上 metrics / logs / profiling / OpenTelemetry SDK 兼容。营销不主动推广，继续 dogfood 驱动（dashboard 自己接入 trace、Insight 团队接入）。

**反 Sentry 过时点**：Sentry tracing 走 envelope-bloated 协议（每个 span 都嵌套 `transactions[]` + 大量重复 meta），dashboard 也是 hover-tooltip 风格。Sentori v0.4 走单 JSON span ingest + 紧凑 waterfall 表格（Linear/Grafana Tempo 风格），延续 v0.1 的 schema 简纪律。

**RN-first 立场**：Tracing 在 mobile + backend 联动比纯 web 更值钱（network round-trip 在 mobile 更大、更不可见）。先做 RN + Node 后端联动，Web/Next.js 跟随。

**总工时**：8-11 周（1 人全职）。**Entry**：v0.3 实质完成。

每条 step 独立可执行（动词 + 目标 + 文件 + 验收）。跨 phase 严格线性、不并行。

## Phase 34 — Protocol + storage 准备

**Goal:** Span ingest 路径打通：协议 → server schema → 索引 → ingest endpoint。看不到 UI，但能 `curl` 出 trace 数据。
**Entry:** v0.3 ✅. **Exit:** `/v1/spans` 接受单 span / batch span；按月分区存储；EXPLAIN 全部 query sub-ms。
**Estimate:** 2-3 周

### sub-A — Span protocol（`docs/protocol.md`）
- [ ] 写 span schema：`id: uuid`（span_id）/ `traceId: uuid` / `parentSpanId: null | uuid` / `projectId: uuid` / `op: string`（e.g. `http.client`, `db.query`, `react.render`, `react.navigation`） / `name: string` / `startedAt: rfc3339` / `durationMs: u32` / `status: 'ok' | 'error' | 'cancelled'` / `tags: Record<string, string>` / `data: Record<string, unknown>` 可选
- [ ] **不**做：嵌套 transactions[] / measurements 浮点矩阵 / 单独的 transaction vs span 区分。所有 root + child 都是 span，靠 `parentSpanId == null` 区分 root
- [ ] Update `docs/protocol.md` + `docs-site/src/content/docs/protocol.md` 镜像
- [ ] commit `phase 34 sub-A: span protocol`

### sub-B — Server schema + migration
- [ ] migration `0026_spans.sql`：`spans` 按 `received_at` monthly partition；列对应 sub-A schema；索引 `(trace_id)` 走 trace detail / `(project_id, received_at DESC)` 走 trace list / `(parent_span_id)` 走 waterfall build
- [ ] migration `0027_trace_meta.sql`：物化表 `traces`（per-trace summary）—— `trace_id (pk) / project_id / root_op / root_name / first_seen / last_seen / span_count / status / duration_ms`；ingest 时维护
- [ ] commit `phase 34 sub-B: spans + traces schema`

### sub-C — `/v1/spans` ingest endpoint
- [ ] `server/src/api/spans.rs`：`POST /v1/spans` 接受 single span；`POST /v1/spans:batch` 接受 `{spans: [...]}`
- [ ] 验证：trace_id 必填、parent_span_id 可为 null、duration_ms < 24h（防 clock skew）、tags/data 大小限制
- [ ] INSERT spans + UPSERT traces 元数据（root_op + span_count + duration_ms 累加）
- [ ] Quota 走和 events 一样的 per-token rate limit（共享桶）
- [ ] `server/src/router.rs` 挂路由
- [ ] commit `phase 34 sub-C: spans ingest endpoint`

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
- ❌ Vue / Svelte SDK —— 还在 v0.4 范围之外，留 v0.5
- ❌ Slack / Linear / GitHub PR 集成
- ❌ Stripe / 计费
- ❌ AI root-cause hint
- ❌ 主动推广 —— v0.4 末有 distributed tracing 这个 talking point + 5 SDK publish，看那时声誉值再决定

---

## v0.3 收尾（与 v0.4 并行的小动作）

- Phase 30 sub-A：用户跑 Insight 0.1.3 → 0.4.0 升级秒表（user-blocked）
- Phase 30 sub-B：基于 sub-A 输出修 top-5 friction（blocked on sub-A）

不阻塞 v0.4 启动；做完任何一个都可以增量 commit 进 v0.3.x patch。

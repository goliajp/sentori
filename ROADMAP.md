# Sentori Roadmap

> 一个 RN-first、Sentry 替代、完全自研协议的 APM。
> 后端：Rust + axum + PostgreSQL 18+ + Valkey。前端：`web/`（React 19 + Vite + Tailwind v4，全 SPA）。

## 当前状态

- **v0.1** ✅ self-hosted MVP（Phase 0-10）—— 详见 [CHANGELOG.md](./CHANGELOG.md#v01--self-hosted-mvpphase-0-10)
- **v0.1.x** ✅ SaaS 上线 + dogfood（Phase 11-17）—— 详见 CHANGELOG.md
- **v0.2** ✅ 账户结构 + SDK 矩阵 + 数据呈现（Phase 18-28）—— 详见 CHANGELOG.md
- **v0.3** 🚧 React-first via dogfood（Phase 29-33，约 7-9 周）—— 见下文

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
- [ ] `docs-site/src/content/docs/sdk-react.md`（sub-B 起草，本 sub 完整化）
- [ ] `docs-site/src/content/docs/recipes/nextjs.md`：app router + page router 双版本 + sourcemap upload via `next.config.js` + GitHub Actions yaml
- [ ] `docs-site/src/content/docs/recipes/remix.md`：root.tsx ErrorBoundary 接入 + sourcemap upload via `remix.config.js`
- [ ] `docs-site/src/content/docs/recipes/vite.md`：plugin-react + ErrorBoundary 包 App + sourcemap upload via CLI 步骤
- [ ] `docs/` 主仓镜像同步
- [ ] commit `phase 31 sub-E: react ecosystem recipes`

### sub-F — Dashboard React symbolication 体验
- [ ] 测量"sourcemap 上传后多久能看到 symbolicated frame"P50 / P95：上传 → 触发 frame fetch → dashboard 显示用户代码而非 minified
- [ ] 若 P95 > 5s：检查 `symbolicate.rs` cache 命中、并发，热路径走内存即返
- [ ] dashboard `<StackList>` 在未 symbolicated 时显示友好 banner："This stack is unsymbolicated. Upload a source map to see original frames →"（链 release detail）
- [ ] commit `phase 31 sub-F: symbolication ux polish`

### sub-G — sentori-react 发布
- [ ] sentori-react bump 0.3.0；测试 install 到玩具 vite 项目能跑通
- [ ] `bun publish --access public`
- [ ] CHANGELOG.md 起草 v0.3 condensed entry
- [ ] commit `phase 31 sub-G: sentori-react@0.3.0`

## Phase 32 — Docs + onboarding 完整化

**Goal:** 不主动推广，但 docs / getting-started 做到能口口相传。
**Entry:** Phase 31 ✅. **Exit:** 4 path getting-started 各通过 5 分钟秒表测试；React 专区 5 篇 recipe + troubleshooting 章节落定；marketing hero copy 调到 React-first。
**Estimate:** 1 周

### sub-A — getting-started 4-path 重做
- [ ] `docs-site/src/content/docs/getting-started.md` 拆成 4 篇：`getting-started/react.md` / `getting-started/react-native.md` / `getting-started/nextjs.md` / `getting-started/node.md`，每篇独立可读
- [ ] 每篇结构：Prerequisites / Install / Configure / Capture first error / View on dashboard / Next steps，目标每条 path 5 分钟到 dashboard 看到 event
- [ ] `docs/` 镜像同步
- [ ] commit `phase 32 sub-A: 4-path getting-started`

### sub-B — 5 分钟秒表实测
- [ ] 起 4 个干净 sandbox（vite + react-native init + create-next-app + node 空项目），按 docs 各跑一遍秒表
- [ ] 对超时 path 回 sub-A 修文档，再测一遍直到全过
- [ ] 在 `docs/dogfood/onboarding-times.md` 记每次测试结果（含 sandbox 版本号 + node / bun 版本）
- [ ] commit `phase 32 sub-B: onboarding stopwatch passes`

### sub-C — React 专区深度 recipe
- [ ] `docs-site/src/content/docs/recipes/state-management.md`：Redux / Zustand / TanStack Query 怎么 wrap captureError
- [ ] `docs-site/src/content/docs/recipes/suspense-rsc.md`：Suspense / RSC / streaming 错误捕获边界
- [ ] `docs-site/src/content/docs/recipes/sourcemap-upload.md`：CI 自动化（GitHub / GitLab / Vercel build hook）
- [ ] `docs-site/src/content/docs/recipes/release-versioning.md`：`<app>@<version>+<build>` 跨 web / mobile 一致性
- [ ] `docs-site/src/content/docs/recipes/multi-environment.md`：staging / prod 同 token 不同 env filter
- [ ] commit `phase 32 sub-C: react deep recipes`

### sub-D — Troubleshooting 章节
- [ ] 新 `docs-site/src/content/docs/troubleshooting.md`：典型坑 8-10 项，每项 Q + diagnosis 步骤 + fix
- [ ] 候选 Q：`stack 是 minified 怎么办` / `release 不匹配 sourcemap` / `token 401` / `dSYM 上传成功但 frame 仍未 symbolicate` / `dashboard 看不到事件` / `webhook 收到但签名不对` / `crash-free rate 一直 0%` / `regression 没触发`
- [ ] commit `phase 32 sub-D: troubleshooting`

### sub-E — Marketing hero copy 微调
- [ ] `marketing/src/pages/index.astro` hero h1 改成强调 React + RN（候选 copy："Error tracking, built React-first."），不重做布局
- [ ] sub-hero 保留对 platform-agnostic 协议的强调，避免显得不支持其它平台
- [ ] marketing build 部署到 staging 检视
- [ ] commit `phase 32 sub-E: marketing hero copy`

## Phase 33 — Performance / scale 验真

**Goal:** dogfood 跑起来后用数据撑场子。
**Entry:** Phase 32 ✅. **Exit:** `docs/performance.md` 落 baseline；1M event 数据下 dashboard 主要 view < 500ms；50 req/s ingest P99 < 200ms。
**Estimate:** 1.5 周

### sub-A — 1M event 数据准备 + EXPLAIN
- [ ] `tools/seed-events.ts --events=1000000` 注入百万事件（分批 batch，避免 OOM；每批 5k）
- [ ] 跑 issue list / events / sessions health 各核心 query 的 `EXPLAIN (ANALYZE, BUFFERS)`
- [ ] 列拐点：哪个 query 在哪个数据规模处崩
- [ ] commit `phase 33 sub-A: 1m-event explain baseline`

### sub-B — Cursor pagination + 可选 virtualization
- [ ] `server/src/api/admin.rs` `list_issues` 加 cursor 参数 `?cursor=<lastSeen>:<id>` 替代 OFFSET（OFFSET 在大数据下慢）；返回 `nextCursor`
- [ ] dashboard `<IssuesView>` 改 infinite scroll：滚到底加载下一页 + 预取一页
- [ ] 可选：行数 > 500 时启 `react-window` virtualization（如果 1k 行 wall-clock 仍 OK 则不上）
- [ ] e2e 验证：1M event / 100k issues 数据下滚动顺滑无卡顿
- [ ] commit `phase 33 sub-B: cursor pagination + infinite scroll`

### sub-C — Ingest 压测
- [ ] 起 staging 环境（已有 self-hosting 路径），用 k6 50 req/s 持续 10 分钟打 `/v1/events` / `/v1/events:batch` / `/v1/sessions` / `/v1/deploys`
- [ ] 记 P50 / P95 / P99 latency + error rate；分别记四 endpoint
- [ ] 若 P99 > 200ms：profile server，找瓶颈（DB connection pool / serde / quota check）
- [ ] commit `phase 33 sub-C: ingest load test`

### sub-D — SDK offline / retry 压测
- [ ] 用 chrome devtools network throttle 模拟 offline / 慢 3G / 5xx，断 N 秒后恢复
- [ ] 验证 RN SDK + JS SDK 不丢事件 / 不双发；`enqueue` queue 上限不溢出
- [ ] 若发现行为 bug：修 SDK，bump 0.3.x patch、publish
- [ ] commit `phase 33 sub-D: sdk offline reliability`

### sub-E — Performance baseline 文档
- [ ] 新 `docs/performance.md`：列每个 baseline 指标（query plan / latency / throughput）
- [ ] 设回归对照规则："任何 query plan / latency 退化 > 20% 在 PR 描述里说明原因"
- [ ] 加进 review checklist 顶部
- [ ] commit `phase 33 sub-E: performance baseline doc`

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

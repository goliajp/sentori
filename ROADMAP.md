# Sentori Roadmap

> 一个 RN-first、Sentry 替代、完全自研协议的 APM。
> 后端：Rust + axum + PostgreSQL 18+ + Valkey。前端：已搭好的 `web/`（React + Vite + Tailwind v4，全 SPA）。
> **双轨发布**：Phase 0–10 self-hosted v0.1.0（开发者可自部署）；Phase 11–16 SaaS 上线 `sentori.golia.jp`。

## 当前进度索引

- [x] **Phase 0** — 项目方向对齐（非编码决策定稿）
- [x] **Phase 1** — Event Schema + Token/Ingest 协议初稿
- [x] **Phase 2** — Server 骨架（axum 接 POST，stdout 打印）
- [x] **Phase 3** — RN SDK JS 层（init + 全局错误捕获 + batcher）
- [x] **Phase 4** — 端到端 smoke test 🎯（首个里程碑）
- [x] **Phase 5** — PG 落库 + 最小 grouping
- [x] **Phase 6** — Web dashboard MVP
- [x] **Phase 7** — RN SDK Native 层（iOS NSException + Android uncaught）
- [x] **Phase 8** — Sourcemap 上传 + 服务端符号化
- [x] **Phase 9** — Release / Env / 邮件告警
- [x] **Phase 10** — Docker compose + 文档 + **self-hosted v0.1.0** 🎯
- [ ] **Phase 11** — 域名 / DNS / TLS 准备（sentori.golia.jp 拓扑落地）
- [ ] **Phase 12** — Marketing 站 + 文档站
- [ ] **Phase 13** — 多租户改造（org / user / membership）
- [ ] **Phase 14** — SaaS 自助 onboarding
- [ ] **Phase 15** — 配额 / 限流 / usage 计量（free tier）
- [ ] **Phase 16** — 生产就绪 + **公开上线 sentori.golia.jp** 🎯

总工时估算（1 人全职）：**约 22–30 周**（self-hosted ~14–18 周 + SaaS 上线 ~8–12 周）。

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

## Phase 0 — 项目方向对齐

**Goal:** 把所有"非编码决策"一次性定下来，避免后续返工。
**Entry:** 当前会话已有的方向（自研协议 / RN-first / Rust+axum+PG+Valkey / 全 SPA dashboard / sentori.golia.jp 公网）。
**Exit:** 下面所有 checkbox 全勾完，仓库进入 git 管理。
**Estimate:** 0.5 天。

### Steps

- [x] **决策**：项目名 `sentori` 保留（不改）
- [x] **决策**：公网域名 `sentori.golia.jp`，subdomain 拓扑见上表
- [x] **决策**：monorepo 布局如下（创建空目录占位）

  ```
  sentori/
  ├── web/                    # 已存在，dashboard SPA
  ├── server/                 # axum 后端二进制
  ├── sdk/
  │   └── react-native/       # @sentori/react-native npm 包
  ├── cli/                    # sentori-cli（sourcemap/dSYM 上传）
  ├── marketing/              # Astro 静态站，sentori.golia.jp
  ├── docs-site/              # Astro Starlight，docs.sentori.golia.jp
  ├── docs/                   # protocol.md / getting-started.md / ... 源材料
  ├── e2e/                    # 端到端测试脚手架
  ├── docker/                 # Dockerfile.server 等
  ├── docker-compose.yml
  ├── ROADMAP.md              # 本文档
  └── README.md
  ```

- [x] **决策**：token 格式 `st_pk_<26 字符 base32 of uuid-v7>`（`pk` 项目公钥；保留 `sk_` 给后续 admin secret key）
- [x] **决策**：UI 栈不改——React 19 + Vite + Tailwind v4 + jotai + react-router 继续
- [x] **决策**：SDK 包名 `@sentori/react-native`（与 `@sentori/web` 同 namespace）
- [x] 删除 `.claude/commands/newlab.md`（labs 残留，对 sentori 无意义）
- [x] 写顶层 `.gitignore`：覆盖 Rust `target/`、Node `node_modules/`、Vite `dist/`、Xcode `build/` & `*.xcuserdata`、Android `build/` & `.gradle/`、`.env`、macOS `.DS_Store` + `.claude/handoff.md`
- [x] 写顶层 `README.md` 占位：项目目标 + 状态 + 链接到 ROADMAP.md
- [x] `git init`
- [x] 第一个 commit：`chore: bootstrap sentori monorepo`（51b6ae0）

---

## Phase 1 — Event Schema + Token/Ingest 协议初稿

**Goal:** 一份 markdown spec 作为 SDK ↔ Server 双方契约，写死字段、命名、类型、token 格式、ingest URL。
**Entry:** Phase 0 完成。
**Exit:** `docs/protocol.md` 通过 review，包含至少 3 个 example payload + token/URL 设计说明。
**Estimate:** 1 天。

### Steps

- [x] 写 `docs/protocol.md` 主体框架（最终包含：Design principles / Versioning / Endpoints / Auth / Token + Ingest URL / Response codes / Event schema / Device / App / Framework / User / Error / Frame / Breadcrumb / Batch / Size limits / Rate limits / Examples / Compatibility promises）
- [x] 章节：Token / Ingest URL 设计
  - [x] token 格式 `st_pk_<26 chars Crockford base32 of uuid-v7>`
  - [x] ingestUrl 默认值 `https://ingest.sentori.golia.jp`
  - [x] 显式说明**不复用 Sentry DSN URL 编码方案**及理由
  - [x] env 变量约定：`SENTORI_TOKEN` + `SENTORI_INGEST_URL`
- [x] 章节：HTTP 端点
  - [x] `POST /v1/events` —— 单条
  - [x] `POST /v1/events:batch` —— 数组
  - [x] 响应码语义：`202 Accepted` / `400 Bad Request` / `401 Unauthorized` / `413 Payload Too Large` / `429 Too Many Requests`
- [x] 章节：鉴权头
  - [x] `Authorization: Bearer st_pk_xxx`
  - [x] `Sentori-Sdk: react-native/0.1.0`
  - [x] `Content-Type: application/json`（不接受 multipart）
- [x] 章节：Event 顶层 schema（id / timestamp / kind / platform / release / environment / device / app / user / tags / breadcrumbs / error / fingerprint? / traceId? / spanId?）—— **review 期决议**：camelCase + 完整词 + src→platform + app.rn→app.framework + 加 traceId/spanId 扩展位
- [x] 章节：Error subobject（type / message / stack[] / cause?）
- [x] 章节：Stack frame（function / file / line / column / inApp / absolutePath? / preContext? / postContext?）
- [x] 章节：Breadcrumb 类型枚举（`nav` / `net` / `log` / `user` / `custom`）+ 各自 data 字段
- [x] 章节：Batch 包装（`{ events: [...] }`）+ 单批 size cap（1MB / 100 条）+ 部分失败语义（accepted/rejected/errors[]）
- [x] 章节：Rate limit 响应（`429` body 带 `retryAfterMs`，默认 5000 req/min）
- [x] 写 example 1：JS `TypeError`（含 breadcrumbs、release、user）
- [x] 写 example 2：iOS `NSException`（platform=ios，stack 有 absolutePath）
- [x] 写 example 3：Android `RuntimeException`（platform=android，含 cause chain）
- [x] 跟用户过一遍 review，记录修改并迭代到 v0 —— 用户授权"我来定，新和专业、无历史负担"，按 modern conventions 全面重写
- [x] commit：`docs: protocol v0`

---

## Phase 2 — Server 骨架

**Goal:** `sentori-server` 二进制在 `:8080` 接收 `POST /v1/events`，stdout 打印解析后的 Event。
**Entry:** Phase 1 完成。
**Exit:** `curl -X POST localhost:8080/v1/events -H "Authorization: Bearer st_pk_dev" -d @example1.json` 返回 `202`，stdout 输出结构化 event。
**Estimate:** 1.5 天。

### Steps

- [x] `cd sentori && cargo new server --bin --name sentori-server`（实际手写 Cargo.toml + 拆 lib/main，效果等价）
- [x] 加依赖：
  - [x] `axum` 0.8
  - [x] `tokio` (full features)
  - [x] `serde` + `serde_json`
  - [x] `uuid` (v7)
  - [x] `time` (with serde-well-known，rfc3339)
  - [x] `tower` + `tower-http` (cors / trace / limit)
  - [x] `tracing` + `tracing-subscriber`
  - [x] `anyhow` + `thiserror` 2
  - [x] `validator` 0.20（schema 校验，含 nested 校验）
- [x] 写 `server/src/main.rs`：tokio main + tracing init + `axum::serve`
- [x] 写 `server/src/event.rs`：Event / Error / Frame / Breadcrumb / Device / App / Framework / User 的 serde + Validate，camelCase rename，对齐 protocol.md
- [x] 写 `server/src/api/events.rs`：`POST /v1/events` handler，validate 后 stdout pretty-print
- [x] 写 `server/src/api/events_batch.rs`：`POST /v1/events:batch` handler，含 partial failure 语义（accepted/rejected/errors[]）
- [x] 写 `server/src/auth.rs`：Bearer token middleware（constant-time 比对，读 env `SENTORI_DEV_TOKEN`）
- [x] 写 `server/src/router.rs`：组装 router + middleware（CORS、TraceLayer、RequestBodyLimitLayer 1 MB）
- [x] 写 `server/src/error.rs`：AppError + IntoResponse + flatten_validation_errors（共享给 batch handler）
- [x] 写 `.env.example`：`SENTORI_DEV_TOKEN=st_pk_dev0000000000000000000000`
- [x] `cargo run` + curl 校验 —— 由集成测试覆盖（reqwest 端到端跑 6 个测试）
- [x] 写集成测试 `tests/post_event.rs`：6 个测试覆盖 202 / 401×2 / 413 / 400 + batch partial failure
- [x] `cargo test` 全绿（6/6 passed）
- [x] commit：`feat(server): minimal ingestion skeleton`

---

## Phase 3 — RN SDK JS 层

**Goal:** `@sentori/react-native` 能在 demo app `init`、捕获 JS 错误、batch 上报到 Phase 2 的 server。
**Entry:** Phase 2 完成。
**Exit:** demo app 调用 `throw new TypeError("test")`，Phase 2 的 server stdout 看到完整 event。
**Estimate:** 1 周。

### Steps

- [x] `cd sentori/sdk && bunx create-react-native-library@latest react-native`（包名 `@sentori/react-native`，类型 turbo-module，语言 kotlin + objc/swift）
- [x] 删除模板示例代码（保留构建配置）
- [x] 写 `src/types.ts`：Event / SentoriError / Frame / Breadcrumb，对齐 `docs/protocol.md`
- [x] 写 `src/init.ts`：`sentori.init({ token, release, env?, ingestUrl? })` —— 校验 token 前缀（`st_pk_`），ingestUrl 默认 `https://ingest.sentori.golia.jp`，env 默认从 `__DEV__` 推断，写入全局 config singleton
- [x] 写 `src/handlers/global.ts`：`ErrorUtils.setGlobalHandler` 包装 + 保留原 handler
- [x] 写 `src/handlers/promise.ts`：`HermesInternal.enablePromiseRejectionTracker` 接入
- [x] 写 `src/handlers/network.ts`：fetch / XHR 拦截 → 写 breadcrumb（不阻断原请求）
- [x] 写 `src/breadcrumbs.ts`：ring buffer，cap 100 条，类型枚举对齐 protocol
- [x] 写 `src/transport.ts`：
  - [x] batcher：5 秒或 10 条触发 flush
  - [x] retry：指数退避 1s/2s/4s 上限 3 次
  - [x] offline queue：AsyncStorage 落盘，下次启动 drain
  - [x] header：`Authorization` + `Sentori-Sdk: react-native/<pkg.version>`
- [x] 写 `src/error-boundary.tsx`：React `<sentori.ErrorBoundary fallback>`
- [x] 写 `src/stack.ts`：解析 RN error stack 字符串 → `Frame[]`（先不做 sourcemap，留 raw 给 Phase 8 处理）
- [x] 写 `src/index.ts`：默认 export `sentori` 对象，所有方法 namespace 化
- [x] 写 jest 单测覆盖 transport / breadcrumbs / stack 解析
- [x] `bun run prepack` 检查产物
- [x] 改 `sdk/react-native/example/App.tsx`：`sentori.init` + 一个 throw 按钮（`ingestUrl: 'http://localhost:8080'` 用于本地 dev）
- [x] iOS：`cd example/ios && bundle exec pod install`
- [x] iOS：`cd example && bun run ios` 启 simulator，点击 throw，验证 server stdout 收到事件
- [x] Android：`cd example && bun run android` 启 emulator，同验证
- [x] commit：`feat(sdk): JS-layer error capture and batched transport`

---

## Phase 4 — 端到端 smoke test

**Goal:** 锁第一个对外 visible 的里程碑——demo app throw → server 收到，建 CI 防回归。
**Entry:** Phase 3 完成。
**Exit:** `bash e2e/run.sh` 一个命令端到端跑通并退出 0（SDK transport ↔ server 协议契约自动验证）。
**Estimate:** 2–3 天。

### Steps

- [x] server 加 dev-only `GET /v1/events/_recent`：in-memory 环形 buffer cap 100，鉴权与 ingest 端点共享
- [x] 写 `e2e/run.sh`：bun 驱动 SDK transport 端到端验证（替代 simulator GUI 自动化，保留协议契约保护）
  - [x] 启 server（debug build，背景）
  - [x] `bun install` in `e2e/`（含 `@sentori/react-native` file link）
  - [x] `bun send-event.ts`：`sentori.captureError(...)` + 等 batcher flush
  - [x] poll `GET /v1/events/_recent` 校验事件到达 + 字段（platform / error.type）
  - [x] 杀进程
- [ ] 写 `e2e/run-android.sh`：`adb shell am start` 触发 —— **deferred 到 v0.2**（与 simulator GUI 自动化一并推迟）
- [ ] 加 `package.json` script：`"e2e": "bash e2e/run.sh"` —— **N/A**（顶层无 package.json；直接 `bash e2e/run.sh` 即可）
- [ ] 在 GitHub Actions 加 e2e workflow —— **deferred 到 v0.2**（CI workflow 与 simulator 自动化打包到一起）
- [x] commit：`test: end-to-end smoke from RN demo to server`
- [x] 🎯 **里程碑标记**：Sentori 首个端到端版本（SDK transport ↔ server 协议契约自动化）

---

## Phase 5 — PG 落库 + 最小 grouping

**Goal:** 事件落 Postgres，同 fingerprint 归到同 issue。
**Entry:** Phase 4 完成。
**Exit:** 同一段错误连续 throw 5 次，DB 中 `issues` 表 1 行、`events` 表 5 行。
**Estimate:** 1.5 周。

### Steps

- [x] 加依赖：`sqlx` (postgres + uuid + time + json features) + `sqlx-cli`（dev）+ `redis`/`fred` (Valkey)
- [x] 起本地 PG 18：`docker run -d --name sentori-pg -p 5432:5432 -e POSTGRES_PASSWORD=dev -e POSTGRES_DB=sentori postgres:18-alpine`
- [x] 起本地 Valkey：`docker run -d --name sentori-vk -p 6379:6379 valkey/valkey:8-alpine`
- [x] 写 `server/migrations/0001_init.sql`：
  - [x] `projects` (id, name, created_at)
  - [x] `tokens` (id, project_id FK, token_hash, kind, created_at, revoked_at)
  - [x] `releases` (id, project_id, version, build, created_at, UNIQUE(project_id, version, build))
  - [x] `issues` (id uuid-v7, project_id FK, fingerprint, type, msg_sample, status enum('active','silenced','closed'), first_seen, last_seen, event_count, UNIQUE(project_id, fingerprint))
  - [x] `events` 按月 RANGE 分区 (id uuid-v7, project_id FK, issue_id FK, release_id FK?, env, payload jsonb, ts, received_at)
  - [x] 索引：`events(issue_id, ts DESC)`、`issues(project_id, status, last_seen DESC)`
- [x] 写 `server/src/db.rs`：连接池 + `sqlx::migrate!()` 启动时自动迁移
- [x] 写 `server/src/grouping.rs`：fingerprint = `sha256(error.type + first_in_app_frame.fn + first_in_app_frame.file)` 取前 16 字节 hex
- [x] 写 `server/src/issues.rs`：`upsert_issue(project_id, fingerprint, ...) -> issue_id`（用 ON CONFLICT 更新 last_seen + event_count）
- [x] 改写 ingestion handler：解析 → 计 fingerprint → upsert issue → 写 events 行
- [x] 加 `GET /v1/projects/:id/issues?status=active` 端点
- [x] 加 `GET /v1/projects/:id/issues/:issue_id/events` 端点
- [x] 写 Valkey rate limit middleware：sliding window，1000 req/min/token，超限返回 429 + `retry_after_ms`
- [x] 写 seed 脚本 `server/scripts/seed.rs`：创建 dev project + dev token
- [x] 改 token 鉴权：从硬编码改为查 `tokens` 表（带 Valkey cache，TTL 60s）
- [x] 集成测试：连续 post 5 个相同事件，断言 issues 表 1 行 + events 表 5 行
- [x] 集成测试：rate limit 触发 429
- [x] commit：`feat(server): persistent storage with grouping and rate limit`

---

## Phase 6 — Web dashboard MVP

**Goal:** 在 `web/` 能登录、选项目、看 issue 列表（dense table）+ 看 issue 详情（event 列表 + stack）。
**Entry:** Phase 5 完成。
**Exit:** 浏览器 `http://localhost:5173` 能看到由 Phase 5 入库的真实事件，键盘 `j/k/Enter` 可用。
**Estimate:** 2 周。

### Steps

- [x] `cd web && bun add @tanstack/react-query openapi-fetch react-hotkeys-hook`
- [x] 设计 admin API 鉴权：管理员 session cookie（Phase 6 先做最简：env 注入的 admin password + `POST /admin/api/login` 设 httpOnly cookie，多用户在 Phase 13）
- [x] server 写 admin 端点：
  - [x] `POST /admin/api/login`
  - [ ] `GET /admin/api/projects`
  - [x] `GET /admin/api/projects/:id/issues?status=&env=&q=`
  - [x] `GET /admin/api/projects/:id/issues/:issue_id`
  - [x] `GET /admin/api/projects/:id/issues/:issue_id/events?limit=50`
  - [x] `PATCH /admin/api/issues/:id`（修改 status）
- [ ] server 写 OpenAPI schema 输出（用 `utoipa` crate）→ `web/` 用 `openapi-typescript` 生成 types
- [x] vite 配 dev proxy：`/admin/api → http://localhost:8080`
- [x] web/ 路由：
  - [x] `/login`
  - [x] `/`（重定向到 `/issues`）
  - [x] `/issues`（列表）
  - [x] `/issues/:id`（详情）
  - [ ] `/projects/:id/settings`（token、recipient 管理，留 Phase 9）
- [x] 写 `IssueListView`：
  - [x] dense table：cols [type, msg_sample, count, last_seen, env, release]
  - [x] 行高 32px，字号 13px，等宽数字
  - [x] j/k 切行高亮、Enter 进详情、s 切 silenced、`/` 聚焦搜索框
- [x] 写 `IssueDetailView`：
  - [x] 左栏：events 列表（按 ts DESC）
  - [x] 右栏：选中 event 的 stack + breadcrumbs + tags + device/app/release
  - [x] stack frame 渲染（先无符号化，用 raw）
  - [x] 上下事件 `[`/`]` 切换
- [x] 写 `web/docs/design-language.md`：字号刻度（11/13/15/24px）、间距刻度（4/8/16/24px）、暗色 palette 决策、参照 Linear / Vercel
- [x] 暗色为默认（已搭好）
- [x] `bun run check / test / build` 全绿
- [x] commit：`feat(web): dashboard MVP with dense issue list and detail`

---

## Phase 7 — RN SDK Native 层

**Goal:** iOS NSException + Android 未捕获异常都能落盘 + 下次 JS 启动 flush 上报。
**Entry:** Phase 6 完成。
**Exit:** iOS Swift `NSException.raise(...)` + Android Kotlin `throw RuntimeException(...)`，重启 demo app 后 server 收到事件并在 dashboard 显示。
**Estimate:** 2 周。

### Steps

#### iOS

- [x] `sdk/react-native/ios/SentoriModule.swift`：注册 turbo module，提供 `drainPending()` 给 JS 调
- [x] `sdk/react-native/ios/SentoriCrashHandler.swift`：
  - [x] `NSSetUncaughtExceptionHandler { ex in writeToDisk(ex) }`
  - [x] 写文件路径：`<Documents>/sentori/pending/<uuid>.json`
  - [x] 文件 schema：与 protocol Event 一致（src=ios）
- [x] `sdk/react-native/ios/Sentori.h` + `Sentori.m`（暴露给 RN）
- [ ] iOS 单测（XCTest）：触发 NSException → 断言 `Documents/sentori/pending/*.json` 出现 + 文件内容反序列化为合法 Event
- [x] JS 端 `src/native-bridge.ts`：`Sentori.drainPending()` 读所有 .json，喂给 transport，逐个删文件
- [x] `sentori.init` 在最后一步调一次 `drainPending()`
- [x] example app 加按钮 "Throw NSException"
- [ ] iOS sim 端到端：throw → kill app → cold start → 验证 server 收到事件

#### Android

- [x] `sdk/react-native/android/.../SentoriModule.kt`：注册 turbo module
- [x] `sdk/react-native/android/.../SentoriCrashHandler.kt`：
  - [x] `Thread.setDefaultUncaughtExceptionHandler { t, e -> writeToDisk(e); previousHandler?.uncaughtException(t, e) }`
  - [x] 写文件路径：`<filesDir>/sentori/pending/<uuid>.json`
- [ ] Android 单测（JUnit + Robolectric）：同 iOS 双断言
- [x] example app 加按钮 "Throw RuntimeException"
- [ ] Android emu 端到端：throw → 重启 → server 收到 + dashboard 显示

- [x] commit：`feat(sdk): native uncaught exception capture (iOS + Android)`

---

## Phase 8 — Sourcemap 上传 + 服务端符号化

**Goal:** dashboard 中 JS 错误的 stack 显示原始 `src/Form.tsx:42:10`，而非 minified 位置。
**Entry:** Phase 7 完成。
**Exit:** 用 production bundle 触发的错误，dashboard 默认显示原始位置；可切换 raw view。
**Estimate:** 1 周。

### Steps

- [x] `cd sentori && cargo new cli --bin --name sentori-cli`
- [x] 加依赖：`reqwest`、`clap`、`serde`、`walkdir`
- [x] 写 `cli/src/main.rs`：`sentori-cli upload sourcemap --release <r> --token <t> <files...>`
- [x] server migration `0002_releases.sql`：`release_artifacts` (id, release_id FK, kind, name, content_hash, blob_path, created_at)
- [x] server 端点：`POST /admin/api/releases/:r/sourcemaps`（multipart upload，落盘到 `data/artifacts/<hash>`）
- [x] server `src/symbolicate.rs`：
  - [x] 用 `sourcemap` crate 加载 .js.map
  - [x] 函数 `symbolicate_frame(frame, release_id) -> Frame`
  - [x] in-memory LRU cache（key=release_id+file，cap 50 条）
- [x] 改 `GET /admin/api/issues/:id/events`：返回时 lazy symbolicate 每个 frame
- [x] dashboard event 详情页加 toggle "raw / symbolicated"（默认 symbolicated）
- [ ] e2e：build minified bundle → cli 上传 sourcemap → 触发错误 → 验证 dashboard 显示原始位置
- [x] commit：`feat: sourcemap upload and server-side symbolication`

---

## Phase 9 — Release / Env / 邮件告警

**Goal:** dashboard 可按 env / release 过滤；新 issue 自动邮件通知。
**Entry:** Phase 8 完成。
**Exit:** 在两个 release 各 throw 一次相同错误，dashboard 显示"出现于 v1 + v2"；新 issue 触发 mailcatcher 收到邮件。
**Estimate:** 1 周。

### Steps

- [x] migration `0003_notifications.sql`：`notification_recipients` (id, project_id FK, email, on_new_issue, on_regression, created_at)
- [x] dashboard `IssueListView` 加过滤器：env 多选、release 多选、status 切换
- [x] dashboard `IssueDetailView` 新增"出现的 release"列表（小 chip）
- [x] 加依赖：`lettre`（SMTP）
- [x] 写 `server/src/notifier.rs`：
  - [x] 监听新 issue 创建事件（先用 channel + 后台 task；不引 Kafka）
  - [x] 拉 recipients → 渲染邮件 → `lettre` 发送
  - [x] 失败重试 3 次
- [x] 配置 SMTP via env：`SENTORI_SMTP_HOST` / `_PORT` / `_USER` / `_PASS` / `_FROM`
- [ ] dashboard project settings 页：增删 recipient
- [ ] 集成测试：用 `mailcatcher` 容器，触发新 issue，断言邮件入箱
- [x] commit：`feat: release/env filters and email notifications on new issues`

---

## Phase 10 — Docker compose + 文档 + self-hosted v0.1.0

**Goal:** 一行 `docker compose up` 起完整 sentori，文档够新人 5 分钟上手。
**Entry:** Phase 9 完成。
**Exit:** 全新机器跟着 docs/getting-started.md 5 分钟内能起 sentori 并接入一个 RN demo 看到事件。
**Estimate:** 1 周。

### Steps

- [x] 写 `docker/Dockerfile.server`：多阶段构建（rust:1.83-alpine 编译 → distroless 运行）
- [x] 写 `docker/Dockerfile.web`：阶段 1 bun 构建 web/dist，阶段 2 nginx 托管 dist
- [x] 写 `docker-compose.yml`：services = `server` + `web` + `pg` + `valkey`
- [x] 写 `docker-compose.override.example.yml`：可选 SMTP / 持久卷映射
- [x] 写 `.github/workflows/build.yml`：cargo test、bun run check/test/build、cargo build --release，产出 docker image push 到 ghcr.io
- [x] 写 `docs/getting-started.md`：5 分钟从 zero 到捕获第一条事件（self-hosted）
- [x] 写 `docs/sdk-react-native.md`：`init` API、ErrorBoundary、breadcrumb 自定义、source map 上传
- [x] 写 `docs/self-hosting.md`：env 变量参考、备份策略、PG 升级注意事项
- [x] 完整化 `README.md`：徽章、demo gif、快速开始、链接到各 docs
- [ ] 用一台干净 mac 走一遍 `getting-started.md`（colima 或 docker desktop），计时 ≤ 5 分钟
- [ ] `git tag v0.1.0` + GitHub release
- [x] commit：`docs: getting started, self-hosting, SDK guide`
- [x] 🎯 **里程碑：self-hosted v0.1.0 发布**

---

## v0.1.0 launch checklist

Phase 0–10 代码层面全部完成（26 commits 落地）。下面是发布 v0.1.0 之前由你拾起的收尾——做完后 Phase 0–10 真正 close，进入 Phase 11（SaaS arc）。

- [ ] 用一台干净 mac 跑 `docs/getting-started.md`，计时 ≤ 5 分钟（来自 Phase 10 line 441）
- [ ] iOS simulator 端到端：`cd sdk/react-native/example && bunx expo prebuild && cd ios && bundle exec pod install && cd .. && bun run ios` → tap "Native crash" → relaunch → server stdout 收到 `platform: ios` 事件（来自 Phase 7 line 358）
- [ ] Android emulator 端到端：`bun run android` → 同上验证 `platform: android` 事件（来自 Phase 7 line 368）
- [ ] `git tag v0.1.0 -m "Sentori v0.1.0 — self-hosted MVP"` + 推 + 写 GitHub release notes（来自 Phase 10 line 442）
- [ ] （可选）self-dogfooding：本地 server 接 1-2 天看 ingestion / grouping / 邮件告警

## v0.1 范围内已 deferred 项（已分配到后续 phase）

各 phase 实施时被明确推迟的 step 都记录在这里，避免遗漏：

| 来自 | 内容 | 在哪儿拾起 |
|---|---|---|
| Phase 4 | `e2e/run-android.sh` + GitHub Actions simulator runner | Phase 16 Testing 段（与 simulator GUI 自动化整体一起做） |
| Phase 6 line 308 | `GET /admin/api/projects` | Phase 13 Server 段（multi-tenant 时做 project list） |
| Phase 6 line 313 | `utoipa` OpenAPI 自动导出 | v0.2（非阻塞，先手写 types） |
| Phase 7 line 354 | iOS XCTest（NSException + 文件落盘） | Phase 16 Testing 段 |
| Phase 7 line 358 | iOS simulator end-to-end | v0.1.0 launch checklist 上方 + Phase 16 Testing 段（自动化） |
| Phase 7 line 366 | Android Robolectric | Phase 16 Testing 段 |
| Phase 7 line 368 | Android emulator end-to-end | v0.1.0 launch checklist 上方 + Phase 16 Testing 段（自动化） |
| Phase 8 line 394 | minified bundle → cli upload → dashboard 验证原始位置 e2e | Phase 16 Testing 段 |
| Phase 9 line 417 | recipient 管理 UI | Phase 13 Dashboard 段（与 org settings 一起做） |
| Phase 9 line 418 | mailcatcher 集成测试 | Phase 16 Testing 段 |

---

## Phase 11 — 域名 / DNS / TLS 准备

**Goal:** 通过 devops `zones.yaml` 把 `sentori.golia.jp` 主域 + 5 个 4 段 subdomain（status 留到 Phase 16）落地；origin VM 上 Caddy 自动 ACME 出 cert。
**Entry:** Phase 10 完成（self-hosted v0.1.0 已发布）。
**Exit:** 6 个域名都能 HTTPS 访问（即使内容是 502/404 也行），证书 valid。
**Estimate:** 0.5 周。

### Steps

#### 决策

- [ ] **决策**：DNS 通过 devops 项目 `zones.yaml` 管理（`golia.jp` zone 下加 records），**不**自起 Cloudflare client
- [ ] **决策**：3 段 `sentori.golia.jp` → CF Pages + orange cloud（Universal SSL 自动覆盖）；4 段子域 → grey cloud + origin Caddy + Let's Encrypt
- [ ] **决策**：4 段子域全部反代到同一台 origin VM（Phase 16 决定具体是 t01 还是 Hetzner，Phase 11 阶段先指 t01 占位）

#### DNS（在 devops 项目）

- [ ] `cd ~/workspace/goliajp/devops`，编辑 `zones.yaml`，在 `zones.golia.jp.records` 下追加：

  ```yaml
  - { name: sentori,         cname: <cf-pages-target> }   # marketing，Phase 12 部署后才填具体 target
  - { name: app.sentori,     host: <origin-vm> }          # dashboard
  - { name: ingest.sentori,  host: <origin-vm> }          # SDK 上报
  - { name: api.sentori,     host: <origin-vm> }          # admin API
  - { name: docs.sentori,    host: <origin-vm> }          # 文档站
  - { name: cdn.sentori,     host: <origin-vm> }          # SDK/CLI 静态资源
  ```

- [ ] **必须**：跑 `devops dns diff` 给用户看，列出 CREATE / DELETE / UPDATE 各几条，等明确确认后再 sync（feedback_dns_delete.md 教训）
- [ ] `devops dns sync` 执行
- [ ] Cloudflare 后台手动确认 4 段 subdomain 的 proxy 状态是 **DNS-only（grey cloud）**，`sentori.golia.jp` 是 **proxied（orange cloud）**
- [ ] 验证：`dig app.sentori.golia.jp` / `dig sentori.golia.jp` 返回正确 IP / CNAME

#### TLS（在 origin VM）

- [ ] 在 origin VM 的 Caddyfile 加 6 个 site block（占位即可，不需要真后端）：

  ```caddy
  app.sentori.golia.jp, ingest.sentori.golia.jp, api.sentori.golia.jp,
  docs.sentori.golia.jp, cdn.sentori.golia.jp {
      respond "sentori — phase 11 placeholder" 503
  }
  ```

- [ ] `caddy reload`，等 Caddy 自动跑完 ACME（每个 subdomain 各一张 cert）
- [ ] 验证：`curl -vI https://app.sentori.golia.jp` 等 5 条 TLS 握手成功（503 body 也算成功）
- [ ] `sentori.golia.jp` 的 cert 由 Cloudflare Universal SSL 自动管理，无需 origin 配置；验证 `curl -vI https://sentori.golia.jp` 返回 CF 默认页或 503

#### 收尾

- [ ] 写 `docs/infrastructure/dns.md`：subdomain 表 + cf 模式（grey/orange）+ 续期路径（CF Universal SSL 自动 / Caddy 自动）+ 链接到 devops zones.yaml
- [ ] commit：`infra: sentori dns records via devops, caddy tls on origin`

---

## Phase 12 — Marketing 站 + 文档站

**Goal:** `sentori.golia.jp`（主站）和 `docs.sentori.golia.jp`（文档）都有内容并部署。
**Entry:** Phase 11 完成。
**Exit:** 两个站可访问；主站含 Hero / Features / Self-Hosted CTA / GitHub 链接；文档站含 getting-started / SDK / protocol 全套。
**Estimate:** 2 周。

### Steps

#### Marketing 站
- [x] **决策**：Astro（SSG，SEO 好，bundle 小）
- [x] `cd sentori && bunx create-astro@latest marketing --template minimal`
- [x] 装 Tailwind v4：复用 `web/` 的 design tokens（共享 CSS vars）
- [x] 写 `marketing/src/pages/index.astro`：
  - [x] Hero：产品定位句 + Get Started CTA + GitHub 链接
  - [x] Features 网格 4 项：JS+Native 错误捕获 / 协议简洁 / 部署轻 / 现代 dashboard
  - [x] "Open Source & Self-Hostable" 区块
  - [x] "Why we built Sentori" 区块（一段对比 Sentry 的思考）
- [x] 写 `marketing/src/pages/pricing.astro`：v0.1 阶段—Self-hosted 永久免费 + SaaS Free Tier 100k events/月（"Beta：邀请制"）
- [x] 设计语言：暗色优先、dense、参照 Linear / Vercel；不堆 emoji 不用 illustration
- [x] SEO：完整 meta 标签（canonical / og:type / og:site_name / twitter:card+image）+ `@astrojs/sitemap` 生成 sitemap-index.xml + 手写 robots.txt（同时给 docs-site）
- [x] OG image：手画 1200×630 SVG（暗色 + 紫色 accent + react-native/rust/self-hosted chips），sharp 转 PNG（39 KB），marketing/ 与 docs-site/ 各一份

#### 文档站
- [x] `cd sentori && bunx create-astro@latest docs-site --template starlight`（手搓——避开 create-astro 的交互 prompt）
- [x] 把 `docs/getting-started.md`、`sdk-react-native.md`、`protocol.md`、`self-hosting.md` 迁入 `docs-site/src/content/docs/`
- [x] 配置侧栏导航：Guides（Getting started / Self-hosting）+ Reference（SDK / Protocol）
- [x] 配置内置全文搜索（Pagefind）—— Starlight 默认开启，build 输出 `dist/pagefind/`，索引 1230 词
- [x] 暗色为默认（`overrides.css` 复用 `web/` 的 palette）

#### 部署
- [x] GitHub Actions：`.github/workflows/pages.yml` —— `wrangler pages deploy` 双 job（marketing + docs），trigger 限定 marketing/ docs-site/ docs/ 改动
- [ ] **(user-owned)** Cloudflare 控制台开两个 Pages 项目：`sentori-marketing` + `sentori-docs`（项目名与 workflow 写死的 `--project-name` 对齐）
- [ ] **(user-owned)** 在每个 Pages 项目里绑 custom domain：`sentori.golia.jp` / `docs.sentori.golia.jp`（DNS 已在 zones.yaml 准备好；CF Pages 加域名时会自动签 cert）
- [ ] **(user-owned)** GitHub repo Secrets：`CLOUDFLARE_API_TOKEN`（scope=Pages: Edit）+ `CLOUDFLARE_ACCOUNT_ID`
- [ ] **(user-owned)** 首次手动触发 workflow_dispatch（或推一个改动）验证 deploy 通；之后 main commit 自动 deploy

---

## Phase 13 — 多租户改造（org / user / membership）

**Goal:** server + dashboard 支持 user / org / project 三层模型；项目数据按 org 隔离。
**Entry:** Phase 12 完成。
**Exit:** 一个用户能注册、创建 org、邀请协作者、管理多个 project，看不到别人 org 的数据。
**Estimate:** 3 周。

### Steps

#### 数据模型

- [x] migration `0007_multi_tenant.sql` (前 6 个 migration 已用：0001 init / 0002 issues / 0003 partition / 0004 issue_denorm / 0005 release_artifacts / 0006 notifications)：
  - [x] `users` (id, email UNIQUE, password_hash, email_verified, created_at)
  - [x] `orgs` (id, slug UNIQUE, name, created_at, owner_id FK)
  - [x] `memberships` (org_id FK, user_id FK, role enum('owner','admin','member'), created_at, PK(org_id, user_id))
  - [x] `projects.org_id` 加 FK + 回填默认 org（dev system org `019508a0-0001-...`，password_hash 占位非合法 argon2 → 不可登录）
  - [x] `tokens.org_id` 加 FK + 回填
  - [x] `email_verifications` (token, user_id, expires_at)
  - [x] `sessions` (id, user_id, expires_at, ip, user_agent)
  - [x] `org_invites` (token, org_id, email, role, expires_at, used_at)

#### Server

- [x] 加依赖：`argon2 = "0.5"`（密码哈希）、`rand = "0.8"`（token 生成）
- [x] `server/src/passwd.rs` + `server/src/api/user_auth.rs`：
  - [x] `POST /api/auth/register`（email + password，dup → 仍 200 防 enumeration，发邮件验证 link via notifier）
  - [x] `GET /api/auth/verify?token=...`（24h TTL）
  - [x] `POST /api/auth/login` → DB session row + httpOnly + SameSite=Lax cookie（base_url https 时自动带 secure）
  - [x] `POST /api/auth/logout`（DELETE sessions row + 清 cookie）
  - [x] `GET /api/auth/me`（JOIN sessions/users，校验 expires_at）
- [x] `server/src/api/orgs.rs` (12 endpoints, all guarded by `require_user`)：
  - [x] org CRUD：`POST /api/orgs`（创建 + 自动 owner membership，事务原子）/ `GET /api/orgs`（list-mine）/ `GET|PATCH|DELETE /api/orgs/{slug}`
  - [x] membership：`GET /api/orgs/{slug}/members` / `PATCH /api/orgs/{slug}/members/{user_id}`（owner only，禁止自降级）/ `DELETE /api/orgs/{slug}/members/{user_id}`（self-leave 任何成员可，他人需 admin/owner，最后一位 owner 不可删）
  - [x] 邀请流程：`POST /api/orgs/{slug}/invites`（admin/owner，禁邀 owner 角色）/ `GET /api/orgs/{slug}/invites`（未用） / `DELETE /api/orgs/{slug}/invites/{token}` / `POST /api/invites/{token}/accept`（已登录用户接受，校验 email match + 过期 + 未用，写入 membership 事务原子）
  - [x] notifier：新 `NotifyEvent::OrgInvite` variant 发邀请邮件
- [x] middleware 改造（sub-D）：`require_admin` 接受三种 caller —— DB user session / 旧 `admin_password` HMAC cookie / Bearer token —— 注入 `AdminCaller` enum 到 request extensions；新 `require_project_in_org` 解析 path 中 `/projects/{uuid}/...`，对 `User` caller 做 `projects ⨝ memberships` scope check（`LegacyAdmin` / `DevToken` 是 super-admin 直接放行）
- [x] rate limit：注册 / 登录端点 per-IP（`rate_limit_auth_middleware`，30/min，Valkey INCR + 60s expire，X-Forwarded-For 解析，无 Valkey fail-open）
- [x] `GET /admin/api/projects`：`User` caller → 自己 orgs 下的 projects；`LegacyAdmin` / `DevToken` → 全部 projects（super-admin）。返回 camelCase `{ id, name, orgId, orgSlug, createdAt }`（**回填 Phase 6 line 308 deferred**）

#### Dashboard

- [x] 路由：`/login`（替换原 admin_password 登录为 email+password）、`/register`、`/verify?token=`、`/forgot-password`（stub）—— `userAuthApi`（`/api/auth/*`）+ `adminApi`（`/admin/api/*`）拆分；AuthProvider 升级带 `user: {id, email}`
- [ ] 顶栏 org switcher
- [ ] `/org/:slug/settings`：成员列表 + 邀请按钮
- [ ] `/org/:slug/projects/:id/settings/recipients`：增删 `notification_recipients` 行（**回填 Phase 9 line 417 deferred**）
- [ ] 所有 issue/project 路由前缀加 `/org/:slug`
- [ ] onboarding：注册成功 → 自动建 personal org（slug = email 前缀）

#### 测试

- [ ] 集成测试：A 用户登录后访问 B 用户 org 下的 issue → 403
- [ ] 集成测试：邀请 → 接受 → 看到目标 org 的项目
- [ ] commit：`feat: multi-tenant orgs, users, memberships`

---

## Phase 14 — SaaS 自助 onboarding

**Goal:** 用户从 `sentori.golia.jp` 注册到拿到第一个 token 接入应用 ≤ 5 分钟。
**Entry:** Phase 13 完成。
**Exit:** 一个新人按 dashboard 引导能 5 分钟内 RN 应用接入并看到第一条事件。
**Estimate:** 1.5 周。

### Steps

- [ ] 注册成功后 onboarding wizard：
  - [ ] Step 1: "Create your first project" → 输入 name → 自动生成 token
  - [ ] Step 2: "Install the SDK" → 显示 SDK install snippet（动态填入 token + ingestUrl）+ "I've installed it" 按钮
  - [ ] Step 3: "Send your first event" → poll `ingest` 直到看到事件 → 切到 dashboard
- [ ] 在 dashboard 顶部加"Onboarding pending"红点，未完成时常驻
- [ ] 项目设置页：token 管理（生成 / 撤销 / 标签）
- [ ] 邀请协作者流程：
  - [ ] org settings 页"Invite member" → 输入 email + 角色 → 发邀请邮件
  - [ ] 邀请链接 `/invite/:token` → 已登录直接加入；未注册引导注册
- [ ] 改 marketing 的 "Get Started" 按钮 → 直链 `https://app.sentori.golia.jp/register`
- [ ] e2e：注册 → 创建 project → 用 SDK 上报 → 看到事件，全流程
- [ ] commit：`feat(saas): self-serve onboarding from registration to first event`

---

## Phase 15 — 配额 / 限流 / usage 计量（free tier）

**Goal:** Free tier 配额（100k events/月、保留 30 天）执行到位，超额时优雅降级。
**Entry:** Phase 14 完成。
**Exit:** 一个 org 超过 100k events 后新事件被 429 拒收，dashboard 显示 banner，邮件告知 owner。
**Estimate:** 1 周。

### Steps

- [ ] migration `0008_quotas.sql`：
  - [ ] `org_quotas` (org_id PK, plan enum('free','pro','enterprise'), event_limit_monthly, retention_days)
  - [ ] `usage_counters` (org_id, period_yyyymm, event_count, dropped_count, PK)
- [ ] server ingestion 路径加 quota check：
  - [ ] 入库前查 Valkey `usage:<org_id>:<yyyymm>` 计数器
  - [ ] 超限：返回 429 + body `{ "error": "quota_exceeded", "reset_at": "..." }`
  - [ ] 入库后 Valkey `INCR`
  - [ ] 后台 task 每 60s flush Valkey 计数器到 PG
- [ ] retention 清理：定时 task 每天 drop 超过 retention_days 的 events 分区
- [ ] dashboard 配额 widget：
  - [ ] org settings 页显示 used / limit + 进度条
  - [ ] 用量 ≥ 80% 时全局 banner（红色）
- [ ] 邮件：用量 ≥ 80% / ≥ 100% 各发一封
- [ ] 默认 plan = `free`，新 org 自动 100k 限额
- [ ] **决策**：free tier 数据 30 天保留；pro / enterprise 留到付费上线
- [ ] commit：`feat(saas): free tier quota enforcement and usage metering`

---

## Phase 16 — 生产就绪 + 公开上线 sentori.golia.jp

**Goal:** sentori.golia.jp 公开可注册；监控/告警/备份/runbook 全部就位；自己用 Sentori 监控 Sentori。
**Entry:** Phase 15 完成。
**Exit:** 域名公开访问；dogfooding ≥ 1 周无 P1 事故；上 Show HN 时不会被打挂。
**Estimate:** 2 周。

### Steps

#### 部署底座

- [ ] **决策**：起步 Hetzner CCX23（4 vCPU / 16GB RAM / 80GB SSD）× 2（主备） + 1 个独立 PG VM（CPX21）
- [ ] **决策**：v0.1 不上 k8s，docker compose 即可（简单 + 易调试）
- [ ] **决策**：边缘 Caddy（自动 ACME、HTTP/3）替 nginx
- [ ] 写 `docker/production-compose.yml`：server×2 + caddy + valkey；PG 在独立 VM
- [ ] 写 Caddyfile：domain → server upstream，自动 TLS
- [ ] 配置 Cloudflare：DNS → VM IP（保留 proxy 兜 DDoS）
- [ ] 部署：用 `docker compose pull && up -d` 流程

#### 监控 / 告警

- [ ] **选型**：外部 Better Stack（uptime + status 页 + on-call）+ 内部 Grafana/Prometheus（metrics 详查）
- [ ] server `/metrics` 暴露 prometheus exporter（用 `metrics-exporter-prometheus`）
- [ ] 关键指标：ingestion p50/p99 latency、ingestion error rate、PG pool usage、Valkey latency、disk free %
- [ ] Grafana dashboard：起 1 个 ops 总览
- [ ] 告警规则：
  - [ ] ingestion error rate > 1% / 5min
  - [ ] disk free < 20%
  - [ ] PG pool > 80%
  - [ ] Valkey > 10ms p99
- [ ] Better Stack 监测 7 个 subdomain 的 200 OK + TLS 有效期
- [ ] `status.sentori.golia.jp` 用 Better Stack status 页

#### 日志 / 备份

- [ ] 日志：server stdout → docker → journald；用 `vector` 转 Grafana Cloud Loki（免费 50GB）
- [ ] PG 备份：
  - [ ] `pg_dump` 每天凌晨 → Cloudflare R2（30 天保留）
  - [ ] WAL archiving 到 R2（增量恢复用）
  - [ ] 写 `restore.sh` 脚本
- [ ] 演练：测试一次完整恢复（从备份重建 PG → 应用数据完整）

#### 安全 / 隐私

- [ ] HTTPS only + HSTS（max-age=63072000; includeSubDomains; preload）
- [ ] CORS：dashboard 限同源 + ingest 公开（`Access-Control-Allow-Origin: *`）
- [ ] CSP 收紧：marketing/dashboard
- [ ] secrets 管理：用 `sops` + age key（不硬编码 .env）
- [ ] DDoS：Cloudflare 兜底
- [ ] 写 `docs/legal/privacy.md`（隐私政策）+ `docs/legal/terms.md`（ToS）+ marketing 链接
- [ ] PII 默认行为：SDK 不上传 user.email；只 user.id；服务端不索引 user 字段
- [ ] 数据导出 API（GDPR 风险预防）

#### Testing（回填 v0.1 deferred）

- [ ] iOS XCTest：触发 NSException → 断言 `<Documents>/sentori/pending/*.json` 出现 + 内容反序列化为合法 Event（**回填 Phase 7 line 354**）
- [ ] Android Robolectric：触发 RuntimeException → 断言 `<filesDir>/sentori/pending/*.json` 出现（**回填 Phase 7 line 366**）
- [ ] mailcatcher 集成测试：起 mailcatcher 容器 + 触发新 issue 通过 server → 断言邮件入箱（**回填 Phase 9 line 418**）
- [ ] iOS simulator e2e 自动化：`xcrun simctl install` + `launch` + 通过 deep link / 按钮触发 → poll `/v1/events/_recent`（**回填 Phase 7 line 358 + Phase 4 e2e/run.sh simulator path**）
- [ ] Android emulator e2e 自动化：`adb shell am start` 触发（**回填 Phase 7 line 368 + Phase 4 e2e/run-android.sh**）
- [ ] minified bundle → `sentori-cli upload sourcemap` → 触发错误 → dashboard 验证显示原始位置（**回填 Phase 8 line 394**）
- [ ] GitHub Actions：加 macOS runner 跑 iOS simulator e2e job（**回填 Phase 4 GitHub Actions simulator workflow**）

#### Dogfooding

- [ ] sentori 自己接入 sentori：marketing / dashboard / server 都向自家 prod 报错
- [ ] 跑 ≥ 1 周观察：crash 率、ingestion latency、grouping 准确度、自家邮件告警是否触发

#### Runbook

- [ ] `docs/runbook/incident-response.md`（P1/P2/P3 等级 + 谁联系谁）
- [ ] `docs/runbook/scaling.md`（流量翻倍：横向加 server VM；PG 扩 vertical 一次到顶）
- [ ] `docs/runbook/backup-restore.md`
- [ ] `docs/runbook/deploy.md`（手动 promote staging → prod 的流程）

#### 公开发布

- [ ] 改 `marketing/pricing.astro`：去掉 "Beta 邀请制"，开放注册
- [ ] 写 launch 文章 draft（Hacker News Show HN / dev.to）
- [ ] 准备 demo 视频（30s 录屏：从注册到看到第一条事件）
- [ ] tag `v0.2.0` + GitHub release
- [ ] HN 发文（周二/周三 早上 PT）
- [ ] 🎯 **里程碑：sentori.golia.jp 正式开放**

---

## 跨 Phase 横切关注

整条链都要持续维护：

- **CI 健康**：每个 phase 结束前 `bun run check / test / build` + `cargo test` 全绿
- **commit 节奏**：每个 phase 至少一个 commit；checkbox 跨多 commit 时维持 ROADMAP.md 的进度同步
- **依赖 audit**：`bun audit` + `cargo audit` 进 CI（Phase 10 加）
- **协议契约稳定**：`docs/protocol.md` 改动必须同步改 server `event.rs` 和 sdk `types.ts`，否则 PR 不合格
- **设计语言纪律**：dashboard / marketing 任何 UI 改动以 Linear / Vercel / Modal 为参考，违反则在 PR 描述里说明理由
- **Phase 11 起加部署纪律**：
  - main 分支 commit 自动 build + deploy 到 staging（`staging.sentori.golia.jp` 私有，basic auth）
  - prod 部署：手动 trigger，从 staging 镜像 promote
  - DB migration 必须可逆 + 必须先在 staging 跑过 ≥ 24h
- **Phase 16 起加生产纪律**：
  - 监控告警 7×24（v0.1 单人 on-call = 你）
  - 每月 backup restore 演练 1 次
  - 每季度 dependency audit + security review

---

## 显式不在路线图内的事

下面这些**不**做（至少 v0.1 / v0.2 不做），避免 scope creep：

- ❌ Sentry 协议兼容
- ❌ Session Replay（rrweb 录制 + 回放）
- ❌ Continuous Profiling（火焰图采集）
- ❌ Native crash signal handler（SIGSEGV 等 async-safe 处理）—— Phase 7 只做 NSException / uncaught exception
- ❌ ANR watchdog（Android）—— v0.3 再考虑
- ❌ ClickHouse / Kafka / Snuba / 单独 Relay 进程
- ❌ SSO / SAML —— Phase 13 仅 email + password
- ❌ 信用卡 / 自动计费 —— Phase 15 仅 free tier 配额；pro/enterprise 手动开通
- ❌ 多区域部署 —— v0.1 单区域（建议 ap-northeast）
- ❌ k8s 集群 —— v0.1 docker compose 够用
- ❌ 自定义域名 —— self-hosted 用户用自己域名；SaaS 不支持自定义域
- ❌ Web SDK / Node SDK / Python SDK —— v0.1 仅 RN
- ❌ Slack / JIRA / PagerDuty 集成 —— Phase 9 邮件 + webhook 留接口，下版本接
- ❌ GlitchTip 数据迁移到 Sentori —— `sentry.golia.jp` 现跑 GlitchTip 4.1，sentori 上线后是否下线 GlitchTip / 是否做数据迁移留到 v0.2 决策；v0.1 范围内 `sentry.golia.jp` 和 `sentori.golia.jp` 共存
- ❌ Cloudflare Pages 用于 4 段子域 —— 必须 orange cloud + Advanced Cert ($20/月)，不值；4 段全走 origin Caddy

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
- [x] **Phase 13** — 多租户改造（org / user / membership）
- [x] **Phase 14** — SaaS 自助 onboarding
- [x] **Phase 15** — 配额 / 限流 / usage 计量（free tier）
- [x] **Phase 16** — 生产就绪 + **公开上线 sentori.golia.jp** 🎯（substrate 落地，剩 user 一次性 secrets + push release/）
- [ ] **Phase 17** — SDK 分发链路 + dogfood + qualcomm/insight 真接入

### v0.2（Phase 18–28）

- [ ] **Phase 18** — 账户结构深化（Org / Team / Project / Ownership / Audit）
- [ ] **Phase 19** — RBAC 全栈完善
- [ ] **Phase 20** — Audit log 深化 + 全局活动 feed
- [ ] **Phase 21** — SDK monorepo 抽 core + JS 矩阵扩展（react / next / expo）
- [ ] **Phase 22** — 原生层深化（iOS dSYM / Android Proguard / ANR / Hang）
- [ ] **Phase 23** — Release 管理 UX
- [ ] **Phase 24** — Issues 列表 power-user 化
- [ ] **Phase 25** — Issue 详情页 revamp
- [ ] **Phase 26** — Health metrics（crash-free rate / sessions）
- [ ] **Phase 27** — 告警规则引擎深化
- [ ] **Phase 28** — 全局搜索 + Dashboard polish + a11y + 性能

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
- [x] 顶栏 org switcher（`OrgSwitcher` native select；切换 → `navigate('/org/{slug}/issues')`）
- [x] `/org/:slug/settings`（`OrgSettingsView`）：org 重命名 / 成员列表 + role select（owner-only）+ Remove/Leave / 邀请创建 + pending invites 列表 + Revoke
- [x] `/org/:slug/projects/{id}/settings/recipients`（`RecipientSettingsView`）：增删 `notification_recipients` + on_new_issue / on_regression toggles —— 回填 Phase 9 deferred
- [x] server: 新 `api/recipients.rs` 4 端点（list / create / patch / delete），挂在 `/admin/api/projects/{id}/recipients`，自动经过 `require_admin` + `require_project_in_org`
- [x] 所有 issue/project 路由前缀加 `/org/:slug` —— `/org/:slug/issues[/...]`；`OrgLayout` 提供顶栏 + `OrgCtx`；`/` 由 `RootRedirect` 跳第一个 org 或 `/onboarding`；废弃 `DEV_PROJECT_ID` 写死，`useOrg().currentProject` 给 `IssuesView` / `IssueDetailView` 用
- [x] onboarding：verify 成功后 server 自动 bootstrap personal org（slug ← email 前缀 sanitized + 冲突自动 `-2/-3/...` 后缀，事务原子写入 orgs + memberships）；dashboard `/onboarding` 改造为 fallback 手动建 org form（只在 server 自动建失败或用户失去所有 org 时命中）

#### 测试

- [x] 集成测试 + commit：`scripts/test-phase13.sh` —— 重跑安全（fixture suffix 用 `date +%s%N`），覆盖：
  - [x] register / verify / login + sub-H bootstrap personal org
  - [x] cross-org `GET /admin/api/projects` 隔离（alice ≠ bob 的 projects 列表）
  - [x] alice GET bob's project issues → 403；反向 → 403；本人 → 200；dev token super-admin → 200
  - [x] alice 邀请 bob → bob accept → bob 现在能看 alice 的 project issues（隔离解除）
  - [x] mismatched-email invite → 403 inviteEmailMismatch
- [x] Phase 13 整体收尾（`feat: multi-tenant orgs, users, memberships` 由 sub-A..I 8 个 commit 累计完成）

---

## Phase 14 — SaaS 自助 onboarding

**Goal:** 用户从 `sentori.golia.jp` 注册到拿到第一个 token 接入应用 ≤ 5 分钟。
**Entry:** Phase 13 完成。
**Exit:** 一个新人按 dashboard 引导能 5 分钟内 RN 应用接入并看到第一条事件。
**Estimate:** 1.5 周。

### Steps

- [x] 注册成功后 onboarding wizard（4-step in `views/onboarding.tsx`，state machine derived from server data + manual override for SDK/wait steps）：
  - [x] Step 0: Create org（仅 user 没 membership 时命中——sub-H 自动 bootstrap 多数情况下跳过）
  - [x] Step 1: "Create your first project" → name 输入 → 自动 create project + create default token，raw token 透传到下一步
  - [x] Step 2: "Install the SDK" → 显示 token + ingestUrl + bun install + initSentori snippet + copy button
  - [x] Step 3: "Send your first event" → poll `listIssues(projectId)` 每 3s，第一条 issue 出现自动 navigate to issues
- [x] 顶栏 `OnboardingBadge` 红点：当前 org 没 project 或 first project 没 events（issues count == 0）时显示，点击 → `/onboarding`；refetch 60s；RootRedirect 优先把没 project 的 user 直接跳 onboarding
- [x] 项目设置页：token 管理（生成 / 撤销 / 标签）：
  - [x] migration `0008_tokens_meta.sql`：tokens 加 `label` + `last4`
  - [x] `POST /admin/api/orgs/{slug}/projects` —— User caller 必须是 owner/admin
  - [x] `POST /admin/api/projects/{id}/tokens` —— 返回 raw token 一次（`st_pk_<26 Crockford>` = 32 chars 总），DB 只存 sha256 hash + last4 + label
  - [x] `GET /admin/api/projects/{id}/tokens` —— 列出 metadata（不含 raw）
  - [x] `DELETE /admin/api/projects/{id}/tokens/{tid}` —— 撤销（set revoked_at）；revoked token → /v1/events 401
  - [x] dashboard `/org/:slug/projects/:id/settings/tokens` (`TokenSettingsView`)：generate form (label + kind public/admin) + 一次性 reveal box（copy / dismiss）+ tokens table（label / kind / last4 / created / status / Revoke）；recipient/token settings 互相 cross-link
- [x] 邀请协作者流程：
  - [x] org settings 页"Invite member"（Phase 13 sub-G 已就位）+ server `notifier::OrgInvite` 邮件含 `{base_url}/invite/{token}` 链
  - [x] 邀请链接 `/invite/:token`（`InviteAcceptView`）：未登录 → `Navigate /login?next=/invite/{token}`；已登录 → 自动 `acceptInvite` + StrictMode-safe ref 防双调用 + navigate `/org/{slug}/issues`；错误码（mismatch/expired/used/notFound）映射到友好文案
  - [x] login/register 互相 carry `?next=` 参数；`sanitizeNext` 拒绝跨域/双斜线开放重定向
- [x] 改 marketing 的 "Get Started" 按钮 → 直链 `https://app.sentori.golia.jp/register`（同时保留 docs/github 次级 CTA）
- [x] e2e：`scripts/test-phase14.sh` —— 注册 → verify (sub-H bootstrap) → 登录 → create project → create public token → POST /v1/events 用 token (202) → dashboard 看到 TypeError issue (sub-A 修复 events 用 `state.project_id` 写死的 bug：`auth::IngestCaller` 注入 token's project_id) → revoke token → POST 同事件 → 401
- [x] Phase 14 整体收尾（`feat(saas): self-serve onboarding from registration to first event` 由 sub-A..E 5 个 commit 累计完成）

---

## Phase 15 — 配额 / 限流 / usage 计量（free tier）

**Goal:** Free tier 配额（100k events/月、保留 30 天）执行到位，超额时优雅降级。
**Entry:** Phase 14 完成。
**Exit:** 一个 org 超过 100k events 后新事件被 429 拒收，dashboard 显示 banner，邮件告知 owner。
**Estimate:** 1 周。

### Steps

- [x] migration `0009_quotas.sql`（0008 已用于 tokens_meta）：
  - [x] `org_quotas` (org_id PK FK, plan `org_plan` enum, event_limit_monthly, retention_days, created_at, updated_at) + 22 个现有 org 回填 free 100k/30d
  - [x] `usage_counters` (org_id FK, period_yyyymm, event_count, dropped_count, updated_at, PK(org_id, period_yyyymm))
- [x] server ingestion 路径加 quota check（`quotas::check_and_record`）：
  - [x] 入库前查 Valkey `usage:<org_id>:<yyyymm>`；缺 quota row 时按 free 默认；DevToken / 无 Valkey → 跳过 fail-open
  - [x] 超限 → 429 + body `{"error":"quotaExceeded","resetAt":"<RFC3339 next-month UTC>"}` + INCR `dropped:<org_id>:<yyyymm>`
  - [x] 未超限 INCR `usage:` 并设 32d TTL；返回 Allowed{current,limit}
  - [x] events handler + events_batch handler 都接入（batch 内逐条 gate，超限那条算 rejected error="quotaExceeded"）
  - [x] `IngestCaller::Token` 扩出 `org_id` 字段（auth.rs `lookup_token_row` 单 SELECT 同时取 project_id + org_id），免去 events 路径的 projects join
  - [x] 后台 `quotas::spawn_flush_task` 每 60s `SELECT org_id FROM org_quotas` → GET valkey 双 key → UPSERT `usage_counters`；main.rs 在 db+valkey 都 ready 时 spawn
- [x] retention 清理：`server/src/retention.rs::spawn_retention_task` 每 24h 跑一次 —— `ensure_future_partitions(6 个月)` + `drop_expired_partitions(now - max(retention_days))`，partition 名通过 regex `^events_[0-9]{4}_[0-9]{2}$` + `parse_partition_name` 双重校验防注入；e2e 验证：seed 一个 `events_2020_01` → server 起来 30s 后被 drop，同时新创 `events_2026_09 / 10` 凑齐 6 个月未来 partition
- [x] dashboard 配额 widget：
  - [x] server `GET /api/orgs/{slug}/usage` —— Valkey 优先（实时） + PG `usage_counters` fallback；返回 `{plan, eventLimitMonthly, retentionDays, periodYyyymm, eventCount, droppedCount, percentUsed, resetAt}`
  - [x] org settings 页 `UsageSection`：events used / limit + 进度条（≥80% amber，≥100% red） + dropped count
  - [x] 用量 ≥ 80% 全局 `UsageBanner`（OrgLayout 顶栏下方常驻）：amber 提示 percent，红色 "quota reached" + dropped 计数；refetchInterval 60s
- [x] 邮件：用量 ≥ 80% / ≥ 100% 各发一封 —— `quotas::maybe_warn` 检测 cross-threshold（prev<t && current>=t），用 Valkey `SET notified:<t>:<org>:<period> 1 NX EX 32d` 去重；`NotifyEvent::QuotaWarning` variant + notifier 查 owner/admin 的邮箱发模板邮件（80% warn / 100% reached）；e2e: limit=2 → event 2 单次跨 80+100 两个阈值，log 双行 + Valkey 两 flag
- [x] 默认 plan = `free`，新 org 自动 100k 限额（`server/src/quotas.rs::ensure_default_quota`，挂在 `orgs::create_org` 与 `user_auth::bootstrap_personal_org` 的事务里，ON CONFLICT DO NOTHING）
- [x] **决策**：free tier 数据 30 天保留；pro / enterprise 留到付费上线
- [x] e2e：`scripts/test-phase15.sh` 7/7 阶段全过 —— register + bootstrap → tighten quota=2 → create project+token → 4 events (202/202/429/429) → Valkey usage/dropped/notified flags → 429 body resetAt RFC3339 → `GET /api/orgs/{slug}/usage` 返回 plan/eventCount/percentUsed/droppedCount；不破坏 Phase 13 (6/6) 和 Phase 14 (8/8) smoke
- [x] Phase 15 整体收尾（`feat(saas): free tier quota enforcement and usage metering` 由 sub-A..F 6 个 commit 累计完成）

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
- [x] 写 `docker/production-compose.yml`：blue/green 双 server + caddy + valkey；PG 通过 `DATABASE_URL` 指向独立 VM
- [x] 写 `docker/Caddyfile`：app./api./ingest. 三个 site，自动 ACME TLS、`ip_hash` lb（blue/green session 粘附）+ `/v1/events/_recent` 健康检查、HSTS+CSP+CORS（dashboard 限同源、ingest 公开）
- [x] 写 `docker/README.production.md`：day-zero 部署、blue/green 滚动、回滚步骤
- [ ] **(user-owned)** 配置 Cloudflare：DNS → VM IP（grey cloud, Caddy 出 TLS；apex 仍走 CF Pages 兜 marketing）
- [ ] **(user-owned)** 部署：`docker compose -f production-compose.yml pull && up -d`

#### 监控 / 告警

- [x] **选型**：外部 Better Stack（uptime + status 页 + on-call）+ 内部 Grafana/Prometheus（metrics 详查）
- [x] server `/metrics` 暴露 prometheus exporter（`metrics 0.24` + `metrics-exporter-prometheus 0.16`）—— `server/src/metrics.rs` 用 `OnceLock<Counter/Histogram>` 模块级 cache（macro 直接重复调用在 0.16 + 0.24 组合下不累加，单元测试覆盖）
- [x] 关键指标已暴露：`sentori_ingest_total{status=accepted|rejected|quota_exceeded}`、`sentori_ingest_duration_seconds` (p50/p99 histogram)、`sentori_quota_drops_total`；e2e 验证 5 accepted + 1 rejected counter 累加正确
- [ ] PG pool / Valkey latency metrics（占位 alert 规则在 ops/prometheus-alerts.yml 已写好；exposer follow-up）
- [x] Grafana dashboard：`ops/grafana-sentori-overview.json`（4 panel：ingest rate、p50/p99 latency、quota drops、error rate stat with thresholds）
- [x] 告警规则（`ops/prometheus-alerts.yml`）：
  - [x] `SentoriIngestErrorRateHigh` (rate > 1% / 5m)
  - [x] `SentoriIngestStalled` (rate == 0 for 15m)
  - [x] `HostDiskFreeLow` (< 20%)
  - [x] PG pool / Valkey p99 占位规则（指标 follow-up 后即可启用）
- [ ] **(user-owned)** Better Stack 监测 7 个 subdomain 的 200 OK + TLS 有效期
- [ ] **(user-owned)** `status.sentori.golia.jp` 用 Better Stack status 页

#### 日志 / 备份

- [x] 日志：`ops/vector.toml` —— journald (docker.service / caddy.service) → vector → Grafana Cloud Loki，static labels service/env/unit；JSON parse 提取 tracing 字段；5 MB / 5 s 批
- [x] PG 备份脚本就绪：
  - [x] `ops/backup.sh` —— `pg_dump --format=custom --no-owner --no-acl` → R2 daily/，`rclone delete --min-age 30d` 自动 retention
  - [x] `ops/postgresql.archive.conf` —— `archive_mode=on` + `archive_timeout=300` + `archive_command='rclone copyto %p r2:.../wal/%f'` 给 ≤ 5 min RPO 的 PITR
  - [x] `ops/restore.sh` —— 从 R2 拉 latest 或指定 stamp，DROP+CREATE+pg_restore，强制交互式 `yes` 确认
  - [x] `ops/README.backup.md` —— PG VM / app VM 一次性 setup + recovery drill checklist
- [ ] **(user-owned)** 演练：在 fresh VM 跑一次完整 restore，记下分钟数到 `docs/runbook/backup-restore.md`

#### 安全 / 隐私

- [x] HTTPS only + HSTS（max-age=63072000; includeSubDomains; preload）—— Caddyfile 全局 `security_headers` snippet (sub-A)
- [x] CORS：dashboard 限同源 + ingest 公开 —— api./ingest. site 不同 CORS (sub-A)
- [x] CSP 收紧：dashboard `default-src 'self'; connect-src 'self' api./ingest.` (sub-A)
- [x] secrets 管理：`ops/secrets.md` —— sops + age cookbook（recipient 列表 in `.sops.yaml`，VM 用独立 age key，rotation 流程）
- [ ] **(user-owned)** DDoS：Cloudflare 兜底（CF 控制台 grey/orange 切换 + WAF 规则）
- [x] `docs/legal/privacy.md` + `docs/legal/terms.md`（draft template，需 lawyer review；marketing footer 已加 Privacy/Terms 链）
- [x] PII 默认行为：SDK 不上传 user.email；schema enforce —— SDK `User = {id?, anonymous?}` 已就位 (Phase 1)；server `event::User` 加 `deny_unknown_fields` 强拒 PII；SDK `setUser` JSDoc 明确政策
- [x] 数据导出 API（GDPR 风险预防）：`GET /api/orgs/{slug}/export` —— owner/admin 拿到 org + members + projects (含 tokens metadata + recipients) + pending invites 的 JSON dump，附 `Content-Disposition: attachment; filename=...`（events 全量留 V2，太大）

#### Testing（回填 v0.1 deferred）

- [x] iOS XCTest：`sdk/react-native/ios/Tests/SentoriCrashHandlerTests.swift` —— 通过 `persistForTesting(exception:)` helper 直接驱动 native handler 的 persist 路径（直接 raise NSException 会终止 test runner），断言 `<Documents>/sentori/pending/*.json` 出现 + JSON 反序列化为合法 Event（kind/platform/error.type 匹配）；CI workflow `mobile-e2e.yml::ios-xctest` 走 macOS runner
- [x] Android Robolectric：`sdk/react-native/android/src/test/.../SentoriCrashHandlerTest.kt` —— Robolectric 跑 `installForTesting(ctx)` + `persistForTesting(throwable, thread)`，断言 `<filesDir>/sentori/pending/` 内文件 JSON shape；CI workflow `mobile-e2e.yml::android-robolectric` 走 Ubuntu runner
- [x] mailcatcher 集成测试：`scripts/test-mailcatcher.sh` —— 起 mailpit 容器，注册用户 → notifier 发 verification email → 用 mailpit HTTP API 断言 subject/body 含 verify link；server 加 `SENTORI_SMTP_TLS=plain` env 兼容 mailpit；CI 跑（macOS Docker port-forwarding quirk 在本地可能漏 SMTP banner，Linux runner 无此问题）
- [ ] **(user-owned)** iOS simulator e2e 自动化（`xcrun simctl install` + `launch` + `/v1/events/_recent` poll）—— 工作量大、纯 native build 链路，留作 launch 后 dogfood 用例
- [ ] **(user-owned)** Android emulator e2e 自动化（`adb shell am start`）—— 同上
- [x] minified bundle → `sentori-cli upload sourcemap` → 触发错误 → dashboard 显示原始位置：`scripts/sourcemap-e2e/{run.sh,throw-and-format.js,app.tsx,metro.fixture.config.js}` —— Metro 出 minified bundle + map → cli upload → Node eval bundle 触发 throw → POST 到 server → 拉 admin API + symbolicated=true → 断言 top frame 指向 `app.tsx` 而非 `bundle.js`
- [x] GitHub Actions：`.github/workflows/mobile-e2e.yml` —— 4 jobs (ios-xctest macos-14, android-robolectric ubuntu, mailcatcher with services, sourcemap-e2e)，path filter 限定 `sdk/`、`cli/`、`server/`、`scripts/sourcemap-e2e/` 改动才跑

#### Dogfooding

- [ ] sentori 自己接入 sentori：marketing / dashboard / server 都向自家 prod 报错
- [ ] 跑 ≥ 1 周观察：crash 率、ingestion latency、grouping 准确度、自家邮件告警是否触发

#### Runbook

- [x] `docs/runbook/incident-response.md` —— P1/P2/P3 ladder + on-call rotation + 60s P1 checklist + 显式 NOT-page 列表
- [x] `docs/runbook/scaling.md` —— v0.2 capacity baseline + 横向加 app VM 步骤（更新 Caddy upstream + reload）+ PG vertical resize 阈值表 + 烫手 org 处理（quota first, compute later）+ "我们 yet 不做 autoscaler / 跨 region active-active / SDK 队列"
- [x] `docs/runbook/backup-restore.md` —— 备份矩阵表 + 何时 restore 决策表 + 完整 failover 步骤 + quarterly drill checklist + "Last drill: never" 跟踪
- [x] `docs/runbook/deploy.md` —— pre-flight + cut release + blue/green 滚动（每个 container 间隔 5 min 看 Grafana）+ 双步骤式 destructive migration 模式 + rollback

#### 公开发布

- [x] 改 `marketing/pricing.astro`：去掉 "Beta 邀请制"，开放注册（"$0" 标价 + "Sign up — free →" 直链 `app.sentori.golia.jp/register`，footer 加 Privacy/Terms）
- [x] 写 launch 文章 draft：`docs/launch/show-hn-draft.md`（80 字符 HN 标题 + 体 + 反 obvious-question prep + 跨平台节奏指引）
- [x] 准备 demo 视频脚本：`docs/launch/demo-script.md`（30 秒 storyboard，注册→onboarding wizard→token→dashboard→issue 出现，无 voiceover、burn-in caption）
- [x] 整合 launch checklist：`docs/launch/checklist.md` —— `[code]` vs `[ops]` 标注，跨 Phase 11/12/16 user-owned 全部 inventory
- [ ] **(user-owned)** tag `v0.2.0` + GitHub release notes
- [ ] **(user-owned)** 录视频 + Lawyer review 法律文档 + 配 SPF/DKIM/DMARC + 一周 dogfooding 无 P1
- [ ] **(user-owned)** HN 发文（周二/周三 早上 PT）
- [ ] 🎯 **里程碑：sentori.golia.jp 正式开放**

---

## Phase 17 — SDK 分发链路 + dogfood + qualcomm/insight 真接入

**Goal:** 让 sentori SDK / CLI 从 "git 路径安装" 提升到 "`npm install` / `npx` 一行装"；dashboard onboarding wizard 提供 RN / JavaScript 双 snippet；sentori 自家 web 三个项目接入做 dogfood；最终给 `qualcomm/insight` (Expo RN) 上 sentori。
**Entry:** Phase 16 sub-H ✅。
**Exit:** 任意 RN 或 web 项目能用一行 `bun add @sentori/react-native` (或 `@sentori/javascript`) 装上 + init 即工作；`qualcomm/insight` 在生产抛错能在 sentori dashboard 看到 + symbolicated stack。
**Estimate:** 1.5–2 周。

### Steps

#### sub-A — `@goliapkg/sentori-react-native` npm publish ✅

实际包名 `@goliapkg/sentori-react-native`（@sentori free org 必须 npmjs.com 网页手动创建；规避到 @goliapkg user-controlled scope；brand 仍是 sentori-react-native）。Expo Config Plugin 路径不需要——现有 `expo-module.config.json` + podspec + android/build.gradle 已让 `expo prebuild` autolink。

- [x] `package.json`：0.0.0 → 0.1.0；license MIT、repo / bugs URL、keywords、publishConfig.access=public
- [x] `files` whitelist 加 `android/src/`、`android/build.gradle`、`ios/`、`expo-module.config.json`、`SentoriReactNative.podspec`（86 files / 32 kB tarball）
- [x] `npm publish` —— 0.1.0 上线；`bun add @goliapkg/sentori-react-native` 安装 verified
- [x] 全仓搜替 `@sentori/react-native` → `@goliapkg/sentori-react-native`：web onboarding wizard 三段 snippet、`docs/{getting-started,sdk-react-native}.md`、`docs-site/src/content/docs/{index,getting-started,sdk-react-native}.{mdx,md}`
- [ ] tag-driven `publish-sdk-rn.yml` workflow（与 sub-B 的 CLI release pipeline 一起做）

#### sub-B — `@goliapkg/sentori-cli` 跨平台 prebuilt binary + npm 包装 ✅

- [x] `.github/workflows/release-cli.yml`：tag `cli-v*` 触发 `cargo build --release` 矩阵 (linux-x64 / linux-arm64 / darwin-arm64)，`.tar.gz` + `.sha256` 传到 GitHub Release。darwin-x64 这次跳过（GH-hosted Intel mac runners 排队 stuck）；cargo install 是 fallback
- [x] `cli/npm/`：thin Node wrapper，bin 走 spawn 子进程，postinstall 按 `process.platform-arch` 下载 release 资产到 `vendor/`，`SENTORI_SKIP_DOWNLOAD=1` 逃生
- [x] `npm install -D @goliapkg/sentori-cli` → 二进制下载、`./node_modules/.bin/sentori-cli --help` 正常输出 Rust CLI help
- [x] `docs/sdk-react-native.md` + `docs-site/.../sdk-react-native.md` sourcemap upload snippet 改成 `npx @goliapkg/sentori-cli upload sourcemap ...`
- [x] README 单独说明 bun 用户需 `bun pm trust @goliapkg/sentori-cli`

#### sub-C — Dashboard onboarding wizard SDK 选择 ✅

- [x] `InstallSdkStep` 加两按钮 picker：React Native / JavaScript（默认 RN）
- [x] `sdkSnippets()` helper 按 SDK 分别返回 `install` + `init` 字符串；CodeBlock 复用，复制体验不变

#### sub-D — `@goliapkg/sentori-javascript` (web + node) ✅

实际包名 `@goliapkg/sentori-javascript`（与 sub-A 的 scope 决定一致）。ESM-only（modern Node + browsers + Bun 都吃；CJS dual-build 收益太薄）。

- [x] `sdk/javascript/`：tsc-only build；零运行时依赖
- [x] 核心 surface：`initSentori` / `captureError` / `captureException` / `setUser` / `getUser` / `addBreadcrumb` / `getBreadcrumbs` / `clearBreadcrumbs`
- [x] 浏览器 hooks：`window.error` + `unhandledrejection`，idempotent
- [x] Node hooks：`process.on('uncaughtException' | 'unhandledRejection')`，**故意不 process.exit**（host 拥 crash policy）
- [x] uuid v7 自实现（crypto.getRandomValues + ms timestamp）；stack regex 同时认 V8 与 SpiderMonkey + URL-style file paths
- [x] transport：browser 优先 `navigator.sendBeacon`（小 body + tab close 存活），fallback `fetch keepalive: true`；4xx/5xx silent drop（v0.1 不带 retry queue）
- [x] bun:test 8 个单测（uuid 形态 + 唯一性、stack v8/spider/url、breadcrumb FIFO 100 cap、captureError 正确 POST shape + cause chain）
- [x] `npm publish @goliapkg/sentori-javascript@0.1.0` 上线；`npm install` 起 ESM import + initSentori + captureError 都通

#### sub-E — mailrs `sentori@golia.jp` 密码改 argon2id ✅

- [x] 用 `debian:13-slim` docker 一次性 + `argon2 -id -m 16 -t 3` 生成 hash
- [x] `docker cp` 写入 mailrs container 的 `/data/users.toml` 替换 `password = "..."` 为 `password_hash = "$argon2id$..."`
- [x] mailrs 重启 + STARTTLS + AUTH LOGIN 探活通
- [x] sentori 端 SMTP_PASS secret 不变（明文密码相同），无需 redeploy
- [x] `ops/secrets.md` 加 mailrs SMTP user 完整轮换 playbook

#### sub-F — Sentori 自家 dogfood ✅

- [x] prod 注册 `dogfood-<ts>@golia.jp`、auto-bootstrap personal org `dogfood-<ts>`
- [x] 创建三个 project：`sentori-dashboard`、`sentori-marketing`、`sentori-docs`，各 mint 1 个 public token
- [x] 三个 token 入 sentori repo secrets：`SENTORI_DOGFOOD_{DASHBOARD,MARKETING,DOCS}_TOKEN`
- [x] `web/main.tsx` `import { initSentori } from '@goliapkg/sentori-javascript'`；token 走 `import.meta.env.VITE_SENTORI_TOKEN`，dev 没 token 时 Vite tree-shake 掉 SDK
- [x] `marketing/src/pages/{index,pricing}.astro` 各加 `<script>` 块；Astro bundle 把 SDK 编进 `_astro/*.js` 块；`PUBLIC_SENTORI_TOKEN` 内联进 source
- [x] `docs-site/src/components/Head.astro` 重写 Starlight Head（先 import 默认再 append `<script>`）；同样 PUBLIC_SENTORI_TOKEN
- [x] `docker/Dockerfile.web`：`ARG VITE_SENTORI_TOKEN` + `ARG VITE_GIT_SHA` + `ARG VITE_SENTORI_INGEST` → ENV → COPY → `bun run build`，token 在镜像 build 时被 Vite inline
- [x] `goliajp/devops` `services/sentori/docker-compose.yml` web service `build.args.{VITE_SENTORI_TOKEN, VITE_GIT_SHA}` 从 compose env 取
- [x] `.github/workflows/deploy.yml`：marketing 与 docs build step 各加 `PUBLIC_SENTORI_*_TOKEN` + `PUBLIC_GIT_SHA` env；Write `.env` step 写 `SENTORI_DOGFOOD_DASHBOARD_TOKEN` + `SENTORI_VERSION` 给 docker compose 用
- [x] release/v0.2.0 force-FF 到 main HEAD + `gh workflow run` 触发部署，build/health/smoke 全绿
- [x] 实测：用 marketing 的 build-time inlined token POST `/v1/events` (DogfoodSmokeError) → 落进 `sentori-marketing` project，dashboard listIssues 能看到

#### sub-G — `qualcomm/insight` 接入（Phase 17 的真目的地）

- [x] sentori prod 注册 / 选 org → create project `qualcomm-insight`（dogfood org，project id `019e0ea2-fe14-7451-9441-a22d34e0fbaa`，public token `st_pk_byhzg0spp3xz7g0kgswk7zr4x8`）
- [x] `qualcomm/insight` repo：`bun add @goliapkg/sentori-react-native@0.1.2`（npm scope 决策为 `@goliapkg/*`，因为 `@sentori` 在 npmjs.com 仅 web UI 可创建）
- [x] tenant config 拓展：`TenantInput.sentori?: { ingestUrl; token }` 加到 `src/core/gen/types.ts` + defaults 透传 + `tenants/qualcomm/config.ts` 填值
- [x] bootstrap 接线：新增 `src/core/bootstrap/scripts/sentori.ts`（prod-only `__DEV__` gate，调 `initSentori`，release 串 `${slug}@${ios.version}+${android.versionCode}`），`setup.ts` 在 sentry import 之前 `import './scripts/sentori'`
- [x] 用 qualcomm-insight token 模拟 POST 一条事件到 `ingest.sentori.golia.jp/v1/events` → 202 → dashboard 看到 `QualcommInsightSmoke` issue（验证 token + ingest + grouping 全链路工作）
- [x] commit `qualcomm/insight` changes（commit `0f3fa68b`，`feat: install sentori RN SDK alongside existing sentry`）
- [ ] iOS：`expo prebuild` + `pod install` + run on simulator → trigger test error → 验证 dashboard 看到（**留给下一次 qualcomm/insight 真机/simulator build cycle**，不在自动化范围内）
- [ ] Android：同上（同上原因）
- [ ] EAS build hook：上传 source map (`@sentori/cli upload sourcemap`) 到 sentori，confirm dashboard 显示原始位置（**等首个 RN bundle ship 后再启用**）
- [ ] 🎯 **里程碑：sentori 接住第一个真实生产 RN 应用**（JS-layer 已就位 + token 已 verify；待下一次 qualcomm/insight 真机 build 跑出第一条 native 事件即勾掉）

#### 实际部署落地（Phase 16 sub-H — 通过 devops infra 接入，而非原计划的"Hetzner + 独立 Caddy"）

- [x] `goliajp/devops` repo `services/sentori/{docker-compose.yml, README.md}`：postgres + valkey + sentori-server + sentori-web + marketing nginx + docs nginx，类比 portal/tasks 部署形态
- [x] `goliajp/devops` repo `devices/cloud/t01/caddy/Caddyfile` 加 5 个站点（apex sentori / app / api / ingest / docs），通过 `devops caddy deploy t01` push + reload + LE 证书 provision 完成
- [x] DNS 5 个 CNAME records (`sentori`, `app.sentori`, `api.sentori`, `ingest.sentori`, `docs.sentori` → `t01.golia.jp.`) 通过 devops API + `devops dns sync golia.jp` 推到 Cloudflare live
- [x] `goliajp/sentori` repo `.github/workflows/deploy.yml`：lx64 self-hosted runner 监听 push 到 `release/*`，rsync source + build marketing/docs + 写 .env + `docker compose build && up -d` + 健康检查 + 公开 surface smoke (server `/v1/events/_recent`、`/metrics`、`/api/auth/me`、web、marketing、docs 全 200/401)
- [x] `gh secret set` 一次性配 8 个 secrets（PG / DEV_TOKEN / ADMIN / SESSION + SMTP 4 项预填空，user 后续可自行填真 SMTP）；org-level runner group 开 `allows_public_repositories=true`
- [x] `git push origin main:release/v0.2.0` + `gh workflow run deploy --ref release/v0.2.0` 触发 deploy；workflow 全绿，5 个子域 live：
  - https://sentori.golia.jp → marketing 200
  - https://docs.sentori.golia.jp → Starlight 200
  - https://app.sentori.golia.jp → dashboard SPA 200
  - https://api.sentori.golia.jp/api/auth/me → 401（auth gate 工作）
  - https://ingest.sentori.golia.jp/v1/events/_recent → 401（token gate 工作）
- [x] prod e2e 通过：注册 → verify → login → 自动 bootstrap personal org → create project → create public token → POST event 到 `ingest.sentori.golia.jp` (202) → dashboard 看到 issue (grouping work)
- [x] SMTP 走 `mail.golia.ai`（goliajp/mailrs）—— 在 mailrs `/data/users.toml` 加 `sentori@golia.jp` 作 SMTP submission user（plain pw，mailrs verifies 通过 users.toml first-tier）；6 个 `SENTORI_SMTP_*` secrets 更新指向 mailrs（mail.golia.ai:587 STARTTLS）；redeploy 后 register flow log "verification email sent"，邮件确认落到 mailrs `/data/maildir/golia.jp/<recipient>/new/` 内含正确 `[Sentori] Verify your email` subject + verify link body；DKIM/SPF 走现有 golia.jp zone 配置（`golia.jp` SPF 已含 `a:mail.golia.ai`）

---

## v0.2 路线图（Phase 18–28）

**主线：** Phase 0–17 解决了 "能跑 + 能上 prod + 能装到一个真 RN app"。v0.2 三大板块按线性推进——

1. **账户结构骨架（Phase 18–20）**：org → team → project 三层 + RBAC + audit log。先这一块的原因：所有后续 admin / project-scoped UI 都要靠它判权限，不先做后面会四处补丁。
2. **SDK 矩阵 + 原生深度（Phase 21–22）**：抽 `sdk/core` workspace；用它衍生 `react / next / expo`；iOS dSYM + Android proguard + ANR 上提 native 通路完整度。
3. **数据呈现（Phase 23–28）**：Release 一等公民 → Issues 列表 power-user 化 → Issue 详情 revamp → Health / 搜索 / 告警引擎 / Polish。

每个 phase 内 sub-A → sub-Z 严格线性，不跳；exit 全勾才进下一 phase。下面所有 file path 是 monorepo 相对路径，绝对值 `goliajp/sentori/<path>`。

---

## Phase 18 — 账户结构深化（Org / Team / Project / Ownership / Audit）

**Goal:** 把扁平 "org + member/owner" 升级为 "org → team → project" 三层；加 ownership 转让 + audit log。

**Entry:** Phase 17 sub-G ✅。

**Exit:**
- 一个 org 可以有 N 个 team；team 有自己的成员集；project 多对多绑定到 team
- Project 操作受 ACL：user 必须是该 project 关联 team 的成员，**或** org-admin
- Owner 可发起转让；接收方点邮件链接确认才生效；事务原子
- 所有写操作（create/update/delete on org/team/project/membership/token）落 audit_logs，dashboard 设置页可查
- 邀请流支持 "邀请到 team X"，accept 时事务内同时插 membership + team_membership

**Estimate:** 2.5–3 周

### Steps

#### sub-A — schema + migration ✅

- [x] 新表 `teams`(id uuid v7, org_id, slug, name, description, created_at)；UNIQUE(org_id, slug)
- [x] 新表 `team_memberships`(team_id, user_id, role: lead|member, created_at)；PK(team_id, user_id)（viewer 由 Phase 19 sub-A 加，一并和 org 级 viewer/billing_admin 落地）
- [x] 新表 `project_teams`(project_id, team_id)；PK(project_id, team_id)；级联 ON DELETE CASCADE
- [x] 新表 `audit_logs`(id uuid v7, org_id, actor_user_id, action text, target_type text, target_id uuid, payload jsonb, created_at)；INDEX(org_id, created_at DESC) + actor + target
- [x] 新表 `org_ownership_transfers`(id uuid v7, org_id, from_user_id, to_user_id, token text UNIQUE, expires_at, accepted_at NULL)
- [x] migration `server/migrations/0010_phase18_orgs.sql`，含外键 + 索引；本地 sentori-pg 应用通过；commit `5ec39d0`
- [ ] `cargo sqlx prepare`；提交 `.sqlx/`（推迟到 sub-B 写完 query 一并跑）

#### sub-B — server: Team CRUD + ACL middleware ✅

- [x] `server/src/api/teams.rs` 团队 CRUD + member CRUD：routes 在 `/api/orgs/{slug}/teams[/{team_slug}/...]`（不是 `/admin/api/...`，因为团队是 org 概念，复用既有 `require_user` 路由分组）
- [x] `server/src/api/teams.rs` 加 `list_team_projects / list_project_teams / assign_project_to_team / unassign_project_from_team`：project↔team 绑定 endpoints 在 `/admin/api/projects/{id}/teams[/{team_slug}]`（admin 路由，需要 owner/admin 角色）
- [ ] ~~`server/src/auth.rs`：`AuthCtx` 加 `team_ids_for_org(org_id) -> Vec<Uuid>` (Valkey 30s 缓存)~~ — 推迟；当前 inline 两条 query 简单且 dev 流量下零成本，等 Phase 23 perf 真有压力再上缓存
- [x] 拓展 `admin_auth::require_project_in_org`（不开新 extractor）：未绑团队 → 任意 org 成员通过；绑了团队 → 必须在某关联 team 中 OR org owner/admin
- [x] `projects.rs / tokens.rs / issue endpoints` 已经全部走 admin 路由，自动被改造后的 middleware 覆盖
- [x] tests：`server/tests/teams.rs` 两个 case：(1) owner 建 team 200 / plain member 建 team 403 / member 给自己加 team 403；(2) 绑团队后 in-team 成员 200 / out-of-team 成员 403 / owner 200。本地 sentori-pg `cargo test` 全 12 个测试 pass。commit `4398d4b`

#### sub-C — server: Ownership transfer + audit log ✅

- [x] `audit::record(pool, org_id, actor, action, target_type, target_id, payload)` helper：`server/src/audit.rs`，含 actions / targets 字符串常量；写失败仅 log 不阻塞业务路径
- [x] mutating endpoint 接 `audit::record`：org create / patch, member role / remove, team create / delete / member-add / member-remove, project create, project↔team bind / unbind, token create / revoke, transfer requested / accepted；team patch / team-member patch / invite create-delete 留给 Phase 20 sub-A 一并扫
- [x] `POST /api/orgs/{slug}/transfer`：owner only，body `{toUserId}`，target 必须当前是 admin/owner；写 `org_ownership_transfers` + 发邮件 + audit
- [x] `POST /api/orgs/transfers/{token}/accept`：to_user 登录态；事务内 swap role + 镜像 `orgs.owner_id` + 标 accepted_at
- [x] `notifier::OwnershipTransferRequested` 邮件模板（7-day confirm link）
- [x] `GET /api/orgs/{slug}/audit?limit=&before=&action=&actorUserId=&targetType=`：owner/admin only，DESC by created_at，joined users.email 显示 actor
- [x] 注：`org.deleted` 因 FK cascade 落不下 audit 行，改 emit 一条 tracing log；Phase 20 sub-A 把 audit_logs 移出 cascade
- [x] tests：(1) happy path：role swap / owner_id 镜像 / replay 拒绝 / 错误 caller 403；(2) 非 eligible target / 非 org 用户 / 非 owner caller 全拒；(3) audit list owner 200 + 含 org.created + team.created / member 403 / `?action=team.created` 过滤生效；本地 sentori-pg `cargo test` 全 17 个 pass。commit `1fc9bc9`

#### sub-D — dashboard: Team 管理 UI

- [ ] `web/src/views/team-list.tsx`：org-settings 增 Teams tab；表格 + create button
- [ ] `web/src/views/team-detail.tsx`：成员表 + project assignments + 编辑 lead/role
- [ ] `web/src/api/client.ts` 增 `teamsApi.{list,create,patch,delete,addMember,removeMember,assignProject,unassignProject}`
- [ ] `OrgSwitcher` 改两层：`Org > Team`；选 team 后 issues 列表自动 filter

#### sub-E — dashboard: Project ↔ Team 绑定 + 角色 chip

- [ ] Project settings 加 "Teams" 段：多选 team checkbox（org-admin only）
- [ ] Member detail modal 显示用户所属 team chips
- [ ] role badge（admin / lead / member / viewer）design：颜色 + 缩写
- [ ] 受限按钮按 role 隐藏：用 `useHasPermission(action, scope)` hook（scope=org|team|project）

#### sub-F — Invite 流扩展

- [ ] `OrgInvite` payload 加可选 `team_id`
- [ ] dashboard invite modal 加 "Add to team" 单选
- [ ] accept 接口事务内同时 insert memberships + team_memberships（如有）
- [ ] tests：邀请到 team 后 invitee 自动有 team 访问

#### sub-G — Ownership transfer UX

- [ ] org-settings "Transfer ownership" button（owner only）
- [ ] confirmation modal：select new owner from owner-eligible (admin) members + 输入 org slug 二次确认
- [ ] 接收方点邮件链接 → dashboard 自动跳 `/orgs/{slug}/transfers/{token}/accept` → 显示 "Accept ownership of <Org>" 模态
- [ ] 转让后 toast + 旧 owner 邮件通知 "ownership transferred to ..."

#### sub-H — Audit log viewer

- [ ] org-settings "Audit log" tab；list with actor / action / target / time + 折叠 payload JSON
- [ ] filter UI：actor combobox / action select / date range picker
- [ ] CSV 导出 button

#### sub-I — tests + docs + 收尾

- [ ] server integration tests 覆盖 sub-B/C 的 ACL 矩阵（admin × member × viewer × non-member × 4 个 endpoint）
- [ ] dashboard e2e（playwright in `web/tests/`）：create team → assign project → invite member → 验证只看到该 team 的 project
- [ ] `docs-site/src/content/docs/teams.md` 写法指南 + 截图
- [ ] commit + push；勾完所有 checkbox

---

## Phase 19 — RBAC 全栈完善

**Goal:** 把 Phase 18 的 role 列字段做成完整的 permission matrix；server endpoint 标 min role；dashboard 全 button role-aware。

**Entry:** Phase 18 ✅

**Exit:**
- Roles：`org_admin / org_member / team_lead / team_member / viewer / billing_admin`（billing_admin 预留）
- 服务端所有 endpoint 标注 min role；middleware 强制；非授权 403
- dashboard 所有 mutating button / menu 调 `useHasPermission()`，不满足直接不渲染（不只是 disabled）
- 角色升降级 UI（member detail modal 内）

**Estimate:** 1.5 周

### Steps

#### sub-A — Role 字段拓展
- [ ] `memberships.role` enum 加 `viewer` + `billing_admin`
- [ ] `team_memberships.role` 加 `viewer`
- [ ] migration `00XX_roles_v2.sql` + sqlx prepare

#### sub-B — server middleware
- [ ] `auth::Role` enum 全列；定义 `pub fn min_role(action: PermissionAction) -> Role`
- [ ] `RequireRole(min_role)` extractor
- [ ] 所有 admin api endpoint 添加 min role 标注（重构而不是新增）
- [ ] tests：viewer 只读、不能 create token / resolve issue / invite

#### sub-C — `useHasPermission` hook + UI gating
- [ ] `web/src/auth/permissions.ts` 定义 `PermissionAction` 联合 + role → action 表
- [ ] `useHasPermission(action: PermissionAction, scope?: { orgSlug, teamSlug?, projectId? })`
- [ ] 全 dashboard 走查每个 button：包 `<PermissionGate action="...">{...}</PermissionGate>`
- [ ] role badge 在 user avatar 旁

#### sub-D — Role 升降级 UI
- [ ] member detail modal：role dropdown（admin only）
- [ ] downgrade owner / promote to admin 二次确认
- [ ] tests + docs

---

## Phase 20 — Audit log 深化 + 全局活动 feed

**Goal:** Phase 18 已落 audit_logs；这阶段把它做成可观察的产品功能（不是只查日志）。

**Entry:** Phase 19 ✅

**Exit:**
- Audit log 全 action 类型枚举化 + 文档化
- Per-user "我做的事" feed
- Per-org "组织活动" 时间线
- API 输出对接 webhook（Phase 27 才接，但 schema 这阶段定）

**Estimate:** 1 周

### Steps

- [ ] sub-A：`AuditAction` enum 化 + i18n key 对应 human-readable 描述
- [ ] sub-B：dashboard org-settings/audit 页：actor / action / target / time + 折叠 JSON payload
- [ ] sub-C：dashboard user-settings/activity 页：当前 user 全 org 内的动作流
- [ ] sub-D：webhook payload schema 写到 `docs/protocol.md`（Phase 27 实现）
- [ ] sub-E：CSV 导出 + tests

---

## Phase 21 — SDK monorepo 抽 core + JS 矩阵扩展

**Goal:** 抽 `sdk/core` 作为共享 workspace package；衍生 `@goliapkg/sentori-{javascript,react,next,expo,react-native}` 都依赖它。覆盖主流 web 框架。

**Entry:** Phase 20 ✅

**Exit:**
- monorepo workspace 启用（root package.json + workspaces）
- `sdk/core/` 内含 types / config / transport / breadcrumbs / capture / stack / uuid / queue
- 所有 SDK 包仅做 framework adapter，业务逻辑在 core
- 4 个新 npm 包：`@goliapkg/sentori-{core,react,next,expo}`，docs site 各 1 篇 reference
- React 包：`<SentoriProvider>` + `<SentoriErrorBoundary>` + `useSentori()` + `useCaptureError()`
- Next 包：自动 capture App Router error.tsx + Pages dir + server actions + edge runtime
- Expo 包：Config Plugin（pod / gradle 自动） + EAS post-build hook 上传 source map

**Estimate:** 2 周

### Steps

#### sub-A — 抽 `sdk/core/`
- [ ] 新 workspace package `@goliapkg/sentori-core`
- [ ] 把 javascript SDK 中通用部分（types / transport / capture / breadcrumbs / stack / uuid / config）搬到 core
- [ ] javascript / react-native 包改成 depend `@goliapkg/sentori-core`
- [ ] 全 SDK 包重新构建 + 测试通过；publish patch 版本（rn 0.1.4, javascript 0.1.1, core 0.1.0）

#### sub-B — `@goliapkg/sentori-react`
- [ ] 新 `sdk/react/`
- [ ] `<SentoriProvider config={...}>` 包 init + context
- [ ] `<SentoriErrorBoundary fallback={...}>`：React 18 ErrorBoundary 模式
- [ ] `useSentori()` 暴露 `captureError / setUser / addBreadcrumb`
- [ ] `useCaptureError()` 异步函数包装
- [ ] tests + tsup build；publish 0.1.0

#### sub-C — `@goliapkg/sentori-next`
- [ ] 新 `sdk/next/`
- [ ] `withSentori(nextConfig)`
- [ ] App Router `app/error.tsx` template + `instrumentation.ts` 自动注入
- [ ] `Sentori.middleware()` for edge runtime
- [ ] `onRequestError` 接 server action
- [ ] publish 0.1.0

#### sub-D — `@goliapkg/sentori-expo`
- [ ] 新 `sdk/expo/`
- [ ] `app.plugin.js` Config Plugin：iOS pod link + Android gradle 自动添加
- [ ] `expo-application` 元数据自动注入 init（bundleId / version）
- [ ] EAS post-build hook `scripts/eas-post-build.sh`：自动调 `sentori-cli upload sourcemap`
- [ ] publish 0.1.0

#### sub-E — Vue / Svelte 设计文档（不实现）
- [ ] `docs-site/src/content/docs/sdk-vue.md` API surface 草稿
- [ ] `docs-site/src/content/docs/sdk-svelte.md` 草稿
- [ ] mark "TBD v0.3+"

#### sub-F — onboarding wizard 多 SDK
- [ ] dashboard onboarding 加 React / Next / Expo / RN / vanilla JS 五选
- [ ] 每个 SDK 一段 install + init snippet（自动注入 token）
- [ ] tests

---

## Phase 22 — 原生层深化（iOS dSYM / Android Proguard / ANR / Hang）

**Goal:** native crash 端到端：上传 mapping → 服务端反符号化 → dashboard 显示原始位置 + ANR / hang 检测。

**Entry:** Phase 21 ✅

**Exit:**
- iOS dSYM 上传 + 服务端 atos 解析；dashboard issue 详情 frame 行显示原始 file:line
- Android Proguard mapping 上传 + retrace；同上
- Android ANR detection（5s main thread block）
- iOS hang detection（best-effort，runloop 阻塞 ≥ 2s）
- mapping/dSYM 按 release 串绑

**Estimate:** 2.5 周

### Steps

#### sub-A — CLI: dSYM 上传
- [ ] `cli/src/main.rs` 加 `upload dsym --project <id> --release <ver> <path>`
- [ ] 服务端 `POST /admin/api/projects/{id}/dsyms`：multipart；存 PG bytea + metadata（uuid / arch / release）
- [ ] dashboard release 详情显示 dSYM 列表

#### sub-B — server: iOS 反符号化
- [ ] `server/src/symbolicate.rs` 加 dSYM-based path：spawn `atos -arch arm64 -o <dsym> -l <load_addr> <pc>`
- [ ] dSYM 临时落盘（/tmp/dsyms/{uuid}.dSYM）+ LRU 缓存
- [ ] tests：mock dSYM（mini Mach-O）

#### sub-C — CLI + server: Android proguard
- [ ] `sentori-cli upload mapping --project <id> --release <ver> <mapping.txt>`
- [ ] 服务端 `POST /admin/api/projects/{id}/mappings`
- [ ] symbolicate 加 retrace（用 `proguard-rs` crate 或 spawn `proguard-retrace`）

#### sub-D — Android ANR detection
- [ ] SDK Android 加 ANR watchdog（worker thread 每 1s ping main，连续 5s 无响应 dump main thread + 上报）
- [ ] event kind 加 "anr"；dashboard issue 列表 ANR 图标 + filter chip

#### sub-E — iOS hang detection
- [ ] main thread observer：runloop 阻塞 > 250ms warning；> 2s 上报为 "hang"
- [ ] event kind 加 "hang"；同样 UI 处理

#### sub-F — release-aware symbolication
- [ ] dSYM/mapping 上传时按 release 串绑（uuid match）
- [ ] dashboard release 详情显示已上传 mapping/dSYM 状态 + size + uploadedAt
- [ ] symbolicate 拒绝跨 release lookup（按 release 隔离）

---

## Phase 23 — Release 管理 UX

**Goal:** Release 一等公民。Dashboard 有 Releases 列表 + 详情；deploy webhook + regression detection。

**Entry:** Phase 22 ✅

**Exit:**
- Releases 列表页（每 release 卡片：版本 / env / source map / dSYM / 首末次见 / regressions）
- Release 详情页（uploaded artifacts 树 + event timeline + 比较前一 release）
- `POST /v1/deploys` webhook + dashboard 显示 deploy timeline
- Regression detection（issue 已 resolved 然后 release X 后又出现 → 标 regression）
- Compare-releases 视图（diff issues：新出 / 修了 / 仍存）

**Estimate:** 1.5 周

### Steps
- [ ] sub-A：`releases` 表 schema 完善（已有最小，加 deploy_at / source_maps_count / dsym_count）
- [ ] sub-B：dashboard `web/src/views/releases.tsx` 列表
- [ ] sub-C：dashboard `web/src/views/release-detail.tsx` 详情
- [ ] sub-D：`POST /v1/deploys` 接口 + auth（用 token）
- [ ] sub-E：regression 检测（cron job + on-event 双触发）
- [ ] sub-F：compare-releases 视图

---

## Phase 24 — Issues 列表 power-user 化

**Goal:** filter query 语法 + 列配置 + 保存视图 + 批量操作。

**Entry:** Phase 23 ✅

**Exit:**
- Query 语法（`errorType:TypeError environment:prod last:7d release:1.2.3 status:unresolved`）前后端共用 parser
- 列配置：show/hide errorType / count / lastSeen / env / release / assignee（localStorage 持久化）
- 保存视图：个人 + 共享 org/team 内
- Bulk select + bulk resolve / ignore / assign
- 密度切换 compact / cozy（应用到所有表格）

**Estimate:** 1.5 周

### Steps
- [ ] sub-A：query parser（`web/src/lib/query.ts` + `server/src/api/issues_query.rs` 共享 grammar）
- [ ] sub-B：列配置 UI + persistence
- [ ] sub-C：`saved_views` 表 + UI（org/team/personal scope）
- [ ] sub-D：bulk action endpoint + UI
- [ ] sub-E：density toggle global state + 应用

---

## Phase 25 — Issue 详情页 revamp

**Goal:** 一屏调试。Tabbed 布局 / inline source / breadcrumb 时间轴 / activity log。

**Entry:** Phase 24 ✅

**Exit:**
- Tabs：Stack | Events | Breadcrumbs | Tags | Activity（URL hash 保留状态）
- Frame 行 click → inline source 抽屉（用 source map 反查）
- Breadcrumb 时间轴：可折叠 group + 类型颜色
- Related events 侧栏（同 fingerprint）
- Comment thread + activity log
- Status / assign / "mark as fixed in release X" 流

**Estimate:** 2 周

### Steps
- [ ] sub-A：tab layout shell + URL hash 路由
- [ ] sub-B：inline source 抽屉 + 服务端 `GET /admin/api/issues/{id}/frames/{idx}/source` 返回原始片段
- [ ] sub-C：breadcrumb 时间轴组件
- [ ] sub-D：related events 侧栏
- [ ] sub-E：comments + activity log（attached 到 issue 的 audit_logs subset）
- [ ] sub-F：assign / status / "fixed in release" 流（regression 联动 Phase 23）

---

## Phase 26 — Health metrics（crash-free rate / sessions）

**Goal:** 轻量 session-aware。不做 session replay。

**Entry:** Phase 25 ✅

**Exit:**
- SDK init / close 触发 session ping（open / close / errored）
- crash-free user / session per release / per env
- Health widget on overview page
- Per-release health 对比

**Estimate:** 1.5 周

### Steps
- [ ] sub-A：协议加 session ping（`POST /v1/sessions`）
- [ ] sub-B：SDK lifecycle（RN: foreground 开 / background close / crash 标 errored；JS: pageshow/pagehide）
- [ ] sub-C：`sessions` 表 + 聚合 query（5min bucket）
- [ ] sub-D：dashboard 健康 widget on overview
- [ ] sub-E：per-release 对比 + alerting hook（Phase 27）

---

## Phase 27 — 告警规则引擎深化

**Goal:** 真 rule engine（不只 "新 issue 发邮件"）。

**Entry:** Phase 26 ✅

**Exit:**
- Rule schema：trigger（count > N in T window / fingerprint match / regression / health drop）+ filter（env, release, fingerprint regex）+ throttle window
- Per-rule recipient routing + 多 channel（email / webhook）
- Webhook channel 实现（Phase 20 schema 落地）
- Daily / weekly digest
- Mute / snooze

**Estimate:** 2 周

### Steps
- [ ] sub-A：`alert_rules` schema
- [ ] sub-B：rule evaluator（每 min cron + on-event 双触发）
- [ ] sub-C：UI 创建 / 编辑 rule
- [ ] sub-D：webhook channel + signature verification
- [ ] sub-E：digest（cron + opt-in）
- [ ] sub-F：mute / snooze

---

## Phase 28 — 全局搜索 + Dashboard polish + a11y + 性能

**Goal:** Cmd+K 全局；最后一公里打磨。

**Entry:** Phase 27 ✅

**Exit:**
- Cmd+K palette：跨 org / team / project / issue / member 跳转 + 最近访问
- 键盘快捷键 cheatsheet（`?` 弹出）
- a11y audit pass（WCAG AA）
- Bundle 分析 + code splitting；首屏 < 200KB gzip
- Empty / loading / error state 全 dashboard 一致化
- Theme 微调（Linear-tight density / token 化）

**Estimate:** 2 周

### Steps
- [ ] sub-A：Cmd+K palette 组件 + `GET /admin/api/search?q=&types=` PG full-text
- [ ] sub-B：键盘快捷键 system + `?` cheatsheet
- [ ] sub-C：a11y audit + 修
- [ ] sub-D：bundle 分析 + route-level code splitting
- [ ] sub-E：empty / loading / error 一致化
- [ ] sub-F：theme 微调 + 设计 token 文档化（marketing + docs + dashboard 共用）

---

## v0.2 范围外（Phase 29+ 待规划，不在本次 roadmap 内）

下面这些**非 v0.2 工作**，提示防 scope creep：
- Slack / JIRA / PagerDuty 集成（webhook 落地后下一步）
- Grafana / Prometheus 数据源插件
- CLI extras（issue resolve / list 等）
- IPv6 ingest 优化、HTTP/3、Brotli
- Replay / profiling
- AI-assisted root-cause hint（事件聚类 / 可疑 commit 关联）

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

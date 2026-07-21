# Sentori CHANGELOG

> v0.1 + v0.2 已完成 phase 的详细记录（含每条 sub 的中文 summary）。新规划见 [ROADMAP.md](./ROADMAP.md) + [docs/roadmap/v1.0.md](./docs/roadmap/v1.0.md)。

> 本文件由 ROADMAP.md 历史段拆分而来，每条记录的真实落地凭证以 git log + commit message 为准。

---

## v1.7.1(2026-07-21 — 配额超限返回 402 而非 429,避免 RN SDK 重试 churn)

紧跟 v1.7.0 的行为修正。月度配额用尽本不该是 429:RN SDK 把每个 429 当"稍后重试" —— 读响应体 `retryAfterMs`(v1.7.0 的 server 从不发 → 默认 5s),退避重试 `MAX_RETRY` 次,再把批次 persist 到 AsyncStorage 离线队列、下次 session 继续发。对一个整月都不会恢复的配额,这就是对注定失败的批次反复重试 = 白耗 host app 电量/网络,正好踩"Sentori 不能给 host app 造成抖动"的铁律。

改为返回 **402 Payment Required**:所有 SDK 对非-429 的 4xx 都静默 drop(JS `status >= 400` → drop;RN 落在 429/5xx 两个分支之外 → 不重试、不 persist),已部署客户端零改动即止 churn,**无需更新任何 SDK**。402 语义也更准("到 plan 上限了,升级继续")。429 留给短期 per-token 速率限制(带 `retryAfterMs`,正是 RN 那段重试逻辑的本意)。

5 条真实 ingest 路径(events / spans + 各自 batch + replay 附件)全部切到 402;`docs/protocol.md` 补 402 响应码说明。

---

## v1.7.0(2026-07-21 — SaaS 接入与管理:真多租户 + 计费执行 + Stripe 自助 + onboarding)

把 SaaS 化从"地基"推到"能收钱、能管理、能自助接入"的完整闭环。

**多租户地基**
- register 事务内建 personal workspace + owner membership;session 携带 active workspace,每请求校验 membership;`AppState::identity_for/billing_for` 按请求 workspace 取 handle;一批 handler 从默认 workspace 切到 `ctx.workspace_id` + guard;工作区切换器(API + 侧栏);invite accept(`/admin/api/invites/accept` + `/invite` 页);RBAC 门 + saasadmin 默认拒绝;migration 0033 backfill membership。

**计费执行**
- 真实 SDK ingest 三类事件(events / spans / replays)接入配额计量(此前只有 legacy stub 计量):新 `sdk::quota::meter` helper,batch 按批量条数原子检,replay 附件才计 Replays;计量后端故障 fail-open,不因 usage 表抖动丢客户遥测。
- 配额 status-aware:新纯函数 `effective_plan(plan, status)` —— canceled / unpaid 降级到 Free 限额,past_due 保留(Stripe dunning 宽限);运营 suspend 改写 `canceled`(真正生效),不再是无执行力的 past_due。
- 修多租户读侧串数据:`workspace_usage` / `/v1/usage` 原按 boot 默认 workspace 读并汇总全体租户,改为按调用者 active workspace scope。

**Stripe 自助控制面**
- migration 0034 加 `stripe_events`(webhook 去重 + worker 台账)。
- `POST /webhooks/stripe`(HMAC 验签)+ 后台 billing worker 消费:checkout.session.completed 绑定 customer;subscription.created/updated 设 plan + status + period;deleted → canceled;invoice.payment_failed → past_due。
- 自助端点 `GET/POST /admin/api/billing{,/checkout,/portal}`(Owner/Admin 门)+ 运营 override `POST /admin/api/saas/workspaces/{id}/plan`。商业参数(price id / key / URL)全走 env,不硬编码。

**接入 onboarding**
- Billing dashboard 页(plan / status / usage bars / Checkout 升级 / Portal 管理 / 回调 banner;无 Stripe key 时降级为运营提示)。
- Overview 空态 → 4 步 first-run 引导;Tokens 页 Quickstart 卡显式展示 ingest URL(SDK 默认值)+ `sentori.init()` 片段(prefill 刚 mint 的 token);SaasAdmin 每行 plan 选择器。

**待配**:Stripe 运行时端到端需部署侧配 `SENTORI_STRIPE_SECRET_KEY` / `SENTORI_STRIPE_PRICE_*` / `SENTORI_STRIPE_WEBHOOK_SECRET` / `SENTORI_PUBLIC_URL` 后验证。

---

## v1.6.2(2026-07-21 — 依赖全面升级到最新 stable)

覆盖所有 workspace 与前端包,目标是消除 dependabot 的过期告警并把每个包带到它能到的最新。

**Rust**(1.97.1 已是 latest stable,各 workspace `rust-version` 一致)
- 六个 workspace 108 个包更新到最新兼容(补丁/小版本);除下述 wasmtime 外无 crate 落后大版本
- `generic-array` 弃用 `GenericArray::as_slice`,`webpush_encrypt` 的 HKDF 推导改用 deref borrow —— 一小时前刚提到阻塞级的 clippy 门抓住的,位置在 WebPush 加密路径
- **wasmtime 39 → 47**(legacy `server/` 的 dev 依赖)。它支撑 `tests/wasm_score.rs` 的信任分数 kernel 回归测试(5 断言,加载前端也在跑的 `sentori_score.wasm`);用的都是稳定核心 API,升级仅动 lockfile,5 断言在 47 上全过

**JS**
- webapp(vite 6→8、plugin-react 4→6、react 19.2)、web(react-router 7→8、jest-dom 6→7)、marketing/docs-site(sharp、sentori-javascript 0.1→1.3)、10 个 SDK(TypeScript 6→7)全部到各自能到的最新
- webapp 强制改动一处:tsconfig 加 `"types": ["vite/client"]`(TS 严格化后 side-effect CSS import 需要,与 web/ 已有约定一致)

**Tailwind webapp v3 → v4** —— 零视觉变化。theme 从 `tailwind.config.js` 迁入 CSS `@theme`,自定义 token(brand/字体)与约 30 个用到的默认色阶逐个 pin 回 v3 精确 hex,边框/placeholder 默认在 `@layer base` 复原。证据:编译产物零 `oklch`、32 个 token diff 无差异

**Expo SDK 声明为 latest** —— `@expo/config-plugins` 56→57,peer 开放到 `expo >=56.0.0`(去掉 `<57` 上界,不排除 56 用户)。`app.plugin.js` 用的 7 个 config-plugins API 在 57 全在(实测对 57 加载),SDK 源码不 import config-plugins,纯声明升级

**上游阻塞,如实保留**:TypeScript 7 在 webapp/web(typescript-eslint 硬拒 TS 7.0,实测确认)与 marketing/docs-site(astro check 依赖 TS 7 移除的 API);Tailwind 4 已在 web;rn-example 的 Expo 55→57 是需真机验证的 app 工程,独立处理。

---

## v1.6.1(2026-07-21 — 两道质量门提到阻塞级,连带两个真 bug)

两项技术债清完,门从"报告"提到"阻塞" —— 目标不是把 warning 数字降下去,是让它今后涨不回来。

**`self-hosted/server` clippy(111 → 0,门改为 `-D warnings`)**
- `usize`→`i64` 转换用 `try_from` + 饱和兜底并逐处注明为何不可达,而非整体 allow;两处改为真错误路径:`webpush_encrypt` 的 RFC 8188 `idlen` 字节截断会静默破坏帧结构,现返回 `InvalidServerKeyLen`
- `webhook::deliver` 可从两个请求处理器到达,其 HMAC `expect` 改为真错误;其余三处保留并写明不变量(启动接线、两处 `SecretKey::generate` 仅在 OS CSPRNG 不可用时失败)
- 删除确实无人使用的:`AppState` 三个启动时构建却从不读取的字段、`AttachmentStore::{get,delete}`、一个未挂路由的 501 桩、一个残留查询字段
- **`state.rs` 的 `#[allow(dead_code)]` 与其目标之间隔了空行**,实际在给 `RecentEventTick`(事件总线载荷,完全活跃)无差别放行,而四十行外三个真死字段反而不报。移除它才使其浮现

**webapp `set-state-in-effect`(17 → 0,门回到 error 级)**
- 新增 `useAsyncData`,取代 13 个页面各自长出的 `useState` 三件套 + `useEffect`
- **修掉被复制了 17 份的竞态**:快速切换项目时较慢的首个请求会后到并覆盖较新数据。每次运行取单调 ticket,仅最新者可写状态;卸载后不再写状态
- 五个页面此前在后续成功加载时从不清除错误,过期报错横幅会永远挂着
- 错误文案**刻意不统一**:仅两页用 `${status}: ${body}`,其余十一页用裸 `String(e)`,统一会改变用户实际看到的文字

**`fix(push)`:`appUserId` 定向静默不发** —— 该字段在文档注释里被宣传为定向方式,但 `resolve_targets` 仅处理 `tokenIds` / `nativeTokens` / `topic`。只设 `appUserId` 的推送会解析到零设备、什么都不发、返回 200,调用方以为已送达。现返回 400 并告知可用的定向方式。该模式仍未实现,只是不再假装实现了。

---

## v1.6.0(2026-07-21 — OAuth 登录移植 ⚠️ 含 legacy 账号劫持修复)

将 GitHub / Google 登录移植到 v0.2。**存储模型是重建的而非照搬**:legacy 把身份存在 `users.oauth_provider` / `oauth_subject`,v0.2 无此二列;`user_federation_links` 虽名字相近但不可替代 —— 它是项目级、`user_id` 为 TEXT 而非指向 `users` 的外键、且带 `install_id`,模型的是 SDK 侧最终用户联合。新增 migration 0032 建 `user_oauth_identities`,独立表以支持单账号同时绑定两个 provider(两个列做不到)。

**legacy 实现存在可实施的账号劫持,已刻意不移植**:`extract_github` 读取 `v["email"]` 且**无任何验证检查** —— 那是 GitHub 的公开资料邮箱,GitHub 从不验证、任何人可填任意地址 —— 随后 `upsert_oauth_user` 执行 `SELECT id FROM users WHERE email = $1` 并 `UPDATE … oauth_provider = …, email_verified = TRUE`。将 GitHub 资料邮箱改为受害者地址,点一次 "Continue with GitHub" 即接管其 Sentori 账号,并顺带标记该账号邮箱已验证。新实现只从 `/user/emails` 取地址,要求 `verified` 与 `primary` 同时为真,provider 不背书则拒绝关联。

其余边界:
- state cookie 与回调 `state` 比对,缺失或为空即拒绝
- 已有身份记录时**仅按 provider 的 subject 匹配**;邮箱只用于首次关联
- 新建用户写入哨兵密码哈希(argon2 无法解析),`/auth/login` 永不可能对其成功
- `exchange_code` 只记 provider 与状态码,绝不记 code / token / secret;非 2xx 分支丢弃响应体(部分 provider 会在错误里回显提交的 client_secret)

session 签发与密码登录**共用同一实现**(`session_cookie_header`),两条路径无法漂移。

13 个单元测试覆盖无需网络的部分:provider 解析、authorize URL 构造、两个 provider 的提取器(含未验证邮箱的拒绝)、state 比对的六种拒绝形态。

---

## v1.5.0(2026-07-21 — SaaS 管理入口统一)

Workspace 管理此前存在两套。`sentori-server` 的 `/admin/api/saas/{workspaces,stats}` 只读,走 dashboard session + saasadmin 角色门,是 **UI 唯一调用的那套**;`sentori-saas-control` 的 `/v1/saas/workspaces` 有完整 CRUD 与 suspend/resume,走**另一套独立账号体系**(`saasadmin_users` / `saasadmin_sessions`),却没有任何界面。一件事,两个接口,两套登录。

- **能力收进 `sentori-server`**,复用 UI 已在使用的鉴权:`POST /admin/api/saas/workspaces`、`DELETE .../{id}`、`POST .../{id}/suspend`、`POST .../{id}/resume`。SQL、绑定顺序、状态码、响应形状逐字迁移
- **`saas-control` 只保留 `/healthz` 与 Stripe webhook**。webhook 保持独立是有意的:它用 body 的 HMAC 验签,与 session 是不同鉴权模型,且 Stripe 需要稳定的机器端点,不应置于 dashboard 登录之后。其鉴权中间件、saasadmin 登录、tenant handler 一并删除;当日早些时候加入的启动时 schema 等待与操作员播种也随之移除(此处已无任何鉴权消费者),argon2 依赖同去
- **migration 0031 与其两张表保留**。当天建、当天删,判断有误便无退路;文档注明控制面已不再读取
- **webapp 同步补齐** create / suspend / resume / delete,删除操作带确认。搬走一个点不到的端点不叫统一

**端到端验证**:create 201(返回 id)→ suspend 204 → resume 204 → delete 204 → workspace 确已从库中消失;鉴权三层实测:未登录 401、已登录非 saasadmin 403、saasadmin 全通;saas-control 旧路由全 404,webhook 对无签名请求 400。

---

## v1.4.9(2026-07-21 — core 集成测试首次运行,连带修复六类既有缺陷)

`v0.2-core-check` 的 core job 此前只跑 `clippy` 与 `check`,**从不 `cargo test`** —— `crates/*/tests/integration.rs` 下所有断言一直是死代码。这些测试用 testcontainers 自起 Postgres,runner 本就有 docker,补一行即可运行。打开之后连锁暴露出以下缺陷,**均为既有问题,非本次引入**:

- **静默 FK:未知 project 写入 0 行却报成功**(9 crate / 14 处)。这些 store 用 `INSERT … SELECT p.workspace_id … FROM projects p WHERE p.id = $n` 从 project 推导 workspace;project 不存在时 SELECT 匹配不到行,写入 0 行,**FK 违例永不触发**,而每个函数的文档与 `translate_fk` 都假设此时得到 `ProjectNotFound`。实际后果:`replay-store::store` 的 blob 已写入对象存储才轮到该行失败,**blob 就此孤儿化**;`runtime-metrics::ingest_batch` 返回少计的 `Ok(n)`,未知 project 的数据点与去重跳过无法区分;`billing::record_drop` 与 `cert-monitor::poll_domain` 静默 `Ok`,写入凭空消失;其余冒成裸 `Db(RowNotFound)`,矛头指向驱动而非缺失的 project
- **`billing::check_and_record` 返回自相矛盾的 `OverLimit { current_count: 0, limit: 100000 }`** —— 同一根因,未知 project 落入"已达上限"分支
- **`integration-traits::record_link`** 同族反模式的 issue 驱动版(`FROM issues i WHERE i.id`),按 `projects` 的检索扫不到
- **`notifier` 四条 SELECT 漏取 `workspace_id`**,而 row-mapper 会读它 —— 所有读路径 panic 于 `ColumnNotFound`。该列自 migration 0010 起就在表上,SELECT 从未跟进
- **`integration-traits` 测试 seed 早已过期**:写于 `issues.workspace_id` 加 NOT NULL 之前,11 个测试在 setup 阶段即挂
- **`IssueStore::patch` 调用点遗漏**(v1.4.8 引入 workspace 参数时,server 侧一处未跟改)

修法尽量不动成功路径:多数为 `fetch_one` → `fetch_optional` 加显式映射,不增往返;两处 `ON CONFLICT DO NOTHING` 无法区分"未插入"与"重复",改用探测,其中 `ingest_batch` 仅探测确实 0 行的 project id,全新数据批次零额外开销。两处**有意保留**:`persist_event` 的 events 插入与 `ingest_span` 的 traces upsert 与已会 bail 的语句同事务同 project_id,再加检查即为不可达分支加守卫。

SDK handler 早已为 `ProjectNotFound` 写好分支(映射 401),此前该变体永不产生,那段代码一直是死的。

---

## v1.4.8(2026-07-20 — 租户隔离 ⚠️ 安全)

v1.4.7 补上了**鉴权**(必须登录),本版补上**授权**(只能看自己的)。此前任一已登录用户可读写全部租户数据。

- **`SessionContext` 现携带 `workspace_id`**,由中间件解析一次。此前它只有 `user_id`,过滤全靠每个 handler 自己记得 —— 于是六个忘了。现在过滤是 handler 必须主动丢弃的东西
- **两层防御**:`handlers::tenant` 的 `guard_project` / `guard_issue` 先校验 id 归属,查询层再约束 `workspace_id`;后加的 handler 即使忘了守卫也跨不过边界。外来 id 与不存在的 id 返回同样的 404 —— 403 会确认 id 存在,把接口变成猜测他人 id 的探针
- **覆盖**:projects / events / spans / traces / metrics / replays / search / stats / cert / issues(读+写)/ issue watchers / comments / activity log,共 17 条查询获得 workspace 约束
- **`bulk_patch` 的 body-id 攻击路径**:它的 issue id 来自请求体而非路径,守卫路径的 project_id 对其无效 —— 攻击者可在路径放自己的 project、在 body 放他人 issue id 批量篡改。现先经 workspace 约束的 SELECT 收窄 id 集合。已实测:跨租户 `bulk_patch` 返回 `updated: 0`,目标 issue 状态未变
- **SSE 实时流 `events_live`** 此前零鉴权,仅按路径 project_id 过滤,可旁听他人事件流;现加守卫
- **审计行 workspace 写错**:这些 handler 记审计用的是服务器配置的 workspace 而非调用者的,审计落到了错误租户名下
- **回归测试**(7 个,CI 内运行,无需数据库):扫 handler 源码断言每条 dashboard SELECT 都约束 workspace_id、每个从路径取 id 的 handler 都调守卫 —— 缺陷本身是"少了一行",所以检查"那一行在不在"

**端到端验证**:建两个分属 GOLIA / Qualcomm 的账号,双向确认各自只见己方项目、交叉访问 issues/events/stats/replays/traces/metrics 全部 404、跨租户写入被拒。

**已知限制**:`IssueStore::patch` / `bulk_patch`(core crate)无 workspace 参数,故 issue 写路径上仅守卫一层,缺查询层第二道防线。把 workspace 推进 store 是根治方案。

---

## v1.4.7(2026-07-20 — 两处未鉴权访问修复 ⚠️ 安全)

**背景**:为让 SaaS 面可用而排查时,发现两处接口在公网无需任何鉴权即可访问。两次访问日志审计均显示**仅有本人验证请求(21 次,同一 IP),无外部访问,数据完整**。发现后立即在 t01 边缘封锁,修复上线后恢复。

- **dashboard 读 API 全部无鉴权**:路由组注释写着 "open in v0.2; can be locked behind the same session middleware via env-var flip",而该 flip 从未执行。任何人可读取任意 workspace 的 issues / events / traces / metrics / replays,且 `GET /v1/projects` 直接返回项目 UUID 供寻址(实测取回某客户 98 个 issue 含崩溃明细)。现拆为三组:dashboard 读进 `session_middleware`;ops 探针(`/healthz` `/livez` `/readyz` `/metrics`)保持免鉴权供 k8s 与 Prometheus 抓取;`/auth/*` 保持公开(否则无法获得 session)。SDK ingest 是独立组,自带 Bearer `st_pk_` 门,未受影响
- **saas-control 无鉴权中间件**:binary 提供 `login` 会写 `saasadmin_sessions`,但从无中间件读回该表 —— 跨租户列表、`DELETE /v1/saas/workspaces/{id}`、suspend/resume 对任何可达者开放。此前不可利用仅因它没有公网路由(该路由是本日早些时候我为修复"控制面返回 HTML"而添加的)。新增 `auth_mw`:Bearer → sha256 → 查 session,过期与不存在合并为同一 401;破坏性路由额外要求 `super` 角色,`staff` 只读
- **`saasadmin_users` / `saasadmin_sessions` 表此前不存在**:定义在 `saas/migrations/0001`,但 saas-control 无 `sqlx::migrate!` 调用,其注释又将 schema 归属 sentori-server,而 core/migrations 从未包含它们 —— 因此 login 只可能返回 500,无人能登录。新增 core migration 0031;saas-control 启动时等待其就绪,并按 `SENTORI_SAASADMIN_BOOTSTRAP_EMAIL/_PASSWORD` 幂等播种首个 `super` 操作员
- **saas-control 的 `init_tracing` 又是空 stub**(与 sentori-server v1.4.1 同一 bug),生产零日志,以致排查暴露只能依赖 Caddy 访问日志。已接真 subscriber

**已知未闭合**:dashboard handler 中 `projects` / `events` / `spans` / `metrics` / `replays` / `search` 六处 SQL 无 workspace 过滤,已登录用户可跨 workspace 读取。当前 dashboard 账号仅 GOLIA 内部人员,故非急性问题;**但在给外部租户(如 Insight)开通 dashboard 账号之前必须先完成租户隔离**。

---

## v1.4.6(2026-07-20 — 缺失 asset 返回 404 + v0.2 server 首次纳入 CI)

- **缺失的 asset 返回 SPA shell 而非 404**:浏览器跨部署持有缓存的 index.html 时会去请求上一版的哈希 bundle,该请求落进 SPA fallback 拿回 200 + index.html,于是浏览器把 HTML 当 JavaScript 解析、报语法错,而不是一个它能恢复的干净 404。`/assets/*` 改用不带 index fallback 的 ServeDir。按前缀而非扩展名判定 —— 扩展名启发式会误伤合法含点的路由段(如 release 名 `app@5.4.2+361`)
- **`self-hosted/server/` 此前完全不在 CI 内**:`build.yml` 测的是 legacy `server/`,`v0.2-core-check` 测的是 `core/` —— 那个打进 self-hosted 镜像、正在跑生产的二进制,从未被任何 CI 编译、lint 或测试过(本版新增的 4 个 fallback 测试若就这么提交也永远不会运行)。现于 `v0.2-core-check` 增加 server job:fmt + test 强制,clippy 暂为 report-only
- 该 crate 因从未进过 CI 也从未被格式化:本版含一次 `cargo fmt --all`(48 文件,纯空白)。clippy 的 ~110 条历史 lint 未清 —— `clippy --fix` 会重写约 64 个文件的生产二进制,应作独立改动

---

## v1.4.5(2026-07-20 — 两处生产静默错误内容修复)

- **未匹配的 API 路径返回 SPA 而非 404**:所有未命中路由都落到 `fallback_service(webapp_service())`,于是 `/v1/does-not-exist`、`/admin/api/nope`、`/auth/nope` 一律回 `200 <!doctype html>`。已发货的 SDK 调到本服务未实现的端点时会把它当成功,随后在离现场很远的地方 JSON 解析失败。legacy 没这问题 —— 那时 SPA 与 API 是 Caddy 后面两个容器,未知 `/api` 路径会吃到 server 的真 404;单体化引入了这个回归。现按路径前缀分流:四个 API 前缀返回 `{"error":"not_found"}` + 404,其余仍解析到 index.html + 200 供 React Router 接管。附 3 个前缀判定回归测试(含 `/v1` `/apidocs` `/authors` 这类相邻路径不得误判)
- **saas-control 部署了但公网无路由**:`:18091` 容器健康在跑、直连返回正确 JSON,但 `/v1/saas/*` 在公网落到 SPA,回 HTML 200 —— 文档化的 SaaS 控制面 API 对任何调用方都是"看起来成功的垃圾"。t01 Caddy 增加 `/v1/saas/*` → `:18091`(置于 catch-all 之前),按安全路径改 live → validate → reload → `devops caddy import` → 同步 repo mirror
- `docs-v0.2/DEPLOY.md` 的路由拓扑对齐现实(此前仍写 v2.4 之前的 `api.sentori.golia.jp` 分域形态,且未说明 `/v1/saas/*` 必须先于 catch-all —— 正是控制面回 HTML 的原因)

---

## v1.4.4(2026-07-20 — workflow 解析修复 + workflow 质量门)

- **v1.4.3 的镜像 workflow 从未运行过**:run-step 注释里为了说明"Actions 表达式不能做参数展开"而写了字面量的空 `${{ }}`,GitHub 把它当真表达式解析并拒收整个文件 —— 连续四次 run 秒失败、零 job、无可读日志,唯一线索是 run 名显示为文件路径而非 workflow 名
- **OSS mirror workflow 带着同一个死 tag 过滤器**(`v0.2.*`,而实际 tag 是 `v1.4.x`),所以"顺带镜像 tag"那段分支一次都没执行过,公开 repo 从未从 CI 收到版本 tag。改为 `v<x>.<y>.<z>`
- **补门**:`scripts/check-workflows.sh`(actionlint)进 preflight,build.yml 新增 `workflows` job 且 docker-build 依赖它 —— 解析不了的 workflow 文件今后进不了 master
- 附带:actionlint 配置 lx64 自建 runner 标签、deploy.yml 未使用的循环变量、`ls | head` 换 `find`、一处 actionlint 表达式桩造成的 SC2193 误报显式标注

---

## v1.4.3(2026-07-20 — CI 与发布镜像修复)

- **self-hosted 镜像从来拿不到版本 tag**:workflow 只在 `v0.2.*` tag 触发,而实际发布 tag 是 `v1.4.x` —— 没有一次 tagged run 触发过,metadata-action 的 semver 模式从未生效,发布镜像只有 `master` 和 `sha-<short>`。同时 `self-hosted/README.md` 让用户 pull `ghcr.io/goliajp/sentori-selfhosted:latest`,而 workflow 推的是 `ghcr.io/goliajp/sentori/sentori-server` —— 镜像名与 tag 皆不存在。现改为 `v<x>.<y>.<z>` 触发 + tagged 构建加 `latest`,README 指向真实镜像
- **镜像构建改原生 arm64 runner**:此前 linux/arm64 在 QEMU 仿真下编译整个 Rust workspace,稳定耗时 ~55 分钟对 60 分钟超时(仅 5 分钟余量)。改为 per-arch matrix(`ubuntu-latest` / `ubuntu-24.04-arm`,公开 repo 免费)按 digest 推送 + merge job 合并 manifest list,两架构并行原生构建;cache scope 按架构隔离
- **CI runner 磁盘**:master 上 `cargo test (server)` 曾以 "No space left on device" 中途死亡(连诊断日志都写不下,故报 failure 但无失败步骤)。构建前清掉预装的 Android SDK / .NET / GHC / CodeQL(~25 GB),并前后打印 df

---

## v1.4.2(2026-07-20 — astro CVE 修复 + webapp 质量门补齐)

- **安全**:astro 5 → 7 + starlight 0.34 → 0.41,关掉 6 个 dependabot alert(4 high):CVE-2026-54299(prerendered error page 的 host-header SSRF)/ CVE-2026-50146(unescaped slot name 反射 XSS)/ CVE-2026-54298(spread props 属性名 XSS)。5.18.2 是最后的 5.x 且无补丁回移,跨大版本是唯一路径;marketing 2 页 + docs 56 页产物验证无退化(`/docs` base、og:image、pagefind 索引均在)
- **质量门**:`webapp/`(v0.2 dashboard,即 self-hosted 镜像打包的 SPA)此前在 preflight 与 CI 均无 typecheck/lint —— 96 个类型错误因此潜伏到 docker `tsc -b` 才暴露。现补:tsconfig `noEmit`(此前 `tsc -b` 往源码目录 emit,积了 40 个 stale `.js` 干扰 eslint 与编辑器)、eslint flat config、preflight + build.yml webapp job(gating docker-build)
- **修复**(lint 查出的真实缺陷):`useKeyHandlers` render 期间写 ref、`Cert` render 期间调 `Date.now()`、6 处空 catch 补上吞错理由

---

## v1.4.1(2026-07-20 — auth 安全修复 + 注册/重置全链路打通)

- **安全**:`/auth/forgot-password` 曾把 reset token 直接放进 HTTP 响应(任何人 POST 目标邮箱即可接管账号);`/auth/register` 同样回传 verify token。两者改为仅经邮件发送(新 Mailer,`SENTORI_SMTP_*` + `SENTORI_BASE_URL`;无 SMTP 配置时 token 仅落服务器日志)
- **修复**:email_verifications / password_resets 的 INSERT 缺 NOT NULL 的 workspace_id —— 自助注册与忘记密码在生产必 500(K2 store 首次对真 schema 跑通);webapp reset 请求体 snake/camel 失配
- **新增**:webapp `/verify` + `/reset-password` 落点页;Register/ForgotPassword 不再展示 token

---

## v1.4.0(2026-07-20 — v0.2 fresh-start 正式 release + 生产 cutover)

v0.2.0-rc1(下节)转正。相对 rc1 的增量:

- **生产 wire**:deploy.yml 构建/拉起 v0.2 栈(server-v2 :18090 + saas-control :18091 + postgres-v2)与 legacy 栈并存;legacy 保留作 rollback,直至 t01 Caddy 切流
- **Dockerfile 修正**:rust 1.88 → 1.97(msrv)、saas 二进制名 sentori-saas → sentori-saas-control、webapp builder npm → bun --frozen-lockfile;新增 migrate-tool/Dockerfile(compose 网络内一次性 ETL)
- **webapp typecheck 修复**:96 个 tsc 错误(页面与 ui.tsx 组件契约漂移;CI 从未对 webapp/ 跑过 tsc)——Badge variant→tone、EmptyState message→hint、Section title 可选化、DataTable rowKey 可选化(修掉 14 页非空表格的潜伏 runtime crash)、useKeyHandlers useCallback 误用
- **cutover**:sentori.golia.jp + ingest.sentori.golia.jp 切至 v0.2 栈;legacy 数据经 sentori-migrate 全量 ETL(幂等)

---

## v0.2.0-rc1 候选(2026-06-23 ship 准备完成)

**状态:** branch `feature/v0.2-foundation` 167 commits,3 binary cargo build 全绿。等用户拍板 → tag → docker build + OSS mirror。

**ship 清单:**
- 5 lens dashboard(Issues/Events/Traces/Metrics/Replays)+ 31 webapp pages + 5 detail views + filter + saved view
- 147+ backend endpoints + 63 sentori-cli subcommands + /v1/_describe self-describing catalog
- Push pipeline production-grade:5 vendor adapters real(WebPush/APNs/FCM/HCM/MiPush)+ JWT/OAuth cache(55min TTL)+ token quarantine + exponential backoff retry + DLQ + 真 dispatch worker + **WebPush 真 payload encryption(RFC 8291/8188 — aes128gcm)** 浏览器收到 title/body
- Alert pipeline:**4 trigger kinds 全 真 wire**(new_issue / regression / event_count via ingest path + crash_free_drop via 5-min periodic worker)+ webhook out + HMAC + per-rule throttle + audit
- 4 background workers:push_worker(5s)+ probe_worker(10s)+ archive_worker(24h)+ **periodic_alert_worker(5min)**
- Synthetic monitor:probe_worker 真发 HTTPS + endpoint_check + endpoint_probe 时序表
- 4 background workers:push_worker(5s)+ probe_worker(10s)+ archive_worker(24h prune sent>30d/failed>90d)+ periodic_alert_worker(5min)
- Auth + session:HttpOnly cookie + Bearer dual auth + 可独立 revoke + saasadmin role gate + IP/UA capture
- Audit log:10+ action types + actor_user_id + IP/UA enrich + client-side IP filter
- 5 lens 真实 ingest + 真实 ETL:**68/68 表(100%)from legacy**(saas_stripe_customers / saas_stripe_invoices / saas_org_quotas / saas_billing_events 补全)
- /healthz + Health page + **/metrics(Prometheus text format)** + **/livez + /readyz(k8s probes)** + 工作流可视(stat grid + 4 workers + 5 vendor adapters)
- audit log payload._ip server-side substring filter(LIMIT 之前 filter,可靠)
- 4 test 触发器(webhook-test / push-test / alert-fire-test / ingest-test)

**已知 defer v0.3+:**
- HCM/MiPush 中国 vendor adapter token cache(目前每 send OAuth)
- Saved view 高级 query builder UI

---

## v0.2 — fresh-start pivot(2026-06-22, branch `feature/v0.2-foundation`)

**目标：** 大仓 → SaaS 内置 + self-hosted OSS repo + 定制产品。SaaS 与 self-hosted 同版本号同终端 SDK。SaaS 一经发布满足现有 sentori 全功能（含 tenant 管理 + 简化顶层架构）。Self-hosted 满足 tenant 内全功能。现有 app 用户用现有 SDK + 现有 token 无感继续工作。

**数据策略：** SaaS 由 row-level `workspaces` × `workspace_id` 替代 database-per-tenant；ETL 是业务层（读 legacy DB → 写 v0.2 DB），不是 schema ALTER；self-hosted 总是 fresh DB（Docker pull + migrations + env-var bootstrap admin）。

### Phase A — Legacy inventory ✅

- 82 migrations / 68 tables / 360 cols 全量盘点 → `docs-v0.2/internal/legacy-inventory.md`
- 28 SDK `/v1/*` endpoint + 11 push endpoint + 95 admin endpoint + 13 auth endpoint = 136 surface
- 永久契约：token format `st_pk_<26 base32>`、SHA-256 hashed、`sentori-ingest-token` crate 承载

### Phase B — Workspace 重组 + cargo 工作区适配 ✅

- 5 stub crate 占位（push-provider Mock / mock vendor adapters / etc）
- `sentori-server` / `sentori-saas-control` / `sentori-cli` 三 binary 改名 align v0.2
- GitHub workflows: `v0.2-core-check` + `v0.2-self-hosted-image` + `v0.2-oss-mirror`

### Phase B.5 — Schema 补全 ✅

- 15 新 migration（0016-0030）覆盖 legacy 33 张缺漏表
- 列名沿用 legacy 表名以支持 ETL INSERT-透传

### Phase C — SDK 28 endpoints port ✅ 27 业务 / 1 SSE stub

- `sentori-ingest-token` crate: Bearer middleware + `IngestContext { workspace_id, project_id, token_kind }`
- 17 SDK handler 全部 ship 业务实现（events / events:batch / events_attachments / spans / spans:batch / sessions / heartbeat / deploys / metrics / runtime_metrics / track / security_report / security_link / security_score / control / user_reports）
- `/v1/events/_recent` SSE 留 stub（Phase G 接 dashboard SSE 时落地）

### Phase D — Push 11 endpoints ✅ 全业务 + worker

- 11 endpoint 全 wire（register_token 双写 push_tokens + device_tokens / revoke / subscribe / unsubscribe / send / receipt / ack / expo-compat send/receipt / get_preferences / put_preference）
- `push_worker.rs` background task：drain `push_sends.status='queued'` → MockProvider → INSERT push_delivery_logs + UPDATE status
- env-tunable interval/batch；`FOR UPDATE SKIP LOCKED` 横向 scale-out 安全
- 真 vendor adapter（APNs/FCM/WebPush/HCM/MiPush）留 K7.x

### Phase E — Admin endpoints + Session middleware ✅

- 33 admin endpoint port: tokens / projects / push-credentials / members / invites / cert-watch / integrations / releases / saved-views（detail+patch）/ alerts（detail）/ saas（cross-workspace list + stats）
- `session_mw.rs`：cookie 或 Bearer session token gate；`Extension<SessionContext>` 注入
- `/auth/{register,login,verify,forgot,reset,change-password,me,logout}` 6+2 endpoint
- saas-control binary aligned to row-level pivot（删 `tenant_provision`，workspaces CRUD + workspace_billing 状态 → suspend/resume/delete）

### Phase F — Docker + OSS mirror ✅

- `self-hosted/docker/Dockerfile` multi-stage Rust → distroless
- `.github/workflows/v0.2-self-hosted-image.yml`：多架构 build → ghcr.io/goliajp/sentori/sentori-server
- `.github/workflows/v0.2-oss-mirror.yml`：master push + v0.2.* tag → mirror to `goliajp/sentori-selfhosted` public repo

### Phase G — Webapp 18 页 ✅

Login / Register / ForgotPassword / Overview / SaasAdmin / Projects / Members / Tokens / Push / Integrations / Releases / Issues / Events / Cert / Alerts / Audit / Settings / Health。

- `lib/api.ts`：auth + admin + saas API methods + auto-inject Bearer session header
- session 在 localStorage（HttpOnly cookie middleware 后续）
- Sign out 闭环：POST /auth/logout → clear → /login

### Phase H — sentori-migrate ETL binary ✅ 13 sets / 41 表覆盖

- 业务层 ETL（read legacy DB → transform identity layer → write v0.2 DB）
- table sets：identity / tokens / releases / events / issues / sessions / spans / push / attachments / dashboard / dashboard_extra / analytics / metrics / ops
- 41 of 68 legacy 表覆盖；剩 27 为 SaaS-only billing / 内部 rollup / 低优先级
- `--dry-run` count rows without writing；`--tables` 选择 set；`ON CONFLICT DO NOTHING` 幂等

### sentori-cli — admin commands

- `project list/create/delete` + `token list/mint/revoke` via /admin/api/*
- Bearer token via `SENTORI_ADMIN_TOKEN` env-fallback

### 总产出

- 40 commits on `feature/v0.2-foundation`
- 3 binary `cargo build` 全绿
- Backend endpoints: 84+（28 SDK + 11 push + 6 auth + 33 admin + saas-control + healthz）
- Webapp pages: 18
- Migrations: 30 sql / ~58 表
- ETL: 13 sets / 41 表
- Docker image + OSS mirror workflow 就绪

### 之后增量(2026-06-22 → 2026-06-23, branch 仍 feature/v0.2-foundation)

| 项 | 完成 |
|---|---|
| WebPush 真 vendor adapter | ✅ VAPID ES256 + 浏览器 WebCrypto keypair wizard |
| APNs 真 vendor adapter | ✅ token-based ES256 over HTTP/2 |
| FCM 真 vendor adapter | ✅ Legacy HTTP API(server key) |
| SaaSadmin role-based RBAC | ✅ env-allowlist `SENTORI_SAASADMIN_USER_IDS` |
| HttpOnly cookie session | ✅ |
| `/v1/events/_recent` SSE 真实现 | ✅ + Events 页 Live toggle |
| ETL 全 14 sets,coverage | ✅ 62/68 表(91%)|
| 5 lens project dashboard | ✅ Issues / Events / Traces / Metrics / Replays + detail + filter + save 路径全闭环 |
| Issue triage workflow | ✅ list inline ✓⊘↺ + bulk select + detail + comments + activity + watchers + notification fanout |
| Notifications inbox + sidebar badge | ✅ 60s 轮询 |
| Linear UX | ✅ ⌘K palette + `g<letter>` + per-page j/k/x/e/i + `?` cheatsheet + HttpOnly cookie + 401 redirect + return-to |
| /v1/_describe self-describing catalog | ✅ sentori-cli describe 用 |
| Endpoint probes admin CRUD | ✅(后台 poller worker 留 v0.3)|
| sentori-cli 44 subcommands | ✅ 全 admin / lens / ops 覆盖 |
| Replay scrubber + raw NDJSON download via cli | ✅(完整 canvas/DOM replayer 留 v0.3)|

### 留 v0.3+

- WebPush payload encryption(RFC 8030/8188/8291)— v0.2 只 wake push
- HCM / MiPush vendor adapter(中国市场)
- 剩 6 个 saas_* 内部表 ETL(saas-control 自有,不影响 cutover)
- Endpoint probes background poller worker
- Replay canvas/DOM 真实 replayer
- Saved view 高级 query builder UI
- HTTPS 自动 TLS via embedded rustls + Let's Encrypt
- SDK 类型生成器
- Cutover 部署执行(user-gate;CUTOVER.md 就绪)

---

## v2.3 — SDK redesign + identity layer + DSR + Sentry compat

**Shipped:** 2026-06-03. See [`docs/roadmap/v2.3.md`](./docs/roadmap/v2.3.md).

**Package bumps:**

- `@goliapkg/sentori-core` → **1.2.0** (minor — two minor changesets merged: logger surface + ReadyInfo shared type + `BeforeSendHook` type + `withSpan` overload dispatch + `withActiveSpan` explicit name)
- `@goliapkg/sentori-javascript` → **1.2.0** (minor — two minor changesets merged: `init.logLevel` + `init.onReady` + `init.sample` canonical name + `init.beforeSend`)
- `@goliapkg/sentori-react-native` → **2.2.0** (minor — two minor + one patch changeset, merged into one minor bump: `init.beforeSend` + logger surface re-export + `ReadyInfo` from core + `/compat` Sentry drop-in unit-test coverage)

**Highlights:**

- **Silent by default.** Logger module gates the SDK's console output at `'warn'` by default — a healthy install adds zero `[sentori]` lines to host metro/browser console. `init.logLevel: 'silent' | 'error' | 'warn' | 'info' | 'debug'` controls the gate. `setLogTransport(fn)` routes Sentori-internal lines into the host's own log aggregator instead of console.
- **`init.onReady`.** Fires once after init completes; carries `sdkVersion` + (RN-only) `coldStartMs` + `native: { bound, methods }`. Hosts no longer need to scan the console to know the SDK is live.
- **`init.beforeSend`.** Sync host-supplied mutate-or-drop hook on each outbound event. Returns the (possibly mutated) event or `null` to drop. Throwing / non-event return falls back to the unmodified event under the NEVER rule.
- **Unified `withSpan`.** `withSpan(name, fn)` is the new high-level wrap helper per design §2.3; `withSpan(span, fn)` keeps working via overload dispatch (delegates to `withActiveSpan`). `withScopedSpan` remains as the explicit high-level name.
- **Identity layer + cross-project user lookup.** `setUser({ id, name?, linkBy: { email?, phone?, googleSub?, ... } })` — raw identity values are normalised + SubtleCrypto SHA-256 hashed client-side; only the hash leaves the device. Server layers a per-scope salt before storing fingerprints. Operator dashboard's Users module looks up cross-project hits without ever seeing raw values.
- **GDPR DSR erase.** `POST /admin/api/orgs/{slug}/users/erase` with `dryRun` flag; pseudonymises `payload.user` across every matching event + drops identity_fingerprints rows. Dashboard UI with typed-confirmation gate. Audit log entry per call.
- **Sentry compat drop-in.** `import * as Sentry from '@goliapkg/sentori-react-native/compat'` — full translation table for code an LLM has been trained on against `@sentry/react-native`. DSN parser, `Sentry.init/captureException/captureMessage/setUser/setTag/addBreadcrumb/withScope/startTransaction/close/flush`. Drops `ip_address` (Sentori never stores IP). Warn-once dedup per (api, dropped_field).
- **`/explore` grammar extension.** 5 new filters (`issueEq`, `userIdEq`, `routeEq`, `osEq`, `search`), 4 new dims (`device_os`, `issue_priority`, `severity`, `route`), 4 new measures (`new_issue_count`, `p50_duration`, `p95_duration`, `crash_free_rate` reserved-pending-session-schema). Unlocks v2.2 W3 per-row sparkline stub on Issues list + foundation for Phase 7 / 8 lenses.

**Migration:**

- Existing v2.2 init calls keep working unchanged. Pre-existing `sampling` field stays accepted as a back-compat alias for `sample`.
- `setUser({ id, email })`-style Sentry calls reach the same internal state via `/compat`; mapping is automatic but warn-once hints fire at `info` level pointing to native equivalents.
- Hosts that grepped metro for `[sentori]` to confirm SDK liveness should wire `onReady` or set `logLevel: 'debug'`.

---

## v1.0.0-rc.10 — default capture rate 4 Hz → 2 Hz per perf rule

**Theme:** iOS sim measured 0.99 ms / tick at 4 Hz on a thin (11-node) dev panel, well within budget — but extrapolation to a 200-node Insight-class dense UI puts JS-thread occupancy at ~1.2–1.6 % on iOS and ~3.6–4.8 % on Android (reflective Drawable colour extraction amplifies cost there). That crosses the project's "几乎不能造成性能抖动" rule (CLAUDE.md). Roll the default back; keep the encoding gains.

**Package bumps：**

- `@goliapkg/sentori-react-native` 1.0.0-rc.9 → **1.0.0-rc.10**（patch — perf-budget default change）

### Fix

- Default `replay.hz` 4 → 2. `replay.hz: 4` (or 8) remains opt-in for motion-heavy iOS apps.
- `apps/rn-example` reverts to the default rate (drops explicit `hz: 2`), removes a temporary rc.9 auto-fire `useEffect`.
- `bunfig.toml` at `apps/rn-example` sets the linker to hoisted so future iOS Pods install can resolve transitive expo deps under `node_modules/<pkg>/ios/...` (harmless under the workspace default `isolated`).

### Verify

- iOS sim per-tick budget unchanged; budget envelope at 2 Hz extrapolates to ≤ 0.6 % JS-thread occupancy even on dense Android UI

---

## v1.0.0-rc.9 — keyframe + delta replay encoding (v2 wire format)

**Theme:** rc.8 stabilised the Android wireframe walker but each replay tick still emitted a full snapshot. Sustained capture at the rc.8 default rate produced > 200 KB / 60 s on dense dashboards — close enough to the "60 s replay attachment < 200 KB" target (CLAUDE.md performance rule) that the next product feature would push us over. Need a real on-wire compactor.

**Package bumps：**

- `@goliapkg/sentori-react-native` 1.0.0-rc.8 → **1.0.0-rc.9**（minor — new wire format, dashboard parser updated in lockstep）

### Fix

- Rewrite `replay.ts`: native walker still pulls full snapshots each tick; JS now diffs against the previous emit's reconstructed state and emits either a fresh keyframe (cold start / every 4 s / when delta would be near-rewrite) or a small delta (added / changed / removed nodes by spatial fingerprint).
- Native tick rate bumped 1 Hz → 4 Hz default at this rc (later rolled back to 2 Hz in rc.10).
- Ring buffer evicts by 60 s time window instead of fixed 60-frame count.
- New `replay.keyframeMs` option for tuning reconstruction chain length.
- Dashboard side: `web/src/modules/issues/replay-tab.tsx` + reconstructor pair lands; parser auto-detects v1 archive events for backwards-compat reading.

### Verify

- 11 new unit tests cover encoder paths + a 60 s × 4 Hz dense-UI byte-budget assertion (< 200 KB)
- Wire schema documented at `docs/replay-encoding-v2.md`

---

## v1.0.0-rc.8 — anchor walker at content view + cover StateList/Bitmap drawables

**Theme:** Insight 2026-05-18 rc.6 verify still showed two artifacts: (A) After rc.3's deep-walk fix, PhoneWindow's StatusBarBackground / NavigationBarBackground children started getting emitted with display-wide absolute-coord rects, painting as horizontal grey bars overflowing the device viewport in the dashboard SVG. (B) Coloured Pressable backgrounds (StateListDrawable's default state) still rendered as flat grey.

**Package bumps：**

- `@goliapkg/sentori-react-native` 1.0.0-rc.7 → **1.0.0-rc.8**（patch — Android walker anchor + extended drawable extractor）

### Fix

- Switch walk root from `window.decorView` to `decorView.findViewById(android.R.id.content)`. System-bar overflow nodes drop out.
- Extend `extractDrawableColor`:
  - `StateListDrawable` → recurse into `.current` (covers Pressable / TouchableOpacity wrappers in default state)
  - `BitmapDrawable` → return null AND switch node kind to `image` in walker, so dashboard renders raster-backgrounded views as a media region instead of a flat grey rect.

### Verify

- On `sim-sentori-android` (Pixel 10 Pro / API 37): rc.7 surfaced 5 distinct hexes on `rn-example`'s dev panel; rc.8 same 5 with no system-bar overflow nodes.
- Sim-Sentori-Android emulator workflow documented at `docs/runbook/sim-sentori-android.md`.

---

## v1.0.0-rc.7 — cover CompositeBackgroundDrawable + reflective getColor fallback

**Theme:** rc.5 introduced colour extraction for Android but only matched `ColorDrawable` / `GradientDrawable` / `RippleDrawable` explicitly, missing RN 0.74+'s actual code path: a View's background is a `CompositeBackgroundDrawable` (extends `LayerDrawable`) whose inner `BackgroundDrawable` layer holds the paint colour. Both classes are Kotlin-internal in the RN module — can't import the types — so we bridge via reflection.

**Package bumps：**

- `@goliapkg/sentori-react-native` 1.0.0-rc.6 → **1.0.0-rc.7**（patch — Android colour extraction parity）

### Fix

- `is RippleDrawable` → `is LayerDrawable` so the recursion covers `CompositeBackgroundDrawable`, `RippleDrawable`, and any future layer-stacking variant.
- `else` branch tries `getBackgroundColor()` / `getColor()` via Java reflection. Any throw / non-Int falls back to null — attachments still ship, just without that node's colour.

### Verify

- On `rn-example` S22 verify: rc.5 surfaced 3 unique hexes (root + text + overlay); rc.7 surfaces 5 including a Pressable's `#1A1A1FFF` brand colour.

---

## v1.0.0-rc.6 — surface HTTP status in attachment-upload dev logs (+ server body-cap fix)

**Theme:** Pre-rc.6 `uploadAttachment` returned null on any non-2xx without echoing the status to logcat — only the next-event breadcrumb carried `http_NNN`, invisible to anyone reading metro/logcat in the moment. Insight's rc.4 verify rig (and our own future runs) had to guess between 413 / 422 / 500 / network-fail.

This release also paired with a server-side body-cap fix (commit `5b608b3`) to make the rc.6 per-route 16 MB attachment cap actually take effect.

**Package bumps：**

- `@goliapkg/sentori-react-native` 1.0.0-rc.5 → **1.0.0-rc.6**（patch — dev-log surface area + server body-cap regression cover）

### Fix

SDK side — three new dev-only `console.warn` lines, one per failure shape:

```
[sentori] attachment upload non-2xx status=NNN eventId=… kind=…
[sentori] attachment upload bad-response-body status=NNN eventId=… kind=…
[sentori] attachment upload fetch threw reason=fetch_TypeError eventId=… kind=…
```

Fires for screenshot / sessionTrail / replay uniformly. Existing `[sentori] replay upload returned null ndjsonBytes=N` line still fires; read together.

Server side (`5b608b3`):

- Raise `MAX_BODY_BYTES` 1 MB → 16 MB at the merged-app outer layer so the attachment route's per-route 16 MB cap can take effect (Tower outer layer was cutting the body stream off before the inner layer ran).
- Add explicit `RequestBodyLimitLayer::new(1 MB)` to every other small-payload ingest route so they don't inherit the loosened outer cap.
- Regression test `attachment_route_accepts_payloads_above_1mb` posts a 5 MB body to the attachment URL and asserts not 413.

### Verify

- Insight 2026-05-18 770 KB replay upload (which had been 413-ing): post-fix lands cleanly.

---

## v1.0.0-rc.5 — Android emits node.color for rect backgrounds — wireframe shows brand palette

**Theme:** Pre-rc.5 the Android walker explicitly skipped colour for the `rect` kind (the `.kt` comment said "renderer falls back to neutral"); iOS already pulled `UIView.backgroundColor` on the same path. Consequence: every coloured ViewGroup in the host app rendered as a uniform white block on the dashboard wireframe — "怎么还是黑白的呢" (user, after rc.4 deploy).

**Package bumps：**

- `@goliapkg/sentori-react-native` 1.0.0-rc.4 → **1.0.0-rc.5**（patch — Android colour extraction first pass）

### Fix

- Extract from `ColorDrawable.color`, `GradientDrawable.color.defaultColor`, and recurse into `RippleDrawable` layers.
- Filter out alpha-0 fills so fully-transparent backgrounds keep falling back to the neutral default.

### Verify

- Native S22 verify on the `rn-example` dev panel produced 946 colour fields on a ~117 KB NDJSON capture with three distinct RN-brand hues.

> Note: native change. Insight needed a full APK rebuild to pick rc.5 up — JS-only `bun add` was not enough.

---

## v1.0.0-rc.4 — UTF-8-safe replay encoding — close Insight Android attachment drain

**Theme:** The pre-rc.4 inline `btoa(ndjson)` upload path threw `InvalidCharacterError` on any wireframe NDJSON code point > 0xFF (JP / em-dash / emoji TextView text) and the surrounding catch swallowed it silently. After rc.3's walker fix surfaced deep TextView content, the replay attachment silently never landed.

**Package bumps：**

- `@goliapkg/sentori-react-native` 1.0.0-rc.3 → **1.0.0-rc.4**（patch — encoding + dev-warning surface）

### Fix

- Route through a shared `base64Utf8` helper (sessionTrail's existing pattern).
- Replace the silent catch with `[sentori] replay attachment threw` / `replay upload returned null` / `replay drain empty` dev warnings so the next failure shape is visible.
- Add `wantReplay` to the `captureException` debug line.

### Verify

- End-to-end on S22 with mock ingest: `kinds=replay` lands.

---

## v1.0.0-rc.3 — Android replay walker recurses through zero-size wrappers

**Theme:** Insight 2026-05-18 rc.2 re-verify (`com.qualcomm.insight` on Samsung S22 / Android 16) 报告：rc.2 native (`probeScreenshot` 在 exposed-methods list 里) 确认是新版，但 wireframe 仍间歇问题。两条独立 bug 叠加：
- (A) `captureWireframe` 间歇丢 subtree —— 只 emit root + 几个顶层 wrapper，800 nodes 报告对但 dashboard 渲染空
- (B) rc.2 把诊断 warning 收得太严，只在 `null`/空串时 fire，对「非空但 nodes=[]」的 thin result 静默

**Package bumps：**

- `@goliapkg/sentori-react-native` 1.0.0-rc.2 → **1.0.0-rc.3**（patch — Android-only native fix + 双端诊断扩展）

### Root cause

`SentoriReplayCapture.kt` walk() 在 view 自身 `width <= 0 || height <= 0` 时整段 return —— 包括「不 emit 节点」和「不递归 children」两个 effect。对 RN Fabric 拓扑下经常出现的 zero-measure ViewGroup wrapper（在 RN 的 shadow-tree 中间层 + lazy-layout 阶段）来说，这意味着**整个 React tree 子树都被跳过**，根 decorView + 几层 padding wrapper 之外什么都没拿到。结果 NDJSON 非空、JS 视为成功、ring 累计「几乎空」帧、dashboard 渲染近空。

iOS 端走的是 "skip emit but recurse" 写法（comment 已经有 `invisible container — skip emitting but recurse`），从一开始就对。

### Fix

* **Android walk()** 拆分「emit a node」和「recurse into children」语义：zero-size view 不 emit 节点但仍递归子树。对 MAX_DEPTH (60) + MAX_NODES (800) 仍设上限。
* **诊断状态扩展**：双端新增 `lastDepthMax` / `lastSizeBytes` / `totalTicks` / `totalEmptyResultTicks`，原有 `lastPath` / `lastNodes` / scene-window counts 保留。失败模式有正面证据（"depthMax=42" 说明 walker 跑通了；"depthMax=3" 说明又被早期 bail 卡住了）。
* **JS replay tick 加 thin-result warning**：捕获 nodes < 6 的 "成功但浅" 情况，stride 1/10/100/... 节奏避免 spam。原来的 `replay tick: native returned null` warning 保留，覆盖另一条 failure path。
* **第一次 ok tick 也打 log**：`[sentori] replay tick: first ok — nodes=N sizeBytes=B`，让 dev 一眼看到 capture 真的拿到结构。

### Verify

- 109 SDK tests + tsc clean
- 待 Insight 重 build APK on S22 / Android 16, 期望:
  - `[sentori] replay tick: first ok — nodes=300+ sizeBytes=15000+`
  - `[sentori] enqueue ... attachments=3 kinds=screenshot,sessionTrail,replay`
  - dashboard issue detail 上 Session replay 段渲染出完整 wireframe layout (不再是 2-3 个空 box)
  - `await Sentori.probeNativeWireframe()` returns `lastDepthMax: 30-50` (健康范围)

### Other

- iOS 端补 depthMax / sizeBytes / totalTicks 诊断 (parity)，行为不变

---

## v1.0.0-rc.2 — Android foreground-Activity tracker

**Theme:** Insight 2026-05-17 Android verify (`feature/GOL-582-sentori-0-9-upgrade @ b792e31d`, Samsung Galaxy S22 / Android 16) 上 `captureScreenshot` 和 `captureWireframe` 双路都 null。同 JS 在 iOS sim-insight 一次过。Android 单独有 native-side Activity 解析 gap。

**Package bumps：**

- `@goliapkg/sentori-react-native` 1.0.0-rc.1 → **1.0.0-rc.2**（patch — 仅 Android 行为修复 + 双端新增 `probeScreenshot` 诊断 API）

### Root cause

`SentoriCrashHandler.register(context)` 走的是 Expo module `OnCreate` 生命周期。在 Insight dev-launcher → MainActivity 拓扑下，MainActivity 已经 onResume 完了才轮到 module init。`Application.registerActivityLifecycleCallbacks` **只补发未来事件、不补发已发生的状态**，所以 `lastActivity` 一直 null —— 每次 capture short-circuit 到 `null`。iOS keyWindow 4 层 fallback 治的那一类 bug 在 Android 上的等价形态。

### Fix

新加 `SentoriForegroundActivity.kt` 作为进程级 single source of truth：

1. **`Application.ActivityLifecycleCallbacks`** —— 继续 track 未来的 onCreate/onStarted/onResumed
2. **`ActivityThread` reflection back-fill** —— `install()` 时立刻通过 `android.app.ActivityThread.currentActivityThread().mActivities` 拿当前 foreground Activity，补已经 resumed 不会再触发 callback 的盲区。失败安静吞掉，lifecycle callbacks 继续兜底
3. **`SentoriScreenshotCapture.register()` / `SentoriReplayCapture.register()`** 都代理到 `SentoriForegroundActivity.install()`，两边共享同一个 Activity 指针 —— 不会出现 screenshot 看到 Activity 但 replay 没看到的不对称
4. **诊断**：双端新增 `probeScreenshot()`（mirror `probeWireframe()` shape）+ 每个失败 path 都有 tagged 字符串 (`activity.null` / `decorView.zero-size` / `pixelCopy.notSuccess` / `pixelCopy.threw:<class>` / ...)，JS 端 `probeNativeScreenshot()` 一行拿到，Insight verify 不用贴 logcat
5. **iOS screenshot capture** 顺手补 4 层 keyWindow resolution + `probeScreenshot` + lastDiagPath，跟 replay 端保持一致

### Verify

- 109 SDK tests 全绿 + tsc clean
- 待 Insight 在 Samsung Galaxy S22 / Android 16 同一台真机重跑：期 metro log 出 `enqueue ... attachments=3 kinds=screenshot,sessionTrail,replay`、dashboard `attached: ● screenshot · ● replay`
- 失败时 `await Sentori.probeNativeScreenshot()` 一行返回带 `trackedSource: "reflection.activityThread"` / `lastPath` 的诊断

### Other

- Insight 同次 verify 抓到一条 production-grade Android RN bug (`ReactViewGroup contains null child at index 3`) —— 不属于 SDK 路径，平台真的看到了原本看不到的崩溃。独立条目 GOL-589

---

## v1.0.0-rc.1 — Replay scrubber + iOS showcase

**Theme:** Sentori 从 "看到 stack" 进化到 "看到崩前 30 帧的 prop 变化"，并把 iOS SwiftUI showcase 当作开源门面。

**Package bumps：**

- `@goliapkg/sentori-react-native` 0.9.12 → **1.0.0-rc.1** （major — unref crash fix 是 hard break）
- `@sentori/web` (dashboard) 0.1.0 → **1.0.0-rc.1**
- `sentori-server` 0.1.0 → **1.0.0-rc.1**
- `sentori-cli` 0.1.0 → **1.0.0-rc.1**
- `@goliapkg/sentori-monorepo` 0.0.0 → **1.0.0-rc.1**

（其它 SDK package — core / vue / svelte / next — 暂不动，本 release 焦点是 RN 通路。）

### Workstream A — Replay scrubber + fiber tree diff

**A1 — SDK wireframe path repair** (commits `7490bed`, `33230ec`)
- iOS keyWindow 改 4 层 fallback (foregroundActive → fgi → any scene → legacy)，加 NSLog 诊断 + `probe()` 暴露 path / nodes / scene / window counts 给 JS
- Android symmetric probe (activity.null / decorView.null / root.zero-size / activity.resumed)
- JS `probeNativeWireframe()` typed wrapper
- **关键修复**：`replay.ts` 删 `.unref?.()` — Hermes 0.81 timer 是 plain number，optional-chain 走 prototype lookup → undefined → synchronous throw 被 RN bridge 静默吞掉 → setInterval 注册但 callback 永不触发。这是 Insight 2026-05-17 verify report 的 "starting bound=true 后 30s 没有 tick log" 根因
- 加 unconditional FIRST INVOCATION log + startSpan 包 try（span 库失败不再杀整个 tick）

**A2 — Frame-level delta encoding** (commit `6203ec8`)
- 60-frame payload 在 sparse app 上 ~7 KB raw、heavy app ~400 KB raw，都在 500 KB attachment cap 内
- 加 frame-level dedup：新 snapshot 跟最后一帧 byte-equal 时不 push。静态 UI 不再吃掉 ring 槽位

**A3 — Server-side wireframe storage + query** (commit `d2a8258`)
- 修 `ALLOWED_KINDS` 漏 `replay` 的 bug — migration 0043 加了 DB CHECK 但 application 层 whitelist 没同步，每次 SDK upload replay attachment 都 400 invalidKind（Insight 看到 `○ replay` 的根因）
- 加 `application/x-ndjson` 到 replay 的 media-type whitelist
- 新 endpoint `GET /admin/api/projects/{project_id}/events/{event_id}/replay-frames` — 服务端解 NDJSON 直接返回 frame JSON 数组，dashboard 不用在 client 做 NDJSON parse

**A4 — Dashboard scrubber UI** (commit `455beda`)
- 新 `<ReplayTab>` 加在 issue detail 的 tab 列表，位置 Stack 后、Events 前
- SVG wireframe canvas（一个 `<rect>` per node + soft text glyph，aspect ratio 锁 device viewport）
- 220px 右侧 meta 列：frame N/total · t+ 秒 · ts · nodes · viewport
- Horizontal thumbnail rail — 一帧一个 mini SVG，accent outline on 当前帧，click-to-jump
- Scrubber 控件：Prev / Play / Next + HTML range slider + 2 Hz auto-play stop at end (不 wrap)
- 键盘导航：← → step / Space play-pause / Home End jump
- Empty state 引导 SDK 配置而不是 404

**A5 — Tree diff renderer** (commit `2cc6694`)
- "◉ diff vs prev" toggle 在 meta 列
- spatial fingerprint 配对（(x,y,w,h) 取整 → key）— SDK 不出稳定 ID 时这是最诚实的 matcher
- added (success-green outline) / changed (warning-amber outline) / removed (danger-red translucent ghost overlay at prev position)
- diff summary 行：added N / changed N / removed N

**A6 — Issue detail integration** (folded into `455beda`)
- 1 import + 1 Tab key + 1 conditional render

### Workstream S — Showcase / marketing front door

**S1 — Showcase polish round 1** (commit `93fed34`)
- iOS-18+ MeshGradient aurora behind warm-dark backdrop（缓慢漂移，atmospheric not UI animation）
- 共享 `formatBytes` helper — "—" / "952 B" / "1.0 KB" / "30.9 KB"
- DefRow 收 84→72px gutter + minimumScaleFactor 0.7 — `(not yet sampled)` 完整显示

**S2 — Marketing screenshot capture** (commit `c9b3c76`)
- `marketing/assets/showcase-hero.png` — 顶部 scroll：brand wordmark + tagline + status pill + 8-card demo grid 上半
- `marketing/assets/showcase-bottom.png` — 底部 scroll：grid 下半 + wireframe replay ring chart + recent events + footer

**S3 — Repo root README** (commit `72f10fd`)
- 完全重写：showcase hero 起手 → 三个 60s path（try-in-sim / RN install / self-host）→ RN-first features 罗列 → roadmap
- 替换过期的 `@sentori/react-native` 为 `@goliapkg/sentori-react-native`
- 链接 `docs/roadmap/v1.0.md` 而非旧 phases doc

**S4 — docs-site landing alignment** (commit `c12dc3f`)
- splash hero 接 README tagline
- 4 张 card：iOS showcase / SDK reference / Wireframe replay / Self-hosting
- "What you can do today" 列出 4 个可执行的能力
- 25 pages 编译干净，无 MDX/Starlight warning

### Workstream C — Intent cluster (cold)

C1–C6 全部 cold。trigger："Replay" 上线 ≥ 1 周 + ≥ 100 events 带完整 breadcrumbs — 等真实数据积累。下个 release 开 C 系列。

### iOS Showcase 项目本身 — `apps/ios-showcase/`

新增。SwiftUI 6 + iOS 26 deployment。**直接 link SDK 的 Swift 源**（绕开 ExpoModulesCore JS bridge），证明 native 通路在没有 RN 的情况下也能用：

- `SentoriCrashHandler` / `SentoriReplayCapture` / `SentoriScreenshotCapture` / `SentoriMobileVitals` / `SentoriHangWatchdog` / `SentoriNativeExceptionBridge` 全部链接，`SentoriModule.swift`（Expo wrapper）显式排除
- xcodegen 作为 project 源（xcodeproj git-ignored）
- 6 个 SwiftUI view 模块：Hero / KPI / ActionGrid / ReplayRing / EventLog / Footer
- 8 张 demo card，每张 SF Symbol 动画 + Liquid Glass material + 触发一个 SDK 能力

### 验证

- iOS showcase 在 sim-sentori 上跑：10 秒内 replay frames 16 → 258，bytes 0 → 30.9 KB（wireframe sampler 在 native 通路里跑得稳）
- 所有 [sentori] diagnostic warn 在 RN example app 上 fire on boot — A1 trigger 真实达成
- 109 SDK tests + dashboard typecheck + docs-site build 全 green
- 所有 commits CI green，deploy 上线 app.sentori.golia.jp

### 已知限制

- `apps/ios-showcase/` 是 simulator-only，没 deployment team 签名（CODE_SIGN_IDENTITY="-"）
- RN SDK 0.9.x→1.0.0 是 major bump（unref crash fix 是 hard break）— 升级前确认你的 RN 上 Hermes timer 实现，0.83 之后版本已修
- C 系列（intent cluster）延后到 v1.1

---

## v0.7.1 — Insight feedback patch（Phase 48）

**Goal:** Insight 第一份 dogfood 反馈直接落 fix。Screenshot 链路修通 + MaskRegion 不再是空头支票 + dashboard 几条专业感破绽（路由、版本号、sidebar 拥挤、IDE 外部跳转）一次性收掉。

**npm 包变化：**

- `@goliapkg/sentori-javascript` 0.4.0 → 0.4.1
- `@goliapkg/sentori-react-native` 0.7.0 → 0.7.1
- `@goliapkg/sentori-react` 0.4.5 → 0.4.6
- `@goliapkg/sentori-next` 0.2.5 → 0.2.6
- `@goliapkg/sentori-vue` 0.1.0 → 0.1.1
- `@goliapkg/sentori-svelte` 0.1.0 → 0.1.1
- `@goliapkg/sentori-solid` 0.1.0 → 0.1.1

（sentori-core 0.6.0 不动 — 协议层无变化。）

### Phase 48 sub-A — Screenshot 链路修复 ✅

Insight 反馈核心：CFNetwork log 显示 POST `/v1/events/<id>/attachments/screenshot` server 端 202 接收成功，但 issue 详情页五个 tab 完全没有 attachment 展示位。三层修：

- **Server**：`list_events_for_issue` 加 `enrich_attachments` 步骤，单批 query `event_attachments` 表并覆盖 `payload.attachments[]`。Server 端是 source-of-truth，client echo 失败或者 ref 不匹配都不影响 dashboard 显示。
- **RN client**：`uploadAttachment` 把 `if (resp.status !== 201) return null` 放宽成接受任何 2xx（反向代理偶尔把 201 改成 202，这正是 Insight 撞到的现象）。Body 解析失败也优雅 null。
- **JS client**：同样的放宽，sessionTrail 上传走同一条路径。

### Phase 48 sub-B — MaskRegion 真正生效 ✅

之前 `_maskedNativeIds` 只注册不消费 — wrap 14 个 surface 的 `<MaskRegion>` 然后截图照样把 PII 全送上去（Insight 反馈 P1，GDPR/CCPA 视角是 stop-ship）。重写：

- `<MaskRegion>` 现在渲染 children + 一个 `absoluteFill` 的黑色 overlay View（normally `opacity: 0`，被 `pointerEvents="none"` 屏蔽不挡触摸）。
- `engageMasks()` 截屏前把所有 overlay 翻 `opacity: 1` 盖住 children；imperative `setMaskedNode(ref)` 注册的 view 直接 `opacity: 0` 隐藏。截屏完恢复。
- `captureScreenshot()` 在 `captureRef` 调用前 + 后各 yield 一帧确保 paint 落地。

### Phase 48 sub-C — Issue list filter 进 URL ✅

Issues list 的 `status` (active/regressed/...) tab、`q` search、`anr` 切换全部进 URL search params。F5 / link share / 后退 都保留 filter 状态。新 hook `useUrlParam<T>` 是其它视图后续接入的 building block。

### Phase 48 sub-D — Sidebar footer 重做 + version badge ✅

之前 footer 把 email link + EditorPicker + 4 个 toggle 全挤进 ~200px 宽，把 "Sign out" 文字压成两行。重做：

- 引入 `<UserMenuButton>` 弹出式 popover：邮箱+role chip 是 trigger，点开里面有 "My activity" 和 "Sign out"。
- 单行 toggle strip：密度 / 主题 / 折叠 sidebar handle。
- 最底下一行 `text-fg-muted/50 mono` 显示 `v0.7.1 · sha7chars`，sha 从 `VITE_GIT_SHA` 取（Dockerfile.web 已注入）。`web/src/version.ts` 是 SENTORI_VERSION 的 single source of truth，每次发版手动 bump。

### Phase 48 sub-E — Dev build 文案 ✅

Frame source drawer 在 404 时根据 `event.payload.environment` 分两路：

- `dev` → 「Dev build. Source maps are only uploaded for production releases. Ship a release build with `bun cli release` to see the original source here.」
- 其它 → 保留通用 fallback 文案。

### Phase 48 sub-F — 内嵌 source viewer，去掉 IDE jump ✅

Sentori 主张零外部依赖。删掉：

- `<OpenInEditorButton>` (8 个内置 IDE URI scheme + custom template)
- `<EditorPicker>` sidebar UI
- `web/src/lib/editor-template.ts` + test

实际上 `<FrameSourceDrawer>` 通过 server 的 `frame_source` endpoint 已经从 sourcemap 的 `sourcesContent` 抽出完整源码、内嵌渲染（starry-night 高亮 + 上下文 ±5/±20 行可切换）— 这条链路本来就完整，IDE 跳转按钮一直是冗余。点 stack frame 即开。

### Phase 48 sub-G — Publish + ROADMAP ✅

7 个 npm 包 publish，本节 + git tag v0.7.1。

---

## v0.7 — 综合升级（Phase 43–47）

**Goal:** 在 v0.6 issue 诊断深度的基础上，五条并行轴一次性铺开：Linear/Slack 双向集成、客户端 sampling + 数据分析、Web SDK 矩阵（Vue/Svelte/Solid 加入）、session-trail 轻量回放、最后一波 polish 收尾。

**npm 包变化**：

- `@goliapkg/sentori-core` 0.5.0 → 0.6.0（Phase 44 sampling helpers + Phase 46 TrailBuffer/SessionTrail）
- `@goliapkg/sentori-javascript` 0.3.4 → 0.4.0（sampling、sessionTrail capture + uploadAttachment、captureStep）
- `@goliapkg/sentori-react-native` 0.6.1 → 0.7.0（sampling、sessionTrail、useTraceNavigation 自动 captureStep）
- `@goliapkg/sentori-react` 0.4.4 → 0.4.5（router 自动 captureStep）
- `@goliapkg/sentori-next` 0.2.4 → 0.2.5（依赖跟随 javascript/react）
- `@goliapkg/sentori-vue` 0.1.0 ✨ 首次发布
- `@goliapkg/sentori-svelte` 0.1.0 ✨ 首次发布
- `@goliapkg/sentori-solid` 0.1.0 ✨ 首次发布

**设计四条协调铁律**：sentori-core single source of truth / 复用 Phase 42 attachment 框架 / 集成走 v0.2 outbound webhook 改造的 IntegrationAdapter trait / sampling 跨 SDK 单一 API。

### Phase 43 — Linear 双向集成 + Slack（commit 92e482f / 542900d / 370d746 / e0c24df）✅

- 新表 `integrations`（org_id, kind in ('linear','slack'), config JSONB）+ `issue_integration_links`，partial unique index on (org_id, kind) WHERE revoked_at IS NULL
- `IntegrationAdapter` Rust trait，`ConnectMode::{OAuth, Manual}` 枚举：Linear 走 authorize_code → token，Slack 走 manual incoming-webhook URL
- Linear adapter：GraphQL `issueCreate` mutation + `Linear-Signature` 头的 HMAC-SHA-256 constant-time 校验。webhook 反向同步：Linear issue state.type → 'completed'/'canceled' 触发 Sentori resolve，同状态短路防 comment 回环
- Slack adapter：`accept_manual_config({webhookUrl, channelLabel?})` 校验 `https://hooks.slack.com/` 前缀，Block Kit 模板用 mrkdwn 转义
- 派发链路：`integrations/dispatch.rs#on_new_issue` / `on_status_change` 用 `tokio::spawn` 走 ingest 热路径之外，Linear API 延迟永不阻塞 event 落库
- Dashboard `<IntegrationsView>` 加 SECONDARY nav（admin-only），OAuth/Manual 双 mode 渲染、`<SlackConfigureForm>` inline

### Phase 44 — Sampling + 数据分析（commit 0bf924a）✅

- `sentori-core/src/sampling.ts`：`shouldSample(rate)` 均匀采样 + `shouldSampleTrace(traceId, rate)` 对 traceId 前 32 bits 哈希做确定性决定（保证一条 trace 的所有 span 共享同一 yes/no）+ `normalizeRate` clamp 到 [0,1]
- RN + JS SDK：`init({ sampling: { errors, traces } })`，capture 路径在最开始 gate，丢弃前埋 `sampled-out` 面包屑保留可观测性
- Issue merge 功能：`POST /admin/api/projects/{p}/issues/{i}/merge` 事务式 UPDATE events SET issue_id + 聚合 + DELETE source。Dashboard `<MergeIssueButton>` 带 UUID 校验
- Issue 全文搜索：migration 0034 加 `tsvector` 生成列 + GIN 索引（`simple` config 不做词干），`?search=` query 串走 `to_tsquery`，issues 列表的 free-text 自动喂进 search
- Cross-stack cause chain：event 协议加 `error.nativeError?: { issueId, type, message }`，dashboard `<NativeErrorCard>` 在 CauseChain 里展示 amber-tinted 跨栈卡片 + 跳 native issue 链接

### Phase 45 — Web SDK 矩阵 Vue/Svelte/Solid（commit c5fab5b）✅

- `@goliapkg/sentori-vue@0.1.0`：`app.use(sentori, opts)` plugin，包住 `app.config.errorHandler`（chain previous）；`<SentoriErrorBoundary>` 用 `errorCaptured` lifecycle + slot fallback + `ignore` prop；`setupTraceNavigation(router)` from `/router` subpath
- `@goliapkg/sentori-svelte@0.1.0`：`sentoriHandleError()` 工厂返回 `HandleClientError` 形状；`traceNavigation($navigating)` 接 `$app/stores`；Svelte 5 用户直接用内置 `<svelte:boundary>`
- `@goliapkg/sentori-solid@0.1.0`：`sentoriOnCatch` 给 Solid 内置 `<ErrorBoundary onCatch>` 用；`traceSolidRouter(pathname)` 在 `createEffect` 里调，同路径短路
- 三个 SDK 各 ~100 LOC adapter，shared adapter base 评估后改判为不需要（框架 boundary 语义差异太大，强抽象更绕）

### Phase 46 — Session-trail 轻量回放（commit 07d12f1）✅

- `sentori-core/src/trail.ts`：`TrailBuffer` ring buffer max 30 steps + `sealTrail()`，每步 `{ ts, label, breadcrumb?, viewTreeRef?, screenshotRef? }`
- `captureStep(label, opts)` 公开 API（JS + RN 都暴露），各 framework SDK 的 router helper（react/vue/svelte/solid）自动写 `route:<path>`，RN 的 useTraceNavigation 写 `screen:<name>`
- `init({ capture: { sessionTrail: true } })` opt-in；`captureException` 时 `sealTrail` → `uploadAttachment('sessionTrail', JSON)` → push ref 进 `event.attachments[]`，并清空 buffer（每个 crash 一份 trail，干净）
- Server：`AttachmentKind` 加 `'sessionTrail'`，migration 0035 扩 event_attachments.kind CHECK，application/json 白名单
- Dashboard `<SessionTrailViewer>`：左栏 step list + 右栏 detail（label、相对 crash 时间、breadcrumb、可选 screenshot/viewTree 链接），← → 键步进，默认 focus 最后一步（最接近 crash）。AttachmentGallery 自动渲染为可展开 `<details>` 卡

### Phase 47 — Polish 收尾 ✅

- 47.01 Related Issues panel：server `GET /admin/api/projects/{p}/issues/{i}/related` 返回同 project / 同 error_type 的 sibling issue（capped 5，按 last_seen DESC），dashboard `<RelatedIssuesPanel>` 渲染为 header 下的 chip row + 已 resolved/closed 的 muted 渲染
- 47.02 hover frame ↔ tree node 联动：`web/src/lib/frame-hover.tsx` FrameHoverContext，stack frame hover 用 `file:line` 发布，ViewTreePanel 翻译成 nodeId Set 高亮 + `scrollIntoView({ block: 'nearest' })` 滚到第一个匹配节点。与既有 search highlight 用不同 palette（hover 是 `bg-accent/20 ring-1`，search 是 `bg-accent/10`），ancestor 链对两者都自动展开
- 47.04 SDK perf benchmark：`sdk/core/src/__tests__/perf.bench.ts` 给 uuidV7 / shouldSample / shouldSampleTrace / breadcrumb / TrailBuffer.push / sealTrail 各一条 wall-clock 预算（10x 实测 margin，CI-safe）。`bun run bench` 跑这条
- 47.05 Dashboard LCP gate：`web/lighthouserc.cjs` + `bun run lhci`，LCP < 1200ms 是 hard build-breaker，FCP/TBT/CLS 是 warn。手动跑：`cd web && bun run build && bun run preview & bun run lhci`。CI 接入文档见 `docs/performance/dashboard-lcp.md`
- 47.06 ROADMAP + CHANGELOG v0.7 整段（本节）
- 47.07 v0.7 tag + npm publish：**等用户授权后执行**（npm 不可逆 + git tag push 影响 shared state，所以不自动跑）

---

## v0.6 — Phase 42 — Issue Detail 诊断深度

**Goal:** Issue 详情从「stack + 朴素文本源码」升级成「stack + 高亮源码 + 智能调用链 + 出错截图 + UI tree + cross-stack 串联 + AI export」。覆盖 JS / RN / iOS native / Android native 全栈。9 个 sub-phase (A → I)，每个独立 commit + 多数独立 deploy。

**npm 包**：`@goliapkg/sentori-core@0.5.0`（加 `AttachmentMeta` 类型）+ `@goliapkg/sentori-react-native@0.6.0` (sub-D JS 截图) → `0.6.1` (sub-E iOS native + sub-F Android native)。

**设计原则四条铁律**：零热路径成本 / 跨 native+JS 统一表达 / 隐私默认安全 / 可扩展 attachment 模型。

### sub-A — Dashboard 视觉强化（无 SDK 改动）✅

- `@wooorm/starry-night` syntax highlighting，GitHub-tone 配色，按 `data-theme` 而非 `prefers-color-scheme` 切换；`<SourceCode>` 组件每行 div + 行号 + `#L<n>` anchor
- `FrameRow` ±3 行 inline source + `FrameSourceDrawer` 全文 + auto-scroll
- `packageOf(file)` 推断 npm package（@scope、react-native 双布局、Metro lazy-bundle %2F 编码）
- `VendorFold` 按 package group："react-native (8 frames)" 而非 "11 library frames"
- `<FrameRoleBadge>` you / framework / lib 颜色编码
- `CauseChain` accent-tinted 卡片 + "↪ caused by" 标签
- `source_repo_url` per-project（migration 0031 + PATCH endpoint）+ frame 旁 "↗ src" 链接（GitHub/GitLab/Bitbucket/Gitea 通用 `/blob/<ref>/<path>#L<line>`）
- `<OpenInEditorButton>` URI scheme jump，per-user 8 内置 IDE + Custom 模板（Insight 反馈后加，原 vscode:// hardcoded → user-pickable）
- `<IssueDetailSkeleton>` 替代 LoadingState

### sub-B — Source / context lazy load ✅

- ingest 时存 ±3 行（缩自 ±5），event payload 缩 40%
- frame source endpoint 加 `lines` query 参数（默认 5、上限 50），Cache-Control immutable+1h
- `<FrameSourceDrawer>` ±5/±20/±50 toggle，`placeholderData: prev` 切换无 loading flash

### sub-C — Attachment 基础设施 ✅

- migration 0032 `event_attachments` 表
- `AttachmentStore` trait + `LocalFsAttachmentStore` (`$SENTORI_ATTACHMENT_DIR`) + `NoopAttachmentStore` (env 未设 → 503)
- `POST /v1/events/{id}/attachments/{kind}` multipart 500KB 限 + mediaType 白名单按 kind
- `GET /admin/api/events/{id}/attachments/{ref}` admin gate + Cache-Control immutable
- ingest 校验 `event.attachments[].ref` 必须签发给同一 (event_id, project_id)，不匹配静默丢
- retention sweep `prune_attachments`：events_cutoff 之前同步清 DB 行 + 磁盘 blob

### sub-D — JS / RN 截图 (SDK 0.6.0) ✅

- `init({ capture: { screenshot: true } })` opt-in
- `captureScreenshot()` `InteractionManager` + `rAF` 双 yield，1.5s timeout，480px JPEG q=70
- `uploadAttachment` RN-style FormData (`{uri,type,name}`)
- prod 配额 10 张/session，dev 不限
- `<MaskRegion>` 声明式 + `setMaskedNode`/`unsetMaskedNode` 命令式
- dashboard `<AttachmentGallery>` + `<Lightbox>` (esc / ← → / download)

### sub-E — iOS native (SDK 0.6.1) ✅

- `SentoriScreenshotCapture.swift`：`UIGraphicsImageRenderer` 抓 key window，480px → JPEG q=70；`UIView` 递归 view tree depth=10 / 1500 nodes 上限，accessibilityLabel 200B 截断
- NSException handler 同步抓屏 + view tree → event JSON 里塞 `_pendingAttachments` → JS 下次启动 drain 时上传 → 写回 `event.attachments[].ref` → enqueue
- XCTest stub（XCTest 在 CLI Swift 缺 UIKit/XCTest module，IDE 内 ⌘U 跑）

### sub-F — Android native (SDK 0.6.1) ✅

- `SentoriScreenshotCapture.kt`：`ActivityLifecycleCallbacks` 跟踪 foreground Activity；`PixelCopy.request` API 24+ GPU 异步抓（不阻塞主线程，ANR 时也能抓）；Android 11+ `WEBP_LOSSY` / 老版本 JPEG；DecorView 递归 view tree
- 接入 `SentoriCrashHandler` + `SentoriAnrWatchdog`（ANR detector trigger 也走 attachPending）
- Robolectric 单测（GPU/PixelCopy 部分留 instrumentation test）

### sub-G — View Tree Skeleton dashboard ✅

- `<ViewTreePanel>` 折叠树 + 文本搜索（name / accessibilityLabel / contentDescription），命中祖先链自动展开
- props_summary 内联前两项（a11y label / frame / alpha / hidden）
- `<AttachmentGallery>` 把 viewTree kind 从 pill 升级为内联 `<details>` 包 `<ViewTreePanel>`

### sub-H — Cross-stack + AI-export + 抛光 ✅（H.01 / H.03 留 v0.6.x patch）

- `<CopyMarkdownButton>` 把 event 渲染成 paste-into-AI Markdown（meta + 5 in-app frames 带语法 fence + ±5 行源码 + 红箭头标 at-line + breadcrumbs 尾 8 条）；clipboard 失败 fallback `prompt()`
- ANR / hang 紫色 banner：`payload.kind === 'anr'` 时 stack 区顶部加 accent-tinted 卡片 + "Hang"(iOS) / "ANR"(Android) 标签
- trace 详情 span aside 加 "Events on this span" → issue 反链
- `c` 快捷键触发 Copy as markdown

### sub-I — 性能 / 隐私 / 文档收尾 ✅

- `docs/sdk-react-native.md` "Screenshot capture (opt-in)" 章节 + docs-site mirror
- `docs/self-hosting.md` `SENTORI_ATTACHMENT_DIR` + Data retention 段含 attachments 行 + 容量估算
- ROADMAP + CHANGELOG 完整 summary（这条）

### 显式延后到 v0.6.x patch

- **H.01 Cross-stack cause chain**：`event.nativeError?: {issueId}` 协议字段 + dashboard 嵌入 native issue 卡片 —— 需要 SDK + server + dashboard 三处协议改动，工作量大于抛光级别
- **H.03 Related issues panel**：新 server endpoint `/admin/api/issues/<id>/related`（同 fingerprint stem / 同 file / 同 release）+ side panel UI
- **G.10 hover frame ↔ tree node 联动**：UI polish，等 Insight 真实用 view tree 后看是否要
- **G.02-G.04 SDK JS Fiber walker**：native 已给 RN/Fabric tree；纯 JS walker 是 nice-to-have
- **I.01 SDK perf benchmark < 100ms / I.02 Dashboard LCP < 1.2s**：需要 perf 测试基础设施，待 Insight 真实流量进来后基于实际 P95 调

### Insight 升级路径

```sh
bun add @goliapkg/sentori-react-native@latest   # 0.6.1
# opt-in 截图：init({ capture: { screenshot: true } })
# 用 <MaskRegion> 包敏感 UI（信用卡 / 私聊 / OTP 输入框）
```

服务端：`SENTORI_ATTACHMENT_DIR=/apps/sentori/attachments` 设上让 multipart endpoint 进入工作状态（未设 → 503 `attachmentsDisabled` SDK 端 silent drop，attachments 不影响 event 本身落地）。

---

## v0.5.7 — `sentori-react-native` hotfix: RN 0.83 new-arch dev-symbolicate

**Reported by Insight dogfood (RN 0.83.6 + Hermes + Fabric/TurboModule new arch).** Dev-mode errors were arriving in dashboard as fully minified stacks (`_temp5`, `anonymous`, `_performTransitionSideEffects`) despite 0.5.6 advertising automatic Metro `/symbolicate`. Root cause: SDK read `NativeModules.SourceCode.scriptURL`, which on the new architecture is `undefined` (constants are not hoisted onto the module object — they live behind `getConstants()`). With `scriptURL` undefined, `metroSymbolicateUrl()` returned null and the SDK silently skipped symbolication.

**Fix:** prefer `react-native/Libraries/Core/Devtools/getDevServer`, the same helper RN's own LogBox and `symbolicateStackTrace` use internally. It calls `NativeSourceCode.getConstants().scriptURL` under the hood and works on both old and new arch. Falls back to `NativeModules.SourceCode.getConstants().scriptURL` and then the legacy `.scriptURL` property for older RN versions.

**npm**: `@goliapkg/sentori-react-native@0.5.7` (no other packages changed).

---

## v0.5 — Scale + Readable Errors + Dashboard sidebar（Phase 39-41）

**Goal:** Insight dogfood 把 v0.4 的盲区都打了出来 —— trace 不归组、错误栈不可读、左侧没导航。v0.5 三条主线就是补这些洞，对应 dashboard 上一线员工真能用的 traces 列表、`src/Foo.tsx:42` 的栈渲染、Linear 风左侧 sidebar。

**反 Sentry 立场延续：** trace 用「时间硬保留窗口 + 窗口内 100% 不采样」，不默认开 head-based / tail-based 采样（schema 简、部署轻、不丢有错的 trace）；source-map 符号化在 ingest 时一次做完 + 按符号化帧重新分组 issue，不靠"on-demand at view"绕一圈。

**npm 包**：sentori-core 0.4.1 / sentori-javascript 0.3.4 / sentori-react 0.4.4 / sentori-react-native 0.5.6 / sentori-next 0.2.4 / sentori-cli **0.3.0**（新发布）/ sentori-expo 0.1.1。

### Phase 39 — Trace 上量管控 ✅

- **sub-A** `sdk/core/normalizeUrl(url)` —— path id-like 段 → `{id}`（pure-numeric / uuid / 长 hex / 长 opaque token），砍 query+fragment；三个 hook（RN fetch+xhr / JS fetch+xhr）接上 —— span `name` 收敛成路由，`http.url` tag 保完整
- **sub-B** navigation span 自动当父：`useTraceNavigation` / `useSentoriRouter` 每屏开一个 `react.navigation` span（含初始屏，各自 trace root），并 `setActiveSpan` 让它常驻 active；该屏的 `http.client` span 自动成 child —— **一屏一 trace** 而不是一请求一 trace
- **sub-C** 时间硬保留：`SENTORI_TRACE_RETENTION_DAYS`（默认 14）；`retention.rs` 泛化成同时管 events + spans 分区滚动/drop；`traces` 不分区（UPSERT 冲突）走 DELETE + 新 `traces_last_seen_idx`（migration 0029）
- **sub-D** span 独立月度配额：`check_and_record_spans`（`SENTORI_SPAN_LIMIT_MONTHLY` 默认 10M）—— span 洪水不再吃 error event 的配额
- **sub-E** Q4 复合 index（migration 0030 `(project_id, op, duration_ms DESC)`）：实测 1M spans **43ms → 0.40ms**（~100×，plan 从 seq+heapsort → per-partition index seek）；baseline doc `docs/performance/baseline-v0.5-phase39.md`
- **sub-F** publish 5 包 + inter-dep pin 同步避免 version-pin trap；dogfood 记录

### Phase 40 — 可读的 JS/RN 错误（sourcemap 端到端）✅

- **sub-A** `parseStack` 修 Hermes 字节码帧：`at fn (address at /path/main.jsbundle:1:N)` 剥前缀；`(native)` 无位置帧丢弃
- **sub-B** `@goliapkg/sentori-cli` 新发布 —— `upload sourcemap` + `react-native upload`（一行 compose Metro+Hermes + upload）；Node ≥18 / 零运行时依赖；EAS post-build hook 修
- **sub-C** server 在 ingest 时符号化：`symbolicate_event` 用上传的 sourcemap 把 `Event.error.stack`（+ cause 链）重写成原始 source，`Frame` 加 `rawLine`/`rawColumn` 保 bundle 坐标（"show source" 反查需要）；issue **按符号化后的 in-app top 帧重新 fingerprint**（一个 release 第一次传 map → 老 issue 静、新 issue 冒出，同 Sentry），没传 map 的 release 行为不变
- **Day 2** 401 hint：admin auth / ingest auth 的 `401` body 加 `hint` 字段（无 Bearer / 错前缀 / revoked 各文案）；`Event.symbolication: { releaseHasMap }` server-set meta
- **Day 3** dashboard issue 详情：in-app 帧默认展开带 ±5 行内联源码（出错行红底高亮），连续 vendor 帧折叠成 `▸ N library frames`；in-app 帧若没解析按 `releaseHasMap` 标原因（"upload a source map: `npx sentori-cli upload sourcemap …`" / "wrong build / outside the map"）；`UnsymbolicatedHint` 链 docs recipe；server `symbolicate_frame_typed` 顺手填 `pre/context/postContext` 不用每帧 fetch
- **Day 5（sub-E）** dev-mode Metro：`__DEV__` 下 SDK 发事件前先 POST 给 `<devServer>/symbolicate`（RN LogBox 那条），dev 错误也立刻可读

### Phase 41 — Dashboard 左侧 sidebar ✅

- **Day 6** 新 `web/src/components/sidebar.tsx`：顶 Sentori + OnboardingBadge + OrgSwitcher；主导航（带 16px inline-SVG icon）+ 次要项（admin-only 自动隐藏）+ 底部 footer（用户邮箱 + RoleBadge + density toggle + ThemeToggle + Sign out）；`md+` 持久 `w-56` 边栏 / 窄屏 fixed hamburger → overlay drawer（route 变自动关）。`org-layout.tsx` 去掉顶部横排 NAV，改成 `<Sidebar/>` + 内容区两栏；所有路由路径不动
- **Day 7** sidebar.test.tsx +5（主/次导航渲出、active 高亮、非 admin 隐藏 Alerts/Audit、hamburger 存在）；CHANGELOG + tag v0.5.0

### v0.5 显式 defer 到 v0.6 / 按需

- ❌ head-based / tail-based 采样默认开启（`tracesSampleRate` 留 SDK 开关，默认 1.0）；tail-based stateful collector 不做
- ❌ "Expo zero-config config plugin" 自动注入 Xcode/gradle build phase —— Insight 用 `sentori-cli react-native upload` 接进 `eas-build-on-success` script 一行已足够干净；真要 zero-config 时单独做 + 仔细测
- ❌ `g i` / `g t` "go to" 快捷键、sidebar 折叠到图标轨 —— polish，没收到诉求再加

---

## v0.4 — Distributed Tracing（Phase 34-38）

**Goal:** Protocol 早就留好的 `traceId` / `spanId` 槽真正用起来。从 RN client 一路追踪到后端 API，dashboard 看 waterfall。反 Sentry envelope-bloat：单 JSON span ingest，所有 root + child 是同一个 spans schema，靠 `parentSpanId == null` 区分；不上 transactions[] 嵌套 / measurements 浮点矩阵；waterfall 纯表格 + 缩进，不画 SVG bar。

### Phase 34 — Protocol + storage 准备 ✅

- **sub-A** Span 协议：`docs/protocol.md` 加 `## Span schema` 14 字段表 + 命名约定（http.client/server / db.query/transaction / cache.get/set / react.render/navigation / app.cold-start）+ "什么不做" 反 Sentry/OTel 子节；`POST /v1/spans` + `/v1/spans:batch` (200/batch) endpoint；Event schema 的 `traceId`/`spanId` 从 v0.1 占位升为 v0.4 in-use 语义
- **sub-B** Schema：migration `0026_spans.sql` partitioned by `received_at`（PK `(received_at, id)` 复合）+ 4 索引（trace_id / parent_span_id partial / project_id+received_at / project_id+op）+ migration `0027_trace_meta.sql` `traces` 物化表（trace_id PK + project_id + root_op/name + first/last_seen + span_count + status worst-of + duration_ms）；不分区因为 trace 数是 span 的 1/200
- **sub-C** Ingest endpoint：`server/src/api/spans.rs` single + batch handler（≤ 200/batch），validate 7 项（op/name 长度 / status enum / duration 24h / tags ≤ 50 keys 必 string / data 16KB），`persist_span` tx 内 INSERT spans + UPSERT traces 维护 worst-of status；quota 共享 events bucket
- **sub-D** EXPLAIN baseline：5000 trace × 200 span = 100k spans (SQL bulk INSERT 1s)；Q1 trace list 0.075ms / Q2 trace detail 0.68ms / Q3 span search top-50 5.64ms；`tools/seed-spans.ts` 实际 HTTP path tool；`docs/performance/baseline-v0.4-phase34.md`

### Phase 35 — SDK 端：RN + JS + React ✅

**5 个 npm 包 publish**：sentori-core 0.3.0 / sentori-javascript 0.3.0 / sentori-react 0.4.0 / sentori-react-native 0.5.0 / sentori-next 0.2.0

- **sub-A** `sdk/core` span buffer + trace-context：`SpanHandle` + `SpanBuffer` ring (cap 1000) + `startSpan` / `withSpan` / `activeSpan`；Node 路径 lazy require AsyncLocalStorage（await 跨 continuation 保持 context）/ browser/RN fallback save-and-restore；40 单测
- **sub-B** JS SDK fetch hook：`installFetchInstrumentation` monkey-patch globalThis.fetch + W3C traceparent header 注入（`toTraceparent` 16-hex truncate）+ status 映射（4xx/5xx → error / AbortError → cancelled）；20 单测
- **sub-C** RN SDK fetch + react-navigation：handler/network.ts 扩展现有 fetch hook 同时 emit breadcrumb + span；`useTraceNavigation(navigationRef)` hook duck-typed 不绑 `@react-navigation/native` 保持 optional peer；34 单测
- **sub-D** `<TraceRender>` React component：useMemo([], startSpan) + useEffect cleanup finish；re-render 不重开 span；同时修两 latent bug（sentori-core 版本 pin / SentoriSuspense 漏 export）；20 单测
- **sub-E** Publish 5 包 + dashboard dogfood：web/src/auth/ProtectedLayout 加 `useSentoriRouter()`；SentoriProvider 走 initSentori → fetch hook auto-install；每个 `/admin/api/...` 请求产 http.client span — **first end-to-end dogfood trace**；bundle +1.15 KB gzip

### Phase 36 — Dashboard：Trace List + Trace Detail ✅

- **sub-A** Trace list view：`web/src/views/traces.tsx` 6 列表格 + status pill 三色 + keyboard nav j/k/Enter + useInfiniteQuery + IntersectionObserver；server `list_traces` 同款 keyset cursor `(last_seen, trace_id)`；sidebar 加入口
- **sub-B** Trace detail waterfall：`web/src/views/trace-detail.tsx` 纯表格 + 缩进 `depth*16px`（**不**画 SVG bar）；hover 行 `ancestorIds` 走 parentSpanId chain 高亮 root→leaf；click 行打开右侧 drawer（id / parent / duration / tags grid / data pretty-print JSON）；orphan span 当 root 兜底
- **sub-C** Span ↔ Event 联动：migration `0028_event_trace.sql` events 表加 trace_id / span_id 列 + partial index；ingest pipeline 写两列；Issue detail "In trace →" pill + Trace detail "N event(s)" 红 chip 反向跳转
- **sub-D** Search-token parser：`parseTraceQuery` 同 `parseIssueQuery` 模式 — `op:` / `status:` / `duration:>Nms|>Ns`；单 search box 替换 3 dropdown；11 vitest 覆盖

### Phase 37 — Cross-cutting：W3C TraceContext 后端联动 ✅

- **sub-A** sentori-server 自身 instrument：`SpanEmitter` buffer + 30s flush task + 200-span 突发 flush；axum middleware 包 handler 抓 method/path/traceparent → emit `http.server` span；`router::build` 加 `self_trace` 可选 layer；`main.rs` 读 env `SENTORI_SELF_TRACE_PROJECT_ID`；7 单测 + live smoke 验证跨进程 stitch 通过
- **sub-B** Node SDK middleware：3 framework adapter（Express / Hono / Fastify）+ 共享 `parseTraceparent`；subpath export `@goliapkg/sentori-javascript/tracing`；Hono 用 `withSpan(next)` 让 handler 内 startSpan 自动 child；15 新单测
- **sub-C** Recipe doc：`recipes/distributed-tracing.md` 三层全栈走读（RN → Node Hono → Postgres）+ ASCII 拓扑图 + SDK ↔ 协议 crosswalk 表 + 跨系统 stitch lossy 说明

### Phase 38 — Polish + Performance + 发布 ✅

- **sub-A** 1M span EXPLAIN 复测：5000 traces × 200 spans (~15s SQL bulk INSERT)；Q1 0.131ms / Q2 1.16ms / Q3 0.11ms / Q4 40.7ms（7.2× sub-linear scaling，plan-shape 均未变 → 不触发 regression policy）；`docs/performance/baseline-v0.4-phase38.md`；deferred 2 项 action item（partition prune hint / Q4 composite index）留 v0.5
- **sub-B** CHANGELOG + tag v0.4.0 + GitHub Release + marketing hero 加副标题 "Distributed tracing built in"

### v0.4.1 patch — XHR instrumentation

dogfood 发现：sentori-rn / sentori-js 的自动 tracing 只 patch `globalThis.fetch`，但 axios（RN 上默认 `xhr` adapter / 浏览器同）走 `XMLHttpRequest` 不经 fetch — 用 axios 的 app（如 Insight）几乎不产 http.client span。Phase 35 sub-C 的注释 "RN polyfills XHR over fetch internally" 是错的，RN 的 XHR 是原生实现。

- `sdk/react-native/src/handlers/network.ts` 拆 `patchFetch()` + `patchXhr()`，后者 patch `XMLHttpRequest.prototype.open/send` — open 时存 method/url，send 时开 span + 注 traceparent header + 监听 `loadend`（status 0/4xx/5xx → error）和 `abort`（→ cancelled）
- 新 `sdk/javascript/src/hooks/xhr.ts`：`installXhrInstrumentation` 同款 prototype patch；`init.ts` 在 `installFetchInstrumentation` 后也调它
- 测试：JS SDK +9（XHR lifecycle / traceparent / 5xx / status 0 / abort / URL input / 并发独立 span）；RN SDK +5（同款用 FakeXHR）；JS suite 44/44，RN suite 39/39
- publish 4 包（core 无改动不 bump）：sentori-javascript 0.3.0 → 0.3.1 / sentori-react-native 0.5.0 → 0.5.1 / sentori-react 0.4.0 → 0.4.1（dep js→0.3.1）/ sentori-next 0.2.0 → 0.2.1（dep js→0.3.1 + react→0.4.1）
- Insight 升到 sentori-react-native@0.5.1 即可不改代码拿到 axios trace

### v0.4.2 patch — client span flush（critical fix）

dogfood 第二个坑，比 v0.4.1 更严重：**SDK 从来没有把 client span 发出去**。`installNetworkHandler` / fetch / xhr hook 都正常 `startSpan().finish()`，但只把 span push 进 `sdk/core` 的内存 ring buffer；RN / JS 的 transport 只发 `/v1/events`、`/v1/sessions`，没人 drain 那个 buffer 去 POST `/v1/spans:batch`。结果：所有 client span 都堆在设备内存里，Traces 页面只看得到 server 自身的 `http.server` span。文档 `docs/recipes/distributed-tracing.md` 早就写了"span 经 `/v1/spans:batch` 上报"，代码却没实现。

- `sdk/react-native/src/transport.ts` + `sdk/javascript/src/transport.ts`：加 span flush —— `drainSpans()` → POST `{spans}` 到 `/v1/spans:batch`，每批 ≤200（server 上限），失败即丢（不重试、不离线持久化；span 是 best-effort）。RN 用 10s `setInterval`（`startTransport` 里起）；JS 用 5s `setInterval`（`unref` 掉，不阻止 Node 退出）+ `pagehide` 时再 flush 一次
- `installNetworkHandler` / fetch / xhr hook 现在跳过指向 `getConfig().ingestUrl` 的请求 —— 否则 span 上报本身又会产 `http.client` span，无限套娃
- 测试：RN transport +4（POST batch / 空 buffer no-op / >200 分批 / 5xx 即停）；JS +6（同款 + 未配置 no-op + ingest-URL 不被 trace）；全 SDK sweep 绿（core 40 / js 50 / rn 43 / react 20 / next 9 / expo 4）
- publish 4 包（core 无改动不 bump）：sentori-javascript 0.3.1 → 0.3.2 / sentori-react-native 0.5.1 → 0.5.2 / sentori-react 0.4.1 → 0.4.2（dep js→0.3.2）/ sentori-next 0.2.1 → 0.2.2（dep js→0.3.2 + react→0.4.2）
- Insight 升到 sentori-react-native@0.5.2 后 Traces 页面才会真的有 client span

---

## v0.3 — React-first via dogfood（Phase 29-33，进行中）

**Goal:** 用 Insight (RN) + 一个 React Web 项目作为真实流量源，把 SDK / dashboard / 文档在两个生态里都打磨到 polish 程度，把"React / RN 第一选择"做实。不开新轴。营销不主动推广，只把 docs 打磨到可口口相传。

### Phase 29 — v0.2 deferred sweep ✅

5 sub 全完成：

- **sub-A** iOS 真主线程采样器：`SentoriThreadSampler.swift` 用 raw byte reinterpret 按 ABI index 取 PC/FP（绕过 Swift 未导入的 `_COUNT` 宏和 `__darwin_*` intrinsics）；4 个 XCTest case 覆盖；`HangWatchdog` 用 sampler 输出 + 47-bit PAC mask；e2e 推迟到 example 切到 npm registry 版本（Expo autolinker file:.. monorepo bug）
- **sub-B** webhook 持久化重试队列：migration 0025 + `webhook_dispatch.rs` 的 30s sweep + 6 次重试（[60s, 5m, 30m, 2h, 12h, 24h]）；dashboard `<DeliveriesRow>` 展开块
- **sub-C** server `OffsetDateTime` serde rfc3339 sweep：23 处 serde-derived struct 字段加注解；`scripts/check-rfc3339.sh` 接入 CI 防回归
- **sub-D** UUID prefix collision sweep：15 处 `[..N]` 改 `[12..28]` 取尾部 16 char hex
- **sub-E** CLI `issue list/resolve/silence`：3 unit test 覆盖 clap parse / format / 缺 token 错误；sentori-cli@0.2.0 publish + GH Release with 3 平台 prebuilt 二进制

### Phase 30 — Insight (RN) onboarding polish（进行中）

- **sub-A** Insight 接入秒表 ⏸ blocked（等用户在 Insight 项目实际跑）
- **sub-B** 摩擦点修复 ⏸ blocked on sub-A
- **sub-C** ✅ `tools/seed-events.ts`：UUID v7 + 10 errorType + weighted env + 5% ANR + regression simulation；`docs/self-hosting.md` 加 Populate dev data 章节
- **sub-D** ✅ EXPLAIN ANALYZE baseline：5000 events / 987 issues / 117 sessions 下 5 query 合计 0.55ms execution，全部命中既有索引或被正确 Seq-Scan；`docs/performance/baseline-v0.3-phase30.md`
- **sub-E** ✅ 索引补齐：5k 规模本质上无需新索引；唯一实施项是 `list_events_for_issue` 的 partition-pruning hint（`?days=` query param，默认 90，clamp 1..365）；EXPLAIN 验证 plan 从 9 partition 降到 7；`alert_rules` partial index 推迟到 1M 复跑后再决定

### Phase 31 — `sentori-react` SDK polish ✅

7 sub 全完成，**`@goliapkg/sentori-react@0.3.0` 已 publish**：

- **sub-A** ErrorBoundary v2：`fallback` 接受 `ReactNode | (props: {error, reset}) => ReactNode`；`resetKeys: unknown[]` 浅比较自动 reset；7 test 覆盖（含嵌套 boundary 不冒泡）；`docs-site/sdk-react.md` + 3 个 recipe
- **sub-B** react-router 集成：`useSentoriRouter` hook（subpath export `/router`，optional peer dep `react-router >= 7`）；MemoryRouter 测试初次 mount 不发 + 后续转换 emit `{from, to}` breadcrumb
- **sub-C** Suspense + RSC：`<SentoriSuspense fallback errorFallback?>` 单组件组合 Suspense + ErrorBoundary；`sdk/next/app-router.ts` 加 `useNextRouter` + `useReportNextError`（subpath export `/app-router`）；`error.tsx` recipe 进 sdk/next/README.md
- **sub-D** dashboard 升级到 sentori-react：把 `web/` 加进 root workspaces；`web/src/main.tsx` 删 imperative `initSentori`，改用 `<SentoriProvider>` + `<SentoriErrorBoundary fallback={<ErrorState />}>`；bundle +4KB gzip
- **sub-E** Recipe docs：`recipes/nextjs.md`（App Router + Pages Router + GH Actions yml）/ `recipes/remix.md`（v2 Vite-based + classic esbuild 兼容说明）/ `recipes/vite.md`（minimal SPA + sourcemap CLI）；docs-site sidebar 加 Recipes 分组；13 page build
- **sub-F** Symbolication UX：`<UnsymbolicatedHint>` banner 在未上传对应 artifact 时显示"Open release →"链；server 加 `sentori_symbolicate_duration_seconds{cache="cold|warm"}` histogram instrument 3 条路径；优化暂不做（先 instrument 后调优）
- **sub-G** Publish：`sentori-react@0.3.0` 发到 npm（package size 14.57 KB packed / 50.58 KB unpacked / 45 files）

### Phase 32 — Docs + onboarding 完整化 ✅

5 sub 全完成：

- **sub-A** getting-started 4-path 重做：旧单页拆为 hub + `getting-started/react.md` / `getting-started/react-native.md` / `getting-started/nextjs.md` / `getting-started/node.md`；每篇 Prerequisites / Install / Configure / Capture first error / View on dashboard / Next steps 6 段；docs build 13 → 17 page
- **sub-B** 5 分钟秒表实测：Vite + React 33s（npm registry sentori-react@0.3.0 整链路）/ Node.js (bun) 47s；Next.js + React Native defer 到 dogfood 时实测；`docs/dogfood/onboarding-times.md` 记数据；4 path docs 0 修订
- **sub-C** React 专区 5 篇深度 recipe：`recipes/state-management.md`（Redux/Zustand/TanStack Query + 4 capture-point 边界） / `recipes/suspense-rsc.md`（5 React 19 错误 surface 表）/ `recipes/sourcemap-upload.md`（GitHub Actions + GitLab CI + Vercel build hook 全 yml）/ `recipes/release-versioning.md`（4 平台 inject + semver regression 规则）/ `recipes/multi-environment.md`（single-token vs per-env tradeoff）；sidebar Recipes 组 3 → 8；docs build 17 → 22 page
- **sub-D** Troubleshooting：10 项 Q + Diagnose + Fix（dashboard 无事件 5 status code 表 / minified stack / dSYM uuid 不匹配 / token 401 hint 5 种 / webhook 签名 Node verify() / crash-free 0% / regression / hook 错误 / CI 慢 / dev 淹掉 dashboard）；sidebar Reference 组加入口；docs build 22 → 23 page
- **sub-E** Marketing hero copy：`marketing/src/pages/index.astro` h1 改 "Error tracking, built React-first."；sub-hero 强调 React 三件套 + 保留 platform-agnostic 立场；meta tags（OG/Twitter/title）同步；布局不动

### Phase 33 — Performance / scale 验真 ✅

5 sub 全完成：

- **sub-A** 1M event EXPLAIN baseline：走 SQL bulk INSERT 路径（HTTP 660 ev/s 太慢）20s 内 seed 1.02M events；5 query 合计 0.55ms → 1.24ms 在 200× 数据下 2.3× — sub-millisecond 预算完整；`docs/performance/baseline-v0.3-phase33.md`；`tools/seed-events.ts BATCH_SIZE 100 → 500`；deferred 索引仍不实施
- **sub-B** Cursor pagination + infinite scroll：`list_issues` 加 `cursor` query param + `X-Next-Cursor` response header（不破坏 JSON array body）；keyset 复合 `(last_seen, id)`；CORS expose_headers；`<IssuesView>` useInfiniteQuery + `<LoadMoreSentinel>` IntersectionObserver（300px rootMargin prefetch + button fallback）；react-window 不上（1k 行仍 OK）
- **sub-C** Ingest 压测：bun-native `tools/load-test.ts` open-loop scheduler；60s × 50 req/s × 4 endpoint = 3000 request；P99 12.6ms (events) / 33.5ms (batch) / 5.7ms (sessions) / 6.2ms (deploys)；**TOTAL P99 29.1ms，6.8× SLO headroom**，0 errors；10min staging 复跑 defer
- **sub-D** SDK offline / retry：RN SDK 4 个 retry test（5xx × 3 retry / NetworkError 中途恢复 / 4xx 不重试 / 双 flush 不双发）+ JS SDK 1 个 offline test（warn 一次不 crash 不重发）；54 SDK test 全绿；0 bug surfaced，不发 patch
- **sub-E** `docs/performance.md` baseline 汇总：9 个 headline 数字 + SLO target + headroom 倍数；3 个 detail doc 链接；regression policy（数字 +20% loose / plan-shape 变 tight）；`.github/PULL_REQUEST_TEMPLATE.md` 加 4 项 Reviewer checklist（performance / tests / docs / migrations）

---

## v0.2 — 账户结构 + SDK 矩阵 + 数据呈现（Phase 18-28）

三大板块按线性推进：**账户结构骨架**（Phase 18-20）—— org/team/project 三层 + RBAC + audit log；**SDK 矩阵 + 原生深度**（Phase 21-22）—— sdk/core 衍生 react/next/expo + iOS dSYM/Android proguard/ANR/Hang 完整化；**数据呈现**（Phase 23-28）—— Release 一等公民 + Issues 列表 power-user 化 + Issue 详情 revamp + Health/搜索/告警/Polish。

### Phase 18 — 账户结构深化（Org / Team / Project / Ownership / Audit）

**Goal:** 把扁平 "org + member/owner" 升级为 "org → team → project" 三层；加 ownership 转让 + audit log。

**Entry:** Phase 17 sub-G ✅。

**Exit:**
- 一个 org 可以有 N 个 team；team 有自己的成员集；project 多对多绑定到 team
- Project 操作受 ACL：user 必须是该 project 关联 team 的成员，**或** org-admin
- Owner 可发起转让；接收方点邮件链接确认才生效；事务原子
- 所有写操作（create/update/delete on org/team/project/membership/token）落 audit_logs，dashboard 设置页可查
- 邀请流支持 "邀请到 team X"，accept 时事务内同时插 membership + team_membership

**Estimate:** 2.5–3 周

#### Steps

##### sub-A — schema + migration ✅

- [x] 新表 `teams`(id uuid v7, org_id, slug, name, description, created_at)；UNIQUE(org_id, slug)
- [x] 新表 `team_memberships`(team_id, user_id, role: lead|member, created_at)；PK(team_id, user_id)（viewer 由 Phase 19 sub-A 加，一并和 org 级 viewer/billing_admin 落地）
- [x] 新表 `project_teams`(project_id, team_id)；PK(project_id, team_id)；级联 ON DELETE CASCADE
- [x] 新表 `audit_logs`(id uuid v7, org_id, actor_user_id, action text, target_type text, target_id uuid, payload jsonb, created_at)；INDEX(org_id, created_at DESC) + actor + target
- [x] 新表 `org_ownership_transfers`(id uuid v7, org_id, from_user_id, to_user_id, token text UNIQUE, expires_at, accepted_at NULL)
- [x] migration `server/migrations/0010_phase18_orgs.sql`，含外键 + 索引；本地 sentori-pg 应用通过；commit `5ec39d0`
- [ ] `cargo sqlx prepare`；提交 `.sqlx/`（推迟到 sub-B 写完 query 一并跑）

##### sub-B — server: Team CRUD + ACL middleware ✅

- [x] `server/src/api/teams.rs` 团队 CRUD + member CRUD：routes 在 `/api/orgs/{slug}/teams[/{team_slug}/...]`（不是 `/admin/api/...`，因为团队是 org 概念，复用既有 `require_user` 路由分组）
- [x] `server/src/api/teams.rs` 加 `list_team_projects / list_project_teams / assign_project_to_team / unassign_project_from_team`：project↔team 绑定 endpoints 在 `/admin/api/projects/{id}/teams[/{team_slug}]`（admin 路由，需要 owner/admin 角色）
- [ ] ~~`server/src/auth.rs`：`AuthCtx` 加 `team_ids_for_org(org_id) -> Vec<Uuid>` (Valkey 30s 缓存)~~ — 推迟；当前 inline 两条 query 简单且 dev 流量下零成本，等 Phase 23 perf 真有压力再上缓存
- [x] 拓展 `admin_auth::require_project_in_org`（不开新 extractor）：未绑团队 → 任意 org 成员通过；绑了团队 → 必须在某关联 team 中 OR org owner/admin
- [x] `projects.rs / tokens.rs / issue endpoints` 已经全部走 admin 路由，自动被改造后的 middleware 覆盖
- [x] tests：`server/tests/teams.rs` 两个 case：(1) owner 建 team 200 / plain member 建 team 403 / member 给自己加 team 403；(2) 绑团队后 in-team 成员 200 / out-of-team 成员 403 / owner 200。本地 sentori-pg `cargo test` 全 12 个测试 pass。commit `4398d4b`

##### sub-C — server: Ownership transfer + audit log ✅

- [x] `audit::record(pool, org_id, actor, action, target_type, target_id, payload)` helper：`server/src/audit.rs`，含 actions / targets 字符串常量；写失败仅 log 不阻塞业务路径
- [x] mutating endpoint 接 `audit::record`：org create / patch, member role / remove, team create / delete / member-add / member-remove, project create, project↔team bind / unbind, token create / revoke, transfer requested / accepted；team patch / team-member patch / invite create-delete 留给 Phase 20 sub-A 一并扫
- [x] `POST /api/orgs/{slug}/transfer`：owner only，body `{toUserId}`，target 必须当前是 admin/owner；写 `org_ownership_transfers` + 发邮件 + audit
- [x] `POST /api/orgs/transfers/{token}/accept`：to_user 登录态；事务内 swap role + 镜像 `orgs.owner_id` + 标 accepted_at
- [x] `notifier::OwnershipTransferRequested` 邮件模板（7-day confirm link）
- [x] `GET /api/orgs/{slug}/audit?limit=&before=&action=&actorUserId=&targetType=`：owner/admin only，DESC by created_at，joined users.email 显示 actor
- [x] 注：`org.deleted` 因 FK cascade 落不下 audit 行，改 emit 一条 tracing log；Phase 20 sub-A 把 audit_logs 移出 cascade
- [x] tests：(1) happy path：role swap / owner_id 镜像 / replay 拒绝 / 错误 caller 403；(2) 非 eligible target / 非 org 用户 / 非 owner caller 全拒；(3) audit list owner 200 + 含 org.created + team.created / member 403 / `?action=team.created` 过滤生效；本地 sentori-pg `cargo test` 全 17 个 pass。commit `1fc9bc9`

##### sub-D — dashboard: Team 管理 UI ✅

- [x] `web/src/views/team-list.tsx`：路由 `/org/{slug}/teams`，含 admin/owner 创建表单（slug + name + description）+ 团队列表 + 删除按钮（带 confirm 警告"删除后项目权限会回到全 org 开放"）
- [x] `web/src/views/team-detail.tsx`：路由 `/org/{slug}/teams/{teamSlug}`，两段：Members（dropdown 加成员 / 行内换 role / 删除）+ Projects（dropdown 绑项目 / 按钮解绑），plain member 只读
- [x] `web/src/api/client.ts` 增 `teamsApi`（list/create/get/patch/delete/listMembers/addMember/patchMember/removeMember/listProjects/listProjectTeams/bindProject/unbindProject）+ `auditApi.list` + `transfersApi.{create,accept}`
- [x] `OrgLayout.NAV` 加 `Teams` 项夹在 Issues 和 Settings 之间
- [ ] ~~`OrgSwitcher` 改两层：`Org > Team`；选 team 后 issues 列表自动 filter~~ — 推迟到 sub-E 跟 role chip / permission gate UI 一起做。`bun run build` + `bun run test` 全绿；commit `78defab`

##### sub-E — dashboard: Project ↔ Team 绑定 + 角色 chip ✅

- [x] 新视图 `web/src/views/project-team-settings.tsx`，路由 `/org/{slug}/projects/{id}/settings/teams`：列出 org 内所有 team，admin 单击 Bind/Unbind 即可绑定；普通成员看到 Bound/Not bound chip；headline 文案根据是否有绑定切换"全 org 开放" vs "team-scoped"；token-settings + recipient-settings 加交叉链接
- [x] org-settings members 表行内显示用户所属 team-slug chip（`useQueries` N 并发拉每 team 的成员，client-side 聚合，1-10 团队规模零成本）
- [x] `web/src/components/RoleBadge.tsx`：颜色编码 chip（owner=emerald / admin=accent / lead=amber / member=neutral）；用在 org-settings 和 team-detail
- [x] 权限层：`auth/permissions.ts` 定义 `PermissionAction` enum + role matrix；`auth/useHasPermission.ts` 钩子；`components/PermissionGate.tsx` 包按钮；server 仍是 authz 真理来源，UI 只决定"按钮渲不渲染"
- [x] OrgSwitcher 两层 `Org / Team` 下拉；选 team 写 `?team=<slug>` 到 URL；`OrgLayout` 读取后并发查每个 project 的团队绑定，把 `currentProjects` 缩到匹配集；`OrgCtx` 加 `currentTeamSlug` + `teams[]`
- [x] bun run build → 123 KB gzip / bun run test green / tsc clean。commit `5fcd2cf`

##### sub-F — Invite 流扩展 ✅

- [x] migration `0011_invite_team.sql`：`org_invites` 加 nullable `team_id` FK ON DELETE SET NULL（团队删除不毁邀请）
- [x] `CreateInviteBody.teamSlug` 可选 camelCase；服务端验证 team 存在于该 org，否则 400 `teamNotFound`
- [x] `accept_invite` 事务内同时 insert `memberships` + `team_memberships`（role=member）；team 中途被删则 team_id 已 SET NULL，邀请仍可接受退化为只入 org
- [x] `list_invites` / `export_org` 返回 `teamSlug`（LEFT JOIN teams）；前端 `InviteRow` 类型同步加字段
- [x] dashboard：org-settings invite 表单条件渲染 "team" dropdown（仅当 org 有团队时出现）；待接受邀请列表行内显示 team-slug chip；`orgsApi.createInvite(slug, email, role, teamSlug?)` 第四参可选
- [x] tests：(1) `invite_with_team_attaches_user_to_team` 端到端：bad slug 400 / list 含 teamSlug / accept 后 org+team 双成员均落库；(2) `invite_with_dropped_team_falls_back_to_org_only`：邀请发出后删 team，accept 仍 200，仅落 org 成员。全 19 server tests + dashboard build 通过。commit `7bbd9ff`

##### sub-G — Ownership transfer UX ✅

- [x] org-settings owner-only `<TransferOwnershipSection>`：danger 虚线边框 + 选 admin-eligible member（排除 self）+ 必须输入 org slug 二次确认才能 enable submit；空状态提示先把成员升级到 admin
- [x] 新视图 `web/src/views/transfer-accept.tsx`，路由 `/transfers/:token`（直接走根，不用 `/orgs/{slug}/...` 包，匹配邮件 link `{base_url}/transfers/{token}` 形态）；server 错误码 `transferUsed/Expired/forbidden/transferNotFound` 映射人话
- [x] 未登录访问该路径自动 `/login?next=/transfers/<token>` bounce 回来
- [x] 接受后 navigate('/')，让 OrgLayout 重新加载 orgs（角色已变）；msg-only toast 替代旧 owner 端 UI 通知
- [x] server `NotifyEvent::OwnershipTransferCompleted` 邮件模板 + `accept_transfer` 在事务 commit 后发邮件给老 owner（查 user email + org name）；安抚文案明示 demoted to admin、可联系 support 如非本人操作
- [x] bun run build → 124 KB gzip / tsc clean / server 19/19。commit `0cab6c9`

##### sub-H — Audit log viewer ✅

- [x] 新视图 `web/src/views/audit-log.tsx`，路由 `/org/{slug}/audit`，owner/admin only（普通成员看到"permission denied"一行）；OrgLayout NAV 加 `adminOnly` flag 把 "Audit" 项 gating
- [x] 表格：time / actor (email or "system") / action / target_type+id / payload（Show/Hide 折叠 JSON，empty 显 —）
- [x] filter bar：action select（硬编码 17 个动作，注释指向 Phase 20 sub-A 替换为 codegen）+ actor select（拉 listMembers）+ datetime-local before；任一 filter 激活时显示 "Clear filters"
- [x] cursor 分页：底部 "Load older →" 用最旧 row 的 createdAt 推 `before` cursor（匹配服务端 DESC + before 语义）
- [x] CSV 导出：当前可见集，header 含 timestamp/actor/action/target_type/target_id/payload，正确 escape 逗号/引号/换行
- [x] bun run build → 125.8 KB gzip；tsc + test green。commit `65f100b`

##### sub-I — tests + docs + 收尾 ✅

- [x] `server/tests/teams_acl_matrix.rs`：4 角色 × 6 端点的状态码矩阵（owner/admin/member/non-member × create_team/patch_team/delete_team/list_teams/add_team_member/project_bind）+ no_session 401。每个 case 用独立 fixture（uuid 后缀防并行 slug 碰撞）；7 个新测试，全 server suite 32/32 pass
- [x] `web/playwright.config.ts` + `web/e2e/teams.spec.ts`：webServer 自动 spawn `cargo run` + `vite dev`；spec 走 register/verify via API（暂用 `docker exec sentori-pg psql` 取 verify token，注释指明 CI 化时换 `/dev/last-verify-token` endpoint）+ UI login 验 cookie/redirect + 后续 invite-with-team 自动 accept 流。运行 ~2s / 1 test pass。`bun run test:e2e` 触发
- [x] `vite.config.ts` proxy 加 `/api`（之前只 `/admin/api`）—— dev 与 Caddy 生产配置对齐；不再需要 vite 前手动 fronting proxy
- [x] `docs-site/src/content/docs/teams.md` 1500+ 字纯文字写法指南（无截图，留 Phase 28 polish）：vocab 段、何时用 team、create/bind/invite/transfer/audit 流；sidebar 加 "Teams & ownership" 项
- [x] `web/.gitignore` 加 `test-results / playwright-report / playwright/.cache`
- [x] commit `5fe1025` + `c3c8d1e` 推 main

---

### Phase 19 — RBAC 全栈完善 ✅

**Goal:** 把 Phase 18 的 role 列字段做成完整的 permission matrix；server endpoint 标 min role；dashboard 全 button role-aware。

**Entry:** Phase 18 ✅

**Exit:**
- Role 矩阵：`owner / admin / member / viewer`（billing_admin 推迟到 Phase 27 一并）
- 服务端所有 endpoint 已经在 inline check 里强制；新加 viewer 路径 403 全 cover；test matrix 验
- dashboard 大部分 mutating button 走 `useHasPermission()`；剩下用 inline `canManage` 已重命名为 hook 调用
- 角色升降级 UI 落地（仅 admin↔member↔viewer，owner 仅走 transfer）

**Estimate:** 1.5 周（实际 1 session）

#### Steps

##### sub-A — Role 字段拓展 ✅
- [x] migration `0012_viewer_role.sql`：DROP + ADD CONSTRAINT 替换 `memberships.role` / `team_memberships.role` / `org_invites.role` 的 CHECK，加入 `viewer`
- [x] billing_admin **不**加：Phase 27 alerting/billing 落地时一并，避免空角色
- [x] 本地 sentori-pg 应用 + `\d` 三表确认

##### sub-B — server-side viewer enforcement ✅
- [x] 新模块 `server/src/roles.rs`：`OrgRole` / `TeamRole` enum (serde rename_all=lowercase) + `can_manage_org()` 谓词；常量 `VALID_INVITE_ROLES` / `VALID_MEMBER_PATCH_ROLES` / `VALID_TEAM_ROLES`（owner 被排除：仅 transfer 流程可达）
- [x] `orgs.rs::create_invite` 改用 `VALID_INVITE_ROLES`；之前的 "cannotInviteAsOwner" 特殊错误码并入 `invalidRole`
- [x] `orgs.rs::patch_member` 改用 `VALID_MEMBER_PATCH_ROLES`；任何 PATCH 到 owner 直接 400
- [x] `teams.rs` `VALID_TEAM_ROLES` 替换为 `roles::VALID_TEAM_ROLES`
- [x] `~~auth::Role enum + RequireRole extractor + 全端点重构~~` —— 推迟。当前 inline `matches!(role, "owner" | "admin")` 模式已经在 admin/owner 二选一上工作；新增 viewer 走同样路径自然 403。把 36 个端点全 refactor 成 extractor 是 Phase 28 polish 的事
- [x] 新 `tests/viewer_acl.rs`：6 个 reads 200 + 6 个 writes 403 + PATCH-to-owner 400 + viewer→admin 200。全 server 36/36 pass

##### sub-C — `useHasPermission` 全 dashboard 走查 ✅
- [x] `OrgRole` / `TeamRole` 类型加 `viewer` 字面量
- [x] `RoleBadge` 加 viewer style（bg-bg-tertiary 中性灰）
- [x] `team-list.tsx` / `team-detail.tsx` / `org-settings.tsx` 把 `canManage = role === 'owner' || 'admin'` 改成 `useHasPermission('team.manage' / 'team.member.manage' / 'org.manage')`
- [x] `OrgLayout` 头部 user email 旁加 `<RoleBadge role={currentOrg.role} />` —— 当前 role 永远可见
- [x] permissions.ts 已在 Phase 18 sub-E 落，role matrix 自然包含 viewer（默认 false 任何 mutating action）

##### sub-D — Role 升降级 UI ✅
- [x] org-settings member 行 `<select>`：admin/member/viewer（**owner 不在选项里** —— 只能走 ownership transfer）
- [x] 仅 owner-self 排除 + 当前行 role !== 'owner'  才渲染 select；owner 行恒为 RoleBadge
- [x] `onChange` 加 `confirm()`：明示老角色→新角色再 mutate；取消则不发 mutate（select 视觉残留下次 refetch 自动校正）
- [x] vite.config.ts test exclude `e2e/**`：playwright spec 不再被 vitest 误吃，单元/e2e 干净分流
- [x] `web/src/views/team-detail.tsx` 已有 role select，逻辑一致；本 sub 没动它（lead/member/viewer 三态足以），confirm 升级看 sub-E 是否需要

server 36/36 + dashboard build 126 KB gzip + vitest 1/1 + e2e 1/1。commit `4147a2a`

---

### Phase 20 — Audit log 深化 + 全局活动 feed ✅

**Goal:** Phase 18 已落 audit_logs；这阶段把它做成可观察的产品功能（不是只查日志）。

**Entry:** Phase 19 ✅

**Exit:**
- Audit log 全 action 字符串集中在 `audit::all_labels`；dashboard 从 `/api/audit/actions` 拉而非硬编码
- Per-user "我做的事" feed `/me/activity`；含 tombstoned org（org_id NULL → "deleted org"）
- Org 内 audit log（已在 Phase 18 sub-H 做完）
- Webhook payload schema 已在 `docs/protocol.md` + docs-site 同步落定，等 Phase 27 实现 delivery + signing

**Estimate:** 1 周（实际 1 session）

#### Steps

##### sub-A — Audit i18n + tombstone ✅
- [x] migration `0013_audit_tombstone.sql`：`audit_logs.org_id` 改 nullable + FK SET NULL；删 org 后 audit 行保留，org_id 自动 null
- [x] `delete_org` 在 DELETE 之前先 record audit 行，payload 含 slug + name；cascade 之后 org_id 自动变 NULL
- [x] `audit::label_for(action) -> &str` + `audit::all_labels() -> Vec<(code, label)>`：英文 i18n 标签（未来加 locale 表）
- [x] 新端点 `GET /api/audit/actions`：dashboard 拉 catalog 而非硬编码
- [x] `audit-log.tsx` 用 `auditApi.actions()` 替代 `ACTION_OPTIONS` 常量

##### sub-B — Dashboard audit log 页（已在 Phase 18 sub-H 落地，本阶段仅 catalog 接入升级）
- [x] sub-H 已做：actor / action / target / time + 折叠 JSON payload + filter + cursor 分页 + CSV 导出
- [x] 本阶段：action filter 改用 `auditApi.actions()` 动态 catalog

##### sub-C — Per-user activity feed ✅
- [x] `GET /api/users/me/activity?limit=&before=`：actor=caller across 所有 orgs，LEFT JOIN orgs 让 tombstoned 行也出现
- [x] 视图 `web/src/views/user-activity.tsx`，路由 `/me/activity`：时间轴样式，每条带 org link 或 "deleted org" 斜体
- [x] OrgLayout 头部 user-email chip 改成 `<Link to="/me/activity">` 入口

##### sub-D — Webhook payload schema 落定（Phase 27 实现）✅
- [x] `docs/protocol.md` + `docs-site/src/content/docs/protocol.md` 加 "Audit-event webhook payload (forward-looking, Phase 27)" 段
- [x] 锁定 headers（含 `sentori-signature: t=<unix>,v1=<hmac-sha256>` 5min anti-replay + v2 rotation lane）+ body（含 actor / org / target / payload）+ per-action required keys 表 + retry 1m/5m/30m/2h x6 + dedup by uuid v7
- [x] 文档版本号 `v0.1`

##### sub-E — CSV 导出 + tests（已在 Phase 18 sub-H + Phase 20 测试中覆盖）✅
- [x] CSV 导出：sub-H 已做（quoted, escaped）
- [x] 新 `tests/user_activity.rs` 3 个 test：catalog endpoint / activity feed 含 org slug / tombstone-after-delete 仍可见
- [x] server 39/39 + dashboard build 126 KB gzip + vitest 1/1 + e2e 1/1。commit `1c47429` + `cca4814`

---

### Phase 21 — SDK monorepo 抽 core + JS 矩阵扩展

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

#### Steps

##### sub-A — 抽 `sdk/core/` ✅
- [x] 新 workspace package `@goliapkg/sentori-core@0.1.0`：types / uuid / breadcrumbs (+ BreadcrumbBuffer class) / stack (含 shortFilenames opt-in) / index re-exports
- [x] **保留** transport / capture / config / init 在各 SDK 内部 —— 这些含 platform-specific 行为（fetch vs sendBeacon, RN AsyncStorage offline queue, native module bridge），强行抽进 core 会破语义
- [x] root `package.json` 加 bun workspaces；`sdk/core` 依赖图先于 js/rn install
- [x] `sdk/javascript@0.2.0`：types/uuid/breadcrumbs/stack 退化为 re-export shim；object-form `addBreadcrumb({ type, data })` 公开 API 不变；**bug fix 顺路落**：`detectDevice()` 之前发 `os: 'macos' | 'windows' | 'unknown'` 全被服务端 `validationFailed` 静默拒绝，现在按 protocol 收紧到 `web | other`，OS 细节走 `model`
- [x] `sdk/react-native@0.2.0`：同 shim 模式；保留 long path（Hermes 路径已经短，native symbolication 需要绝对路径）；`addBreadcrumb` timestamp override 用 private shadow buffer 兜底
- [x] core 11 tests + js 8 + rn 18 = 37 SDK tests 全绿
- [x] npm publish 全 3 包：core 0.1.0 / javascript 0.2.0 / react-native 0.2.0。commit `59f13f4` + `4c94d8d`

##### sub-B — `@goliapkg/sentori-react` ✅
- [x] 新 `sdk/react/` workspace；deps `@goliapkg/sentori-core@0.1.0` + `@goliapkg/sentori-javascript@0.2.0`；peer `react>=18`
- [x] `<SentoriProvider config={...}>`：one-shot init via ref（StrictMode double-mount 安全）；提供 context；misconfig 走 console.error 不炸树
- [x] `<SentoriErrorBoundary fallback={({ error, reset }) => ...}>`：React 19 class component；`componentDidCatch` 调 captureError 加 `tags.source = 'react.errorBoundary'`；fallback 收 `reset` callback；可选 `onError` hook 给二级 logger
- [x] `useSentori()` 返回完整 context（capture / setUser / setTags / addBreadcrumb / initialised）；`useCaptureError(fn, extras?)` async 包装捕错 + rethrow，保留调用者 try/catch 语义
- [x] provider-scoped `setTags(tags)` 合并到 per-call extras（per-call wins 冲突）—— 同 Sentry precedence
- [x] tests：4 个 case 跑 happy-dom + bunfig preload，fetch + sendBeacon 全 stub；`bun run build` + `bun test` 全绿
- [x] npm publish `@goliapkg/sentori-react@0.1.0`；commit `390bdf7`

##### sub-C — `@goliapkg/sentori-next` ✅
- [x] 新 `sdk/next/` workspace；3 个 sub-path exports：`/client` / `/server` / `/instrumentation`；deps `core@0.1.0 + javascript@0.2.0 + react@0.1.0`；peer `next>=14, react>=18`
- [x] `clientInit(cfg?)`：浏览器侧 idempotent init；从 `NEXT_PUBLIC_SENTORI_*` 读 env；React Refresh / fast-reload 不重复注册
- [x] `serverInit(cfg?)`：node 侧 idempotent init；guard `NEXT_RUNTIME==='nodejs'` 避免 edge runtime 拉 Node deps
- [x] `onRequestError(err, req, ctx)`：匹配 Next 15 instrumentation.ts:onRequestError 签名；自动加 `next.method / next.route / next.routeType / next.runtime / source=next.requestError` tags
- [x] `/instrumentation` 一行 drop-in：`export { register, onRequestError } from '@goliapkg/sentori-next/instrumentation'`
- [x] env 解析 `src/config.ts`：client 只看 NEXT_PUBLIC_SENTORI_*；server 优先 SENTORI_*，缺时 fallback NEXT_PUBLIC_*；显式 cfg 字段 always wins；缺必填字段 throw 含具体 env 名
- [x] `~~withSentori(nextConfig)~~` —— 不实现：现阶段 nextConfig 不需要 webpack plugin（无 source map upload、无 build-time codegen）；Phase 22 接 sourcemap upload 时再加
- [x] tests：9 个 case（config matrix + onRequestError 三场景 + non-Error wrap）；`bun test` 全绿
- [x] README：4 个文件（instrumentation.ts / app/layout.tsx / app/error.tsx / app/global-error.tsx）copy-paste-ready
- [x] npm publish `@goliapkg/sentori-next@0.1.0`；commit `0432d58`

##### sub-D — `@goliapkg/sentori-expo` ✅
- [x] 新 `sdk/expo/` workspace；peer `expo>=50, expo-application>=5 (optional), react-native>=0.74, sentori-react-native>=0.2.0`
- [x] `app.plugin.js` CommonJS Config Plugin：marker + withInfoPlist 写 SentoriSdkVersion；native autolink 由 RN SDK 自带的 expo-module.config.json/podspec/gradle 解决，plugin 留作未来扩展点
- [x] `initSentoriExpo({ token, application?, release?, environment?, ingestUrl? })`：用户传 `import * as Application from 'expo-application'`（避免本包硬依赖 expo-application）；自动派生 `applicationId@version+build`；`__DEV__` 决定 environment；fallback 到 public ingest
- [x] `deriveRelease(app)` 单独 export 给非 init 场景（tag / log prefix）
- [x] `scripts/eas-post-build.mjs`：EAS postPublish hook，shell 调 `@goliapkg/sentori-cli upload sourcemap`；CLI 未装时友好 warn + exit 0（Phase 22 sub-A 落 sourcemap subcommand 后自动接通）
- [x] 4 tests：full / partial / missing / null fields；`bun test` 全绿
- [x] README copy-paste 三步：app.json + App.tsx + eas.json
- [x] npm publish `@goliapkg/sentori-expo@0.1.0`；commit `e2340c3`

##### sub-E — Vue / Svelte 设计文档（不实现）✅
- [x] `docs-site/src/content/docs/sdk-vue.md`：`@goliapkg/sentori-vue` 草案 —— `sentoriPlugin` for `app.use()`, `useSentori` / `useCaptureError` composables, `<SentoriErrorBoundary>` via `errorCaptured` 生命周期；附 Nuxt 3 module / Pinia / vue-router 集成路线
- [x] `docs-site/src/content/docs/sdk-svelte.md`：`@goliapkg/sentori-svelte` 草案 —— Svelte 5 + runes 目标；boundary 组件用 snippet API；SvelteKit `/sveltekit-server` + `/sveltekit-client` `handleError` 子路径
- [x] sidebar 加 "SDK — Vue (planned)" + "SDK — Svelte (planned)"，文档顶部明示 v0.3+
- [x] docs-site build → 9 pages

##### sub-F — onboarding wizard 多 SDK ✅
- [x] `SdkChoice` 从 2 选 → 5 选：`react / next / expo / react-native / javascript`
- [x] 默认 SDK 从 `react-native` 改为 `react`（最常见上手）
- [x] 布局从 flex 改 `grid grid-cols-2 sm:grid-cols-3` 让窄宽下标签仍可读
- [x] 5 段 install + init snippet 全部 copy-paste-ready：
  - React → `<SentoriProvider>` 包根
  - Next → `instrumentation.ts` + `.env.local` + `clientInit()`
  - Expo → `app.json plugins` + `initSentoriExpo({ application })`
  - RN → `initSentori`
  - JS → `initSentori`（browser/node 同 import）
- [x] dashboard build 126.9 KB gzip / vitest 1/1 / e2e 1/1。commit `eb53b37`

---

### Phase 22 — 原生层深化（iOS dSYM / Android Proguard / ANR / Hang）

**Goal:** native crash 端到端：上传 mapping → 服务端反符号化 → dashboard 显示原始位置 + ANR / hang 检测。

**Entry:** Phase 21 ✅

**Exit:**
- iOS dSYM 上传 + 服务端 atos 解析；dashboard issue 详情 frame 行显示原始 file:line
- Android Proguard mapping 上传 + retrace；同上
- Android ANR detection（5s main thread block）
- iOS hang detection（best-effort，runloop 阻塞 ≥ 2s）
- mapping/dSYM 按 release 串绑

**Estimate:** 2.5 周

#### Steps

##### sub-A — CLI: dSYM 上传 ✅
- [x] migration `0014_dsyms.sql`：(id, project_id, release nullable, debug_id, arch, object_name, size_bytes, data bytea, uploaded_by, uploaded_at)；UNIQUE(project_id, debug_id, arch) + 列表索引
- [x] 服务端 `POST /admin/api/projects/{id}/dsyms`：raw octet-stream + headers (`x-sentori-debug-id`, `x-sentori-arch`) + query (`release`, `objectName`)；ON CONFLICT DO UPDATE 幂等；max 256 MB；audit `dsym.uploaded`
- [x] 服务端 `GET /admin/api/projects/{id}/dsyms?release=&limit=` 列出（含上传者 email）
- [x] router 每路由 `DefaultBodyLimit::disable()` + 256 MB 限制 for `/dsyms` and `/sourcemaps`，不被 protocol 1 MB 全局限制锁住
- [x] `cli/src/dsym.rs` Mach-O 解析（`object` crate）：单 / fat32 / fat64；提 LC_UUID + cputype/cpusubtype；fat 切片 byte-level；arch 表：arm64 / arm64e / arm64_32 / armv7 / armv7s / armv7k / x86_64 / x86_64h / i386
- [x] `sentori-cli upload dsym --project=<uuid> [--release] [--token] [--api-url] <paths>`：token fallback `SENTORI_ADMIN_TOKEN → SENTORI_TOKEN`；api-url fallback `SENTORI_ADMIN_URL → INGEST_URL replace ingest.→api. → public api`
- [x] tests：3 个 case（happy + idempotent / 坏 headers + 空 body + arch 白名单 / 跨 org 403）；并修 fixture 时间戳并行碰撞 bug；server 42/42 全绿
- [x] dashboard release 详情显示 dSYM 列表 —— 推迟到 Phase 23（Release UX 主轴），server 端已就位
- [x] commit `8e1b71a`

##### sub-B — server: iOS 反符号化 ✅
- [x] **不**用 atos（macOS-only）：用 pure-Rust `addr2line` + `gimli` + `object` —— Linux 生产服务器原生工作；deps 加到 server/Cargo.toml
- [x] 新模块 `server/src/symbolicate_ios.rs`：按 `(project_id, debug_id, arch)` 查 dsyms 表，从 fat blob 提对应 arch 的 slice，dump 到 `SENTORI_DSYM_CACHE_DIR`（默认 `/tmp/sentori-dsyms`）；`Loader::new(path)` 内存映射 + DWARF 解析；resolve `instructionAddress - imageAddress`
- [x] 协议扩展：`docs/protocol.md` + docs-site 加 4 个 native 帧字段（`debugId`, `arch`, `instructionAddress`, `imageAddress`）；解释 server 命中后会重写 `function/file/line/inApp` 同时保留 native 字段供后续重符号化
- [x] cache：`(project_id, debug_id, arch) → dumped path` map，200 条上限 wholesale eviction；tmpfs 让重 mmap 廉价；`Loader` 本身不缓存（lifetime 复杂，重开销可忽略）
- [x] 接入既有 symbolicate_payload pass（admin.rs `list_events_for_issue`）：JS sourcemap 先走（RN 桥帧通常在顶端），iOS DWARF 后走（native 帧底层）；两 pass 对不识别的帧 no-op
- [x] tests：3 个 unit（parse_addr 各形态 / normalise dashed+bare / 非 32-hex fallback）+ 不破坏 31 集成 = 13 unit + 31 integration = **44 server tests** 全绿
- [x] 真实 DWARF 端到端测试推迟到 sub-F（release-aware）—— 需要 checked-in 迷你 Mach-O fixture
- [x] commit `6fe7139`

##### sub-C — CLI + server: Android proguard ✅
- [x] migration `0015_proguard_mappings.sql`：(id, project_id, release, debug_id, size_bytes, data, uploaded_by, uploaded_at)；按 (project, debug_id) 和 (project, release, time) 索引
- [x] `POST /admin/api/projects/{id}/mappings` 与 `GET ...` —— raw octet-stream，optional `?release=` + `x-sentori-debug-id`；服务端从 mapping header sniff `# pg_map_id:`；每次 insert 新行，per-build 历史保留
- [x] `sentori-cli upload mapping --project=<uuid> [--release] [--token] [--api-url] <path>`：env fallback chain 同 dsym
- [x] `server/src/symbolicate_android.rs`：用 getsentry `proguard@5.10` crate 的 `ProguardMapper::new(ProguardMapping)` retrace；按 frame.debugId 优先 / fallback 到 release；只动 function 含 `.` 的帧，JS 帧自然 no-op；50-entry cache
- [x] `admin.rs`: 第三道 symbolicate pass（JS sourcemap → iOS DWARF → Android proguard），每 pass 对不属于自己的帧 no-op
- [x] tests：integration 2（sniff debug_id + list / 空 body 400），unit 1（proguard crate sample 解析回原 class.method）
- [x] server suite 14 unit + 31 integration = **45 server tests** 全绿；CLI `upload --help` 列出第三个子命令 `mapping`
- [x] commit `e3eca45`

##### sub-D — Android ANR detection ✅
- [x] `SentoriAnrWatchdog.kt`：worker thread post tick / 5 s timeout / 单次报告（防止抖屏期间洪水）/ daemon 不阻塞退出 / debug-build 默认关（避免 Metro debugger 暂停 main 引发误报）；写盘到既有 pending dir 复用 drain 流
- [x] `SentoriModule.kt` 加 `startAnrWatchdog({ timeoutMs?, intervalMs?, force? })` + `stopAnrWatchdog()`；JS opt-in 让 host 选时机
- [x] `sdk/react-native@0.3.0`：`native.ts` 类型 + index 出口；wire 完成
- [x] EventKind 加 `'anr'`：`sdk/core@0.2.0` types + server `event::EventKind`；wire-format 加性，receiver 未识别按 `error` 处理
- [x] dashboard `issues.tsx`：行内 amber `ANR` chip（`errorType === 'ApplicationNotResponding'`）+ 顶部 `ANR` 过滤按钮（pressed 时仅显示 ANR 行）；不破 IssueRow schema
- [x] docs/protocol.md + docs-site kind 行更新；server 14 unit + 31 integration 全绿；core 11 + rn 18 SDK tests 全绿
- [x] npm publish core 0.2.0 + react-native 0.3.0；commit `b02b7bb`

##### sub-E — iOS hang detection ✅
- [x] `SentoriHangWatchdog.swift`：DispatchSourceTimer 后台 queue 每 1s post 到 main，未 ack ≥ 2s 即报；single-shot per hang；`#if DEBUG` 默认关；写盘到既有 pending dir
- [x] `SentoriModule.swift` 加 `Function("startAnrWatchdog")` + `stopAnrWatchdog`，**和 Android 共用同一 JS 函数名** —— host 一行 `startAnrWatchdog()` 双平台开
- [x] 复用 `kind = "anr"`（不另开 `"hang"` —— dashboard ANR badge 已 work；区分靠 `tags.source = sentori.hangWatchdog`）
- [x] iOS 2s/1s vs Android 5s/1s 默认：iOS 没有等价系统级 ANR 信号，更严格捕短 stutter；Android 跟系统 5s 一致
- [x] **Caveat**：Thread.callStackSymbols 只回 caller-thread 栈；watchdog 在 background queue 上跑，跨线程取 main 真实栈需要 Mach API（thread_state_t / vmread）—— App Store review 容易判 reject。今天 capture 是 watchdog timing path 栈，sub-F 或后续 phase 上 proper main-thread sampler
- [x] `native.ts` 类型 + JS export 已是 sub-D 留下的 `startAnrWatchdog`；本 sub 仅文档区分双平台 default
- [x] `sdk/react-native@0.3.1` 发到 npm；commit `601066a` + `dfc3a5d`

##### sub-F — release-aware symbolication ✅
- [x] dSYM / proguard mapping 已经按 release 串绑（sub-A + sub-C 的 schema 都有 `release` 列；CLI 上传时 `--release` 写入；可空表示"未明确归属"）
- [x] **新端点** `GET /admin/api/projects/{id}/releases/{name}/artifacts`：统一返回 `{release, sourcemaps, dsyms, mappings}`；JOIN 三张源（dsyms / proguard_mappings / release_artifacts via releases）按 release 过滤
- [x] dashboard issue-detail 加 `<ReleaseArtifactsPanel>`：显示 sourcemap 文件数 + iOS dSYM slice 数（带 arch 列表）+ ProGuard mapping 大小；零上传时不渲染
- [x] ServerEvent.kind 类型从 `'error'` 拓到 `'anr' | 'error'`（同步 sub-D 服务端 EventKind 拓宽）
- [x] **不**做"symbolicate 拒跨 release lookup" —— 原 roadmap 措辞误判：debug_id 在每次构建是唯一的，retracer 应该按 debug_id 匹配；release 列是元数据。强行 release 隔离会让 downgrade / re-symbolicate 旧 release 失败。保留现状：debug_id 优先 + release fallback
- [x] 新 integration test `release_artifacts_unifies_dsym_and_mapping`：上传一个 dSYM + 一个 mapping 同 release，端点返回两者；其他 release 返全 0
- [x] **iOS 真主线程采样器推迟到 v0.3**：sub-E 留下的 caveat 要求 Mach API（thread_state_t / vmread）+ 谨慎处理 App Store 审核，独立 phase 更合理
- [x] server 14 unit + 32 integration = **46 server tests** 全绿；dashboard build 127.5 KB gzip；commit `d507c21`

---

### Phase 23 — Release 管理 UX

**Goal:** Release 一等公民。Dashboard 有 Releases 列表 + 详情；deploy webhook + regression detection。

**Entry:** Phase 22 ✅

**Exit:**
- Releases 列表页（每 release 卡片：版本 / env / source map / dSYM / 首末次见 / regressions）
- Release 详情页（uploaded artifacts 树 + event timeline + 比较前一 release）
- `POST /v1/deploys` webhook + dashboard 显示 deploy timeline
- Regression detection（issue 已 resolved 然后 release X 后又出现 → 标 regression）
- Compare-releases 视图（diff issues：新出 / 修了 / 仍存）

**Estimate:** 1.5 周

#### Steps
- [x] **sub-A**：`releases` 表 schema 加 `deploy_at`（migration 0016，回填到 `created_at`）；新端点 `GET /admin/api/projects/{id}/releases` 返回每个 release 的 event_count + first/last_seen + sourcemap/dsym/mapping count（live JOIN，预期 ≤ 1k releases/project）；dashboard 路由 `/org/{slug}/releases` + `<ReleasesView>` 卡片列表（deploy 时间 / event 数 / 三种 artifact 上传数 muted-when-0 + first→last seen 行）；OrgLayout NAV 加 "Releases"；`adminApi.listReleases` + `ReleaseListRow` 类型；server tests 47/47 全绿；dashboard build 128 KB gzip。commit `85c941c`
- [x] **sub-B**：`/org/{slug}/releases/{name}` `<ReleaseDetailView>`，复用 sub-F 的 `release_artifacts` endpoint；三段（Source maps / iOS dSYMs / ProGuard mappings）的 divide-y 行列表，每行 identifier + size + 相对 uploadedAt + uploader email 截断；空段显示 copy-pasteable `sentori-cli upload …` 命令；releases 列表卡片包 `<Link>` 跳详情。dashboard 129 KB gzip。commit `d7d158f`
- [x] **sub-C**：`POST /v1/deploys` 端点（`server/src/api/deploys.rs`）走 `require_token` 中间件复用 ingest token；body `{release, environment?, deployedAt?}`，校验 release ≤ 200 / env ≤ 64；upsert `releases (project_id, name)` 行 + 设 `deploy_at = deployedAt ?? now()`；audit `release.deployed`（target type 同名）payload 含 `project_id / release / environment / deploy_at`，DevToken 跳过 audit（无 org）；`audit::actions::RELEASE_DEPLOYED` + `targets::RELEASE` 加进 catalog 让 dashboard filter 自动可见；webhook payload contracts 表加 `release.deployed` 行。3 个新 integration test（happy path / idempotent refresh / 错误输入）全绿，protocol.md + getting-started.md 加 CI 集成段（curl + GitHub Actions 示例）。protocol bumped to v0.1.1.
- [x] **sub-D**：regression 检测——`migration 0017`：`issues.status` CHECK 加 `'resolved' / 'regressed'`，加 `resolved_at / resolved_in_release / regressed_at / regressed_in_release` 4 列，加部分索引 `issues_resolved_idx WHERE status = 'resolved'` 让 cron 扫描 O(resolved 行数) 而不是全表。**On-event** 走 `issues::upsert_issue` 的 `ON CONFLICT UPDATE`：CASE WHEN 把 `resolved` 翻成 `regressed`、stamp `regressed_at = event.timestamp` 和 `regressed_in_release = event.release` —— 全在同一个 SQL，原子无 read-then-write 窗口；返回 `(issue_id, is_new, regressed)` 三元组让 events.rs 决定 fire `NewIssue` / `Regression` 通知。**Cron** `regression::spawn_sweeper` 每 5 分钟扫一次 `WHERE status='resolved' AND last_seen > resolved_at`，把上线前老数据 / 绕过 upsert 的写入兜底翻转。**Notifier** 加 `NotifyEvent::Regression` 变体走 `notification_recipients.on_regression = TRUE` 的收件人，邮件含 release。**Patch issue API** 允许 `'resolved'`（`'regressed'` 仍是自动态、不接受手 patch），`PATCH` 时同 SQL 用 CASE 标 `resolved_at = now()` / `resolved_in_release = last_release`；从 `resolved` 离开时清掉 `regressed_*` 标记防止下次回归被吃掉。**Metrics** 加 `sentori_issue_regressed_total` 计数器。**Dashboard** `IssueRow` type 加 4 列 + IssueStatus enum 拓到 5 态；`/issues` 页面 status 切换器加 `regressed / resolved` tab；行内 `regressed` 红色徽章带 release tooltip；hotkey `r` resolve 当前行（active / regressed → resolved）。3 个集成测试（on-event auto-flip、re-resolve 清标记、sweeper 兜底）+ build 129 KB gzip。
- [x] **sub-E**：compare-releases —— 新端点 `GET /admin/api/projects/{id}/releases/{base}/compare/{target}` 用一条 CTE-driven SQL 算两个 release 的 issue 集合差：CTE 各自跑 `SELECT DISTINCT issue_id FROM events WHERE release = $base/$target AND issue_id IS NOT NULL`，外层 LEFT JOIN issues 表 + CASE 分桶 `added / fixed / persisting`。返回结构 `{base, target, added[], fixed[], persisting[]}`，每行带 `bucket` 字段方便后续做 flat list；reject `base == target`（400 / 500）。Dashboard：路由 `/org/{slug}/releases/{target}/compare/{base}`、`<ReleaseCompareView>` 三段 list（红/绿/灰徽章 + 计数）每行链到 issue detail；`<ReleaseDetailView>` header 加 `Compare with…` 原生 select（拉 `listReleases` 缓存的所有 releases，剔自身）选了立刻 navigate。`adminApi.compareReleases` + `ReleaseCompareRow / ReleaseCompare` 类型；2 个集成测试（三桶分类正确 + 拒绝同一 release）；server 25/25 全绿，dashboard build 130 KB gzip。

**Phase 23 ✅** — Release 一等公民全部 5 个 sub 完成：deploy_at + 列表 / 详情 / deploy webhook / regression detection / compare 视图。下一步 Phase 24 Issues 列表 power-user 化。

---

### Phase 24 — Issues 列表 power-user 化

**Goal:** filter query 语法 + 列配置 + 保存视图 + 批量操作。

**Entry:** Phase 23 ✅

**Exit:**
- Query 语法（`errorType:TypeError environment:prod last:7d release:1.2.3 status:unresolved`）前后端共用 parser
- 列配置：show/hide errorType / count / lastSeen / env / release / assignee（localStorage 持久化）
- 保存视图：个人 + 共享 org/team 内
- Bulk select + bulk resolve / ignore / assign
- 密度切换 compact / cozy（应用到所有表格）

**Estimate:** 1.5 周

#### Steps
- [x] **sub-A**：query parser —— `web/src/lib/issue-query.ts` + 13 个 vitest 单测覆盖 grammar：`KEY:VALUE`（`errorType / error / env / environment / release / status / last`，alias 折叠），无前缀 token 累积成 `freeText`，`status:` 校验合法值，`last:Nm/Nh/Nd` 解析成 RFC 3339 `lastSeenAfter` ISO 时间戳，未识别 key 默默退化成 free-text（typo 友好）。Server `ListIssuesQuery` 加 `error_type` + `last_seen_after`（serde rfc3339 option），SQL WHERE 多两个 `($::TEXT IS NULL OR ...)` 守卫。`adminApi.listIssues` types 同步加两参。`<IssuesView>` 重做：去掉单独的 env / release 输入框，单一搜索框（28rem）+ token tooltip + warnings 横条；status tab 和 `status:` token 共存（token 优先）；free-text fallback 走客户端 `messageSample / errorType` substring。新 `formatIssueQuery` 帮 sub-C 的 saved view 复原 query 字符串。1 server integration test 验证 `errorType=` 和 `lastSeenAfter=` URL 参数收敛结果集。dashboard build 130.6 KB gzip。
- [x] **sub-B**：列配置 UI + localStorage 持久化 —— `web/src/lib/column-prefs.ts` 抽通用 hook：`ColumnDef[]`（id / label / defaultVisible）+ `useColumnPrefs(storageKey, defs)` 返回 `{visible: Set<id>, toggle, reset}`。Storage shape 用 `Record<id, boolean>`（不是 string[]）—— 加新列时新列默认按 `defaultVisible` 取值，不会因为旧 user 的 snapshot 没 mention 就被 hide（早期 string[] 设计 polarity 错）。Quota / 私密模式异常吃掉。`<IssuesView>` 接进来：errorType + Message 不可关，count / lastSeen / firstSeen / env / release 可切换；`firstSeen` 默认 hidden。Header 右侧加 `⋯` 列设置按钮，popover 三段（标题 + checkbox 列表 + Reset to defaults），mousedown outside-click 关闭。Storage key `sentori:issues:columns:v1`。新发现：vitest 4 + jsdom 的 `globalThis.localStorage` 是空 stub object（没有 `setItem` / `getItem` 方法），spec 顶上 `Object.defineProperty` 装了一个 in-memory polyfill —— 浏览器里 native localStorage 走原生实现不受影响。5 个新单测覆盖 default 解析 / 用户覆盖 / 新列 forward-compat / corrupted payload 静默 / round-trip。dashboard build 131.3 KB gzip，TS+vitest 18 → 23 全绿。
- [x] **sub-C**：`saved_views` 表 + UI —— `migration 0018`：`saved_views(id, org_id, target, scope, team_id, user_id, name, payload jsonb, created_at, created_by, updated_at)`，`target` 走 CHECK in `('issues')` 留 forward room，`scope ∈ ('personal','team','org')`，CHECK 表达 scope ↔ FK 互斥关系（personal 必带 user_id、team 必带 team_id、org 两者皆 NULL）。三个端点 `GET /api/orgs/{slug}/views` / `POST /views` / `DELETE /views/{id}`，复用 `require_user`。可见性：org-scope 全员看；team-scope 团队成员或 org owner/admin（admin 看所有 team 用一个面板就行）；personal-scope 仅本人。创建 authz：personal 任何成员、team 团队 lead 或 org admin、org 仅 admin。删除 authz 镜像创建。Dashboard：`SavedView / SavedViewScope / SavedViewPayload` types + `orgsApi.{listViews,createView,deleteView}`；`<IssuesView>` header 加 `Views (N)` 按钮 → popover 按 scope 分组（org / team / personal）每行小卡片显示名字 + team_slug + 截断 query；`+ Save current view…` 弹模态：name + scope radio + team select（scope=team 时拉 `teamsApi.list`），错误返回的 `{error}` 内联红字渲染。视图应用 = setQueryText（如 view 含 `status` 但 query 没 `status:` token，append 一段，让 status tab 同步翻）。1 个 server integration test 覆盖 4-user 矩阵：owner / lead / member / bystander 三种 scope 的可见性 + 创建 authz + 删除 authz。dashboard build 132.5 KB gzip，server 全套相关 18 项测试全绿。
- [x] **sub-D**：bulk action endpoint + UI —— `POST /admin/api/projects/{id}/issues:bulk` 接 `{ issueIds: Uuid[], action: 'resolve'|'silence'|'close'|'reopen' }`，server map action → `status` 字符串（**不**让 client 直接传 raw status，避免 `regressed` 这种 ingest-only 状态被人手 patch 进去）；空数组 / >200 / unknown action 全 reject；UPDATE 用 `id = ANY($::uuid[])` 一条 SQL 完成，含 single-row PATCH 一致的 CASE：resolve 时 stamp `resolved_at = now()` + `resolved_in_release = last_release` + 清 `regressed_*`；非 resolve 时清 `resolved_*`。Dashboard：`adminApi.bulkPatchIssues`；`<IssuesView>` 加首列 checkbox（select-all 含 indeterminate 三态），shift-click 范围选（`lastClickedIdxRef` 追 anchor），row checkbox 走 `e.stopPropagation()` 不触发 row 的 navigate；选中 ≥ 1 时 header 下方插一条 `bg-accent/5` toolbar 显示 `N selected · Resolve · Silence · Close · Reopen · Cancel`，mutation onSuccess 清 selectedIds + invalidate `['issues', projectId]`；行高亮用 `bg-accent/5` 区分选中态 vs `bg-accent/10` 键盘焦点态。3 个 server integration test：bulk resolve stamps release / invalid action 拒 / 空数组拒；dashboard build 133.0 KB gzip。注：`assignee` 在 schema 里没字段（v0.2 issue 表没 `assigned_to`），ROADMAP exit 提到的 bulk assign 推迟到 Phase 25 issue detail revamp 一起做（assignee schema + UI 同时落更省）。
- [x] **sub-E**：density toggle compact / cozy —— `web/src/lib/density.ts` 提供 `DensityProvider` (React Context) + `useDensity()` + `densityClasses(d)` token map（`compact: h-7 + py-0.5 + text-[12px]`，`cozy: h-10 + py-1.5 + text-[13px]`）；localStorage `sentori:ui:density:v1` 持久化，quota / 私密模式 fallback；store *tokens* 而不是 raw class strings 让每个表自选哪些 slot 用。`main.tsx` 套 `<DensityProvider>`；`<OrgLayout>` 头部加 `<DensityToggle>` 按钮（compact: ☰ / cozy: ≡）。Tables 全用 `dCls.rowClass` 替换原来 hardcode 的 `h-9` / `h-8`：`issues.tsx` / `token-settings.tsx` / `recipient-settings.tsx` / `org-settings.tsx`（members + invites 两表）/ `team-list.tsx` / `team-detail.tsx` / `audit-log.tsx`，共 7 处 view。两个新单测覆盖 token map 互斥 + h-7 vs h-10 token 选择。dashboard build 133.5 KB gzip，vitest 25/25 全绿。

**Phase 24 ✅** — Issues 列表 power-user 化全 5 sub 完成：query parser + 列配置 + saved views + bulk actions + density。下一步 Phase 25 issue 详情页 revamp（含 assignee schema + bulk assign 补做）。

---

### Phase 25 — Issue 详情页 revamp

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

#### Steps
- [x] **sub-A**：tab layout shell + URL hash 路由 —— `<IssueDetailView>` 整页重做。顶部 sticky header（`Back · errorType · messageSample · status badge` 按 status 染色 + EventPicker `1 / N of total · prev/next · uuid prefix`）+ tab bar `Stack | Events | Breadcrumbs | Tags | Activity`。`useTabFromHash()` 自定义 hook：`location.hash` parse 成 Tab，set 用 `history.replaceState` 不污染浏览器历史栈（tab 是 view mode 不是 navigation，对标 Linear / Vercel），`hashchange` 事件订阅外部回 / 复制粘贴 URL 都正确。Stack tab：原页面所有内容（symbolicated toggle + StackList + CauseChain + Releases chips + ReleaseArtifactsPanel + Context grid）；Events tab：列表（取代旧侧栏，每行 uuid + message + receivedAt + env / release / platform 三 chip）；Breadcrumbs / Tags tab 拆出独立组件；Activity tab placeholder 标 sub-E。键盘 `[` / `]` step event 跨 tab 仍生效。dashboard build 134.2 KB gzip。
- [x] **sub-B**：inline source 抽屉 + 服务端 `GET /admin/api/projects/{project_id}/events/{event_id}/source?frame=N&cause=M` —— 由于 frame 可能在 cause chain 里某层（最深 10 层），endpoint 用 `(frame, cause)` 二元坐标定位 stack 中的具体一行；走 raw 行号（symbolicate 在 read 路径 in-place 重写但 index 稳定）。`symbolicate.rs` 加 `source_for_frame(pool, release, raw_line, raw_col, ctx)` + 内部 `window_from_sourcemap` 纯函数（无 DB），单元可测；用 `sourcemap::Token::lookup_token` 反查到 source idx，从 `SourceMap::get_source_view(idx)` 拿 sourcesContent，按 ±5 行切片返回 `{file, line, column, before[], at, after[]}`。Dashboard：`adminApi.frameSource` + `FrameSource` type + `<StackList>` 行改成 `<button>` onClick 触发 drawer，`<CauseChain>` 加 depth 参数把 cause 索引传上去；`<FrameSourceDrawer>` 右侧滑入半屏，header 显 `cause N · frame M`，body 用 `<pre>` 渲染上下文行（命中行 `bg-accent/10` 高亮 + 左侧行号），404 时友好提示 "release 没传 sourcemap / 反查失败 / sourcemap 没带 sourcesContent"，Esc 关闭。`SourceMapBuilder::add_raw` + `set_source_contents` 写了 2 个单元测试覆盖 window 切片 + 起点边界 clamp（`before` 在文件头被截到 1 行）。dashboard build 135 KB gzip。
- [x] **sub-C**：breadcrumb 时间轴组件 —— 新文件 `web/src/views/breadcrumb-timeline.tsx`：左 gutter 时间戳 + 类型彩色圆点 + 垂直连接线（首尾不画线让两端不漏出连接线），body 按 type 渲染（`nav`: from→to / `net`: METHOD URL status durationMs（status ≥500 红 / ≥400 琥珀 / 2xx 绿）/ `log`: level + message（warn 琥珀 / error 红）/ `user`: action target / `custom`: JSON dump）。`groupBreadcrumbs` 纯函数：相邻同 type 且时间差 ≤1s 合并；3+ 行折叠成 `type ×N — expand`，<3 行不显折叠按钮（chevron 不污染）。`<IssueDetailView>` 的 `BreadcrumbsTab` 调用从旧 `<BreadcrumbsList>` 切到 `<BreadcrumbTimeline>`，把旧组件删掉。4 个新 vitest 单测覆盖：不同 type 各自独立分组 / 同 type ≤1s 合并 + >1s 切组 / type 变化即使时间贴近也分组 / 空数组。dashboard build 135.8 KB gzip，vitest 24/24 全绿。
- [x] **sub-D**：related issues 面板 —— ROADMAP 字面 "同 fingerprint" 但 fingerprint 已 = issue（events 列表本身就是同 fingerprint），改进后的解读：**"这个 release 还炸了什么"**。`<RelatedIssuesPanel>` 在 Stack tab 底部加一段 `Other active issues in {release}`，复用现有 `listIssues({ release, status: 'active', limit: 20 })` 端点（不加 server endpoint），客户端 filter 剔自身 issue.id 后取 top 10，每行 errorType + messageSample + 事件数 + relativeTime，整行 `<Link>` 跳目标 issue。`<StackTab>` 加 `issueId` + `orgSlug` props 把上下文穿到 panel。零 active 时 panel 不渲染。dashboard build 136 KB gzip。后续 server 端 `excludeId` 参数随数据规模再加。
- [x] **sub-E**：comments + activity log —— `migration 0019_issue_comments.sql`：`issue_comments(id, issue_id FK CASCADE, author_id FK SET NULL, body, created_at)` + `(issue_id, created_at)` 索引。Server 三个端点 `GET /admin/api/projects/{id}/issues/{iid}/activity` / `POST .../comments` / `DELETE .../comments/{cid}`：activity 是 unified stream，把 `issue_comments` 行 + `issues.resolved_at` / `regressed_at` 状态时间戳合并按 `at` 升序输出，三种 `kind: comment / resolved / regressed`（**故意不读 audit_logs**——audit 是 org 级安全审计、与 per-issue UI 流不混；Phase 25 sub-F 落 issue.assign / fix-in-release 时再扩 stream）；`Serialize` 用 `#[serde(tag = "kind")]` + 每个 variant 自己的 `rename_all = "camelCase"`（enum-level rename_all 不传播到内 variant 字段，踩过坑）。Body 校验 1..2000 char trimmed；create 要求 User caller（DevToken / LegacyAdmin 拒）；delete 仅作者或 LegacyAdmin/DevToken。`AppError::Forbidden` 加进 enum + 403 mapping。Dashboard：`ActivityEntry` 联合类型 + `adminApi.{listIssueActivity, createIssueComment, deleteIssueComment}`；`<ActivityTab>` 接进来，列表 + comment 输入框（textarea + N/2000 计数 + "Comment" 按钮 disabled-when-empty/oversize），`<CommentEntry>` 显示作者邮箱 + relativeTime + 自己的 comment 显 Delete 按钮，`<StateEntry>` 渲染 resolved（绿）/ regressed（红）+ release。2 个 server integration test：unified stream 包含 comment+resolved+regressed 三种且 author email 正确 + 删除自己的 comment 204；body 边界（empty / >2000）拒绝。dashboard build 136.6 KB gzip。
- [x] **sub-F**：assign / status / "fixed in release" 流 —— `migration 0020`：`issues.assignee_user_id UUID FK SET NULL` + 部分索引 `WHERE assignee_user_id IS NOT NULL` 给 "我的 issues" filter。`IssueRow` SELECT 三处都改成 `JOIN users u ON u.id = i.assignee_user_id` 拿 `assignee_email`，加 `assigneeUserId / assigneeEmail` 字段。**`patch_issue`** 升级两个语义：(1) `assigneeUserId` 走 *double-Option*（自定义 `deserialize_double_option`）—— `Some(Some(uuid))` 设、`Some(None)` 清空、`None` 不动，让 dashboard 能传 `null` 区别于 omit；(2) `resolvedInRelease` 同样 double-option，覆盖默认的 `last_release`，让用户手动 pin "fixed in 1.2.0"。SQL 用 `COALESCE($4::TEXT, last_release)` 保留 fallback 行为。**`bulk_patch_issues`** 加 `action: "assign"` 走 `id = ANY($::uuid[])` 一条 SQL，要求 `assigneeUserId` 字段（可为 null = 批量 unassign）。Phase 24 sub-D 留下的 bulk assign 尾巴在此补全。Dashboard：`IssueRow` types 加两字段；`adminApi.patchIssue` body 联合类型加 assignee/resolve；`bulkPatchIssues` 走 discriminated union（`'assign'` action 必带 assigneeUserId）；`<IssuesView>` 列设置 + table cell 加 `assignee` 列默认 hidden、bulk toolbar 加 `Assign to me` / `Unassign` 两键；`<IssueDetailView>` header 加 `<IssueActions>`：assignee chip + Assign to me / Unassign + 当 status 非 resolved 时 `Resolve in <select 上次见过的 releases>` 按钮，`onResolve` 把选定 release 同 patch 一起送。3 个 server integration test：单行 patch assignee 设/清 round-trip / resolve 时 `resolvedInRelease` 覆盖 last_release / bulk assign 一次设 3 行；dashboard build 137.1 KB gzip。

**Phase 25 ✅** — Issue 详情页 revamp 全 6 sub 完成：tab shell + URL hash / inline source 抽屉 / breadcrumb 时间轴 / 同 release related issues / comment + activity log / assignee + resolve-in-release。Issue triage 已经是完整 power-user 体感。

---

### Phase 26 — Health metrics（crash-free rate / sessions）

**Goal:** 轻量 session-aware。不做 session replay。

**Entry:** Phase 25 ✅

**Exit:**
- SDK init / close 触发 session ping（open / close / errored）
- crash-free user / session per release / per env
- Health widget on overview page
- Per-release health 对比

**Estimate:** 1.5 周

#### Steps
- [x] **sub-A**：协议加 session ping（`POST /v1/sessions`） —— `migration 0021_sessions.sql`：`sessions(id PK uuid v7, project_id FK CASCADE, user_id TEXT 应用级 id 不连 FK 到 users 表, release, environment, status CHECK in (ok / errored / crashed / exited), started_at, duration_ms ≥0, received_at)`，三个索引（project+release / project+received / project+user partial）。Server `api/sessions.rs`：单 ping endpoint 走 `require_token` 共享 ingest 限流；body 校 release ≤200 / env ≤64 / userId ≤200 / 四态 status 白名单 / duration 0..7days（夹掉 clock skew bug）；`ON CONFLICT (id) DO NOTHING` 让 SDK 重试可幂等不双数。`/v1/sessions` 路由进 `ingestion` 路由组。protocol.md + 镜像加 endpoint 章节，列 healthy=`ok|exited` / unhealthy=`errored|crashed` 的语义、duration 上限、idempotent 行为；版本 bump v0.1.2。3 个 server integration tests：round-trip 校验存进 DB、重发 3 次 1 行、bad input 各种 400（status / duration 负 / duration >1week / 401 missing token）。**故意不做** init/heartbeat ping、active session UI、批量 endpoint —— 单 close ping + 现场 query 是最小体量；规模真上来再加 `/v1/sessions:batch` 和预聚合。
- [x] **sub-B**：SDK lifecycle —— core SDK 加 `SessionTracker` 类（host-agnostic）：`start(ctx) / markErrored / markCrashed / end(finalStatus?)` 状态机，status promotion 单调（crashed > errored > exited > ok，markErrored 不能盖 crashed），`end()` 幂等且 idempotent 不双发，重入 start 静默丢弃旧 session（lifecycle 由 platform 拥有）。Host 注入 `send` 回调让 transport 走平台原生路径。**JS SDK** (`@goliapkg/sentori-javascript`)：transport.ts 抽 `postJson` helper 复用给 `send` (events) + `sendSession` (sessions) 都走 sendBeacon→fetch fallback；`session-tracker.ts` 单例包装；`init()` 启 `startSession()`；browser hook 加 `pagehide` listener（modern 浏览器 unload 标准事件，不用过时的 `beforeunload`，bfcache + 后台 + 关 tab 都触发）；node hook 加 `beforeExit` ship `exited` ping；`captureError` 调 `markSessionErrored`。**RN SDK** (`@goliapkg/sentori-react-native`)：parallel 实现，transport 加 `sendSessionPing`；新文件 `handlers/lifecycle.ts` 通过 `require('react-native').AppState` 订阅 'change' 事件，`active` → `startSession` / `background|inactive` → `endSession`（**故意 inactive 也 end** 因为 swipe-away 永远不会触发 background；新进入 active 起新 session 计两次符合 "用户开了两次 app" 直觉）；`init()` 装 lifecycle 后立刻 `startSession()`；`captureError` 调 `markSessionErrored`。Versioning：sentori-core 0.2.0 → sentori-javascript 依赖从 0.1.0 跳到 0.2.0（之前是 npm 上的旧版本，没拿到 SessionTracker，bun 链了 npm 缓存而非 workspace；强制 reinstall 让 symlink 指向本地）。Tests：core 7 个 vitest 单测覆盖 SessionTracker（duration / 状态升降 / 终态 override 不降级 / start-while-active 丢弃 / end 幂等）；JS 8 + RN 18 既有套件 build 全过；server 3 个 sessions integration test 之前 sub-A 已通过。
- [x] **sub-C**：聚合 query —— `GET /admin/api/projects/{id}/health?from&to&bucket&release&environment` 返回 `{ summary, buckets[] }`。Bucket 用 PG 14+ `date_bin($interval, received_at, '1970-01-01')` 而不是 `date_trunc`，绕开 timezone 偏移坑（每个 server 都按 epoch 对齐）；支持 `5m / 1h / 1d` 三档。Summary 单独一条 query 走 `COUNT(DISTINCT user_id) FILTER (WHERE status = 'crashed')` 算 crash-free user rate（匿名 NULL user_id 不进 user-rate 但仍进 session-rate）。Rate NaN-safe：total=0 时回 `null` 让 dashboard 渲 "no data"，不出 0%。From / to 默认 now-24h..now，from ≥ to 拒。Bucket SQL 用 `FILTER (WHERE status = ...)::BIGINT` 三个 count 一次出 total/crashed/errored，按 1 列分组+排序。3 个 server integration test：5 行混合 status/2 user/1 anon 算出 0.8 session-rate + 0.5 user-rate / release filter 收敛 / 空区间 rate 为 null。
- [x] **sub-D**：dashboard 健康 widget on overview —— 新路由 `/org/{slug}/overview`，OrgLayout NAV 加 `Overview` 作为第一项（`Issues` 仍是首次登录默认 redirect 目标，避免破现有用户记忆）。`<OverviewView>` 拉 `adminApi.health(projectId, { bucket: '1h' })` 默认 last 24h；顶部三个 stat card：crash-free session rate（≥99% 绿/否则琥珀）、crash-free user rate（≥99.5% 绿/否则琥珀）、total sessions（neutral）；rate=null 时显 `—` + neutral ring（不假装 0%）。Sparkline 是纯 SVG 几个 `<rect>`：每 bucket 总数当背景灰条 + crashed 数当顶部红条，max=Math.max(1, ...) 防 0 除；不引入 chart 库（保 bundle 体积），整图用 `currentColor` 跟主题对齐。0 session 时底部一行 footnote 提示安装 SDK 后会自动发 ping，不显空 chart 占位。`adminApi.health` + `HealthResponse / HealthSummary / HealthBucket` types 加进 client.ts。dashboard build 138.4 KB gzip。
- [x] **sub-E**：per-release health + alerting hook —— `<ReleaseHealthPanel>` 组件接进 `<ReleaseDetailView>` header 下方一段：复用同一 `health` endpoint 加 `?release=` filter，**窗口故意拓到 last 7 days**（不是 overview 的 24h），因为 per-release sample size 需要更宽窗口才有意义；`bucket=1d` 出周线。四个 stat：crash-free sessions（≥99% 绿）/ crash-free users（≥99.5% 绿）/ total sessions / crashed count。零 ping 时 panel 显友好 "No session pings on this release yet" 不假装 0%。Alerting hook：health endpoint 是 Phase 27 告警引擎读取 crash-free rate 的数据接口，本身已就位（接受 release/env filter + 窗口参数），sub-E 的 "alerting hook" 实质上就是确认数据接口稳定 + 在 release 视图把这一层数据曝光让 dashboard / 告警引擎共用同一来源——告警实现在 Phase 27。dashboard build 138.7 KB gzip。

**Phase 26 ✅** — Health metrics 全 5 sub 完成：sessions endpoint + schema / SDK lifecycle (JS pageshow + RN AppState) / 5min bucket 聚合 query / overview 健康 widget / per-release 健康。轻量 session-aware 的端到端链路就位。

---

### Phase 27 — 告警规则引擎深化

**Goal:** 真 rule engine（不只 "新 issue 发邮件"）。

**Entry:** Phase 26 ✅

**Exit:**
- Rule schema：trigger（count > N in T window / fingerprint match / regression / health drop）+ filter（env, release, fingerprint regex）+ throttle window
- Per-rule recipient routing + 多 channel（email / webhook）
- Webhook channel 实现（Phase 20 schema 落地）
- Daily / weekly digest
- Mute / snooze

**Estimate:** 2 周

#### Steps
- [x] **sub-A**：`alert_rules` schema + CRUD —— `migration 0022`：`alert_rules(id PK, org_id FK CASCADE, project_id FK CASCADE 可空 = org-wide, name, enabled, trigger_kind CHECK in (new_issue, regression, event_count, crash_free_drop), trigger_config JSONB, filter_config JSONB, channels JSONB, throttle_minutes 0..7d, last_fired_at, created_at/by, updated_at)`，三个索引（org / project partial / enabled+kind partial）。**故意把 trigger_config / filter_config / channels 留 JSONB 不强 schema**——shape 会跟 sub-F 的 mute/snooze + 后续 trigger kinds 一起演化，DB CHECK 会要求每次 shape tweak 都加 migration，不值。Server `api/alert_rules.rs` 四端点 list / create / patch / delete 在 `/api/orgs/{slug}/alert-rules`：read 所有 org 成员、create/patch/delete owner+admin only。Audit 三个新 action `alert_rule.created/patched/deleted` 接进 catalog（`AlertRule` target type + label + `all_labels()` 列表 + filter 下拉自动可见）。校验：trigger_kind 白名单、name 1..80 trimmed、throttle 0..7d、channels 必须 array、trigger_config / filter_config 必须 object、project_id 必须属于该 org。`PatchRuleBody` 用 `COALESCE($N, col)` 保留没传的字段。2 个 server integration test：4-step 生命周期（owner create / member 403 / list 看到 / patch 跑通 + audit 三条 / 删 204）+ 校验拒（unknown trigger / channels not array / 空 name / throttle 超限）。
- [x] **sub-B**：rule evaluator —— `server/src/rule_eval.rs`：两入口 `try_fire_on_event` (同步从 ingest 路径调，覆盖 `new_issue` + `regression`) + `spawn_cron` (60s ticker，sweep `event_count` + `crash_free_drop`)。**Throttle 走 atomic UPDATE-RETURNING**：`UPDATE alert_rules SET last_fired_at = now() WHERE id = $1 AND (last_fired_at IS NULL OR last_fired_at < now() - make_interval(mins => $2))` 返行才发，并发 evaluator 自然只一个赢 race。Filter 匹配：`environment` / `release` 严格相等，`errorTypeRegex` 走 PG `~`（cron 路径）+ `regex` crate 内存匹配（on-event 路径）。On-event SQL `JOIN projects p ON p.org_id = r.org_id` 让 org-wide rule（`project_id IS NULL`）也匹配该 org 任意项目。`event_count` cron query: `JOIN projects` + `($1::UUID IS NULL OR project_id = $1)` 同时支持 project-scoped 和 org-wide。`crash_free_drop` 设了 hard-coded 10-session minimum sample size 防 toy project 噪声炸警。Notifier 加 `AlertFired { rule_id, rule_name, org_id, channels: JsonValue, summary, body }` 变体：遍历 channels[] 中 `type='email'` 的项发邮件，subject `[Sentori] Alert: {rule_name} — {summary}`，body 带 trigger / project / issue / release / type 上下文。Webhook channel 留 sub-D。`events.rs` 在 `is_new` / `regressed` 分支调 `try_fire_on_event` 同时发 NotifyEvent::NewIssue / Regression（两条路径并存：alert rule 走精细 filter / recipients 走 project 默认）。`main.rs` spawn 60s ticker。新增 `regex` crate 依赖。3 个 server integration test：on-event new_issue rule 含 env+regex filter（mismatch / mismatch / match → 仅一条 AlertFired）/ event_count cron 阈值跨过即触发 / throttle 60min 阻塞重发。
- [x] **sub-C**：UI 创建 / 编辑 rule —— 新路由 `/org/{slug}/alerts` + `<AlertsView>`，OrgLayout NAV 在 `Audit` 之前加 `Alerts` adminOnly 项；`permissions.ts` 加 `alert.manage` action（owner / admin 通过）。`adminFetch` 之外接 `orgsApi.{listAlertRules, createAlertRule, patchAlertRule, deleteAlertRule}` 4 个端点 + 6 个 client types（`AlertRule / AlertRuleInput / AlertTriggerKind / AlertTriggerConfig / AlertFilter / AlertChannel`）。`<AlertsView>` 列表 6 列：enabled checkbox（点即触发 `patchAlertRule { enabled }` mutation）/ 名字 / 触发器 chip 含 inline summary（`event_count` 显 `≥N events / Wm`、`crash_free_drop` 显 `rate < X% / Wm`）/ 过滤器 `env:prod release:1.0 type~^Type` / throttle `Nm` / 上次触发 relativeTime / 编辑+删除（confirm 对话框）。`<RuleModal>` 创建 + 编辑公用：name + trigger select + 根据 kind 动态显示 count/threshold/windowMinutes 字段 + filter 三输入（env / release / errorType regex）+ emails CSV 输入（拆分 `[,\s]+` 转成 `[{type:'email', to:[...]}]` channels 数组）+ throttle + enabled。Webhook channel UI **故意推迟到 sub-D**——和 webhook 实现一起落更省，避免 UI 空配置。Modal 错误把 server `{error}` 内联红字渲。dashboard build 140.8 KB gzip。
- [x] **sub-D**：webhook channel + signature verification —— 新模块 `server/src/webhook.rs`：`send(WebhookDelivery { url, secret, body, event })` 单次签名 POST，header 套 `protocol.md` Phase 20 sub-D 锁定的形态：`content-type / sentori-event / sentori-delivery-id (uuid v7) / sentori-timestamp (unix s) / sentori-signature: t=<ts>,v1=<hex>` + `user-agent: sentori/0.2`。`sign(secret, ts, body)` 公开 helper：HMAC-SHA-256 over `<ts>.<raw-body>` → 64 hex char，receiver 复用 OK。Connect 5s / read 10s timeout；reqwest 加 `rustls-tls` feature 让 prod image 不带 system OpenSSL。**v0.2 retry 策略 = 一次 + log**——持久化 retry 队列推迟，audit log 已捕 rule-fire 历史不丢"是否触发"。Notifier `AlertFired` channel 处理加 `webhook` 分支与 `email` 并行：缺 `url` / `secret` warn skip；payload `{id, kind:"alert.fired", ruleId, ruleName, orgId, summary, body, firedAt}` 一致 JSON 出。Dashboard `<RuleModal>` 加 Webhook fieldset：URL + secret 两输入，hint 内嵌签名公式 `sentori-signature: t=<ts>,v1=<hex>`；channels 数组按需 push。1 个 server integration test：起 axum mock receiver 在同进程，rule 配 webhook → cron sweep 触发 → 等 50×20ms 收到一次 POST → 验证所有 5 个 sentori-* header 形态、`v1=` 64-hex、HMAC 重算等于 header 值（receiver-side verification path 走通了）、body shape `{kind, ruleName, summary, firedAt, id}` 完整。`webhook.rs` 自带 1 个 unit test 覆盖 sign 决定性 + 不同 secret/body/ts → 不同 hex（replay 防御）。Webhook sign helper 4 项 invariants 锁住，audit-event webhook delivery 后续 phase 共用同一 primitive 直接套用即可。
- [x] **sub-E**：digest（cron + opt-in） —— `migration 0023`：`digest_subscriptions(user_id, org_id, frequency CHECK in (daily, weekly), last_sent_at, created_at)` 复合 PK + due-by-frequency 索引。Server 三个端点 `/api/users/me/digests` GET / POST 订阅 / DELETE `{org_slug}/{frequency}`：所有操作都 scope 到当前 user，**不接受跨用户 / admin 强订阅**——op-in 是字面意义。`server/src/digest.rs::sweep_once(pool, tx)` 一条 SQL 拉所有 `last_sent_at IS NULL OR last_sent_at < now() - CASE frequency WHEN 'daily' THEN 24h ELSE 7d`，对每行算 org-wide aggregate (新 issues / regressed issues / events / 总 sessions / crashed / crash-free rate) 注入 `NotifyEvent::DigestEmail { to, org_name, org_slug, frequency, summary_lines, window_hours }` 然后 UPDATE `last_sent_at = now()`（即使 notifier 失败也 mark sent，宁愿丢一份 digest 也不重复轰炸）。Notifier `DigestEmail` 邮件 subject `[Sentori] Daily/Weekly digest — {org_name}`、body 含 6 行 summary + window hours + manage-subscriptions 链接行。`spawn_cron` 每小时 sweep 一次。2 个 server integration test：subscribe → 首次 sweep 触发 + last_sent 推进 → 第二 sweep 24h 内 throttle 0 fire / unsubscribe 204；subscribe 拒未知 org (404) + 未知 frequency (400)。User-grain 不是 org-grain：两个用户都订阅同一 org daily 各自收一封，unsubscribe 只删自己的行。**Dashboard UI 推迟**——sub-E ROADMAP 是"cron + opt-in"，未明文要求 settings 页 UI；client API 已就位，UI sub 可以独立做（避免 phase 27 collation 过大）。
- [x] **sub-F**：mute / snooze —— `migration 0024`：`alert_rules` 加两列 `muted BOOLEAN DEFAULT FALSE` / `snoozed_until TIMESTAMPTZ NULL`。**两态语义独立**：muted 是用户主动静音不限期（不同于 enabled=false：muted 仍在活动列表显示，disabled 暗示用户准备退役 rule）；snoozed 是临时（1h/4h/24h/7d 快捷选项），过期自动清。Evaluator 三处 SQL（`try_fire_on_event` + `sweep_event_count` + `sweep_crash_free_drop`）WHERE 加 `muted = FALSE AND (snoozed_until IS NULL OR snoozed_until < now())` —— PG 自己判断过期，不需要单独 cron 清字段。`PatchRuleBody` 加 `muted` (Option<bool>) + `snoozed_until` (double-Option，`Some(None)` = explicit clear) 字段；UPDATE 走 `CASE WHEN $::BOOL THEN $val ELSE snoozed_until` 让 "字段未传" 不覆盖、"传 null" 显式清空。Dashboard `<AlertsView>`：name 列加 `Muted` 琥珀徽章 / `Snoozed` 蓝徽章（hover 显 toLocaleString 解开时间）；操作列加 `Mute / Unmute` 切换 + `Snooze / Wake` 按钮（snooze 用 `prompt('Snooze for how many hours?', '1')` 简单收集时长，snoozed 状态时按钮文案变 `Wake` 一键清掉）；types 加 `muted / snoozedUntil` 两字段。2 个 server integration test：muted 阻止 fire / unmute 后 fire / 设 snooze 阻止 fire / 显式 null 清掉后 fire。dashboard build 141.4 KB gzip。

**Phase 27 ✅** — 告警规则引擎深化全 6 sub 完成：alert_rules schema + CRUD / rule evaluator (cron + on-event 双触发) / dashboard CRUD UI / signed webhook channel / opt-in digest / mute + snooze。从"新 issue 发邮件"到完整 rule engine 的端到端链路就位。

---

### Phase 28 — 全局搜索 + Dashboard polish + a11y + 性能

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

#### Steps
- [x] **sub-A**：Cmd+K palette + `GET /admin/api/search?q=&types=` —— Server `api/search.rs`：5 张表 (orgs / teams / projects / issues / members) per-type LIMIT 10、按 caller 可见性 filter（`AdminCaller::User` 走 `EXISTS memberships m WHERE org_id = ... AND user_id = caller`，token / LegacyAdmin 跳过 scope 全表搜索）；ILIKE substring 匹配 + `\\%` `\\_` 转义防 wildcard 注入；`?types=` CSV 选子集（默认全 5 类）；统一 hit shape `{type, id, label, sublabel?, url}` 让前端一个组件渲。**v0.2 不上 PG full-text**——dataset 小、ILIKE 跑得动；真 latency 涨了再上 GIN tsvector。Dashboard `<CmdK>` 全局组件挂在 `<OrgLayout>` 内：Mod+K（macOS Cmd / Linux+Win Ctrl）toggle / Esc / outside-click 关 / ArrowUp+Down + Ctrl-N/P 导航 / Enter 跳转；输入 120ms debounce 防 fast-typer 多 query；空 query 显 `Recent` section（localStorage `sentori:cmdk:recent:v1` 上限 10 条）；hit row 用 `<KindChip>` 5 色徽章（org accent / team amber / project blue / issue red / member violet），sublabel 显 `org-slug · type` 上下文；底部一行键盘 cheatsheet `↑↓ navigate · ↵ open · esc close`。2 个 server integration test：跨 org user 搜不到别人的 project / issue（visibility 隔离）+ `?types=project` 严格收敛。dashboard build 142.5 KB gzip。
- [x] **sub-B**：`?` cheatsheet —— `<KeyboardCheatsheet>` 全局组件挂在 `<OrgLayout>` 与 `<CmdK>` 平行；`?` 无 modifier toggle / Esc / outside-click 关闭。`?` listener 检 `target.tagName ∈ {INPUT, TEXTAREA, SELECT}` + `isContentEditable` 即跳过——在搜索框打 ? 不弹面板。3 段静态分组（Global / Issues list / Issue detail）共 12 条 shortcut，每条 `<kbd>` chip 视觉+一行 label。**故意不上 hotkey registry**：dashboard 现有 `useHotkeys` 散布各 component 不在统一 hub，硬编码列表是漂移风险 vs 把 registry 缠进每个 hotkey site 的复杂度的 trade-off—— v0.2 选漂移风险（review checklist 加一条"加 hotkey 同步更新 cheatsheet"够用）。dashboard build 143.0 KB gzip。
- [x] **sub-C**：a11y baseline —— `index.css` 加全局 `:focus-visible { outline: 2px solid accent; offset: 2px }` 让没显式 `focus:ring-*` 的交互元素键盘用户仍看见焦点（用 `:focus-visible` 不是 `:focus`，鼠标点击不污染）；`prefers-reduced-motion: reduce` media query 把 animation / transition / scroll-behavior 全压到 0.001ms 尊重系统偏好；`.skip-to-content` link 默认 `translateY(-200%)` 隐藏，`:focus-visible` 时 `translateY(0)` 露出，让键盘 tab 第一下能跳过 nav 直接到主内容（`<OrgLayout>` `<main id="sentori-main">` 配套加 anchor）。Audit 走查：所有 `<button>` 都已带 `type="button"` 或 `type="submit"`（包括动态 `type={onClick ? 'button' : 'submit'}`，无 untyped 实例）；`<EventPicker>` `[/]` / `<DensityToggle>` ☰ ≡ / `<RuleModal>` 关闭 `✕` / `<KeyboardCheatsheet>` esc 等 icon-only 按钮都有 `aria-label` 或 `title`；modal 全部 `role="dialog"` + outside-click 关闭。**故意不上 axe-core / Lighthouse 自动 audit 集成**：v0.2 dataset 小、UI 表面有限，hand-walked + 这一波静态规则覆盖到位，CI 集成留待真有人报 a11y bug 再加。dashboard build 143.1 KB gzip。
- [x] **sub-D**：route-level code splitting —— `main.tsx` 把 19 个非 critical view 全转 `React.lazy(() => import(...).then(m => ({ default: m.X })))`。Critical path 保持 eager：`LoginView / RegisterView / VerifyView / ForgotPasswordView / RootRedirect / ProtectedLayout / OrgLayout`（首屏必经）。其余 view（issues / issue-detail / releases / overview / alerts / audit / settings / teams 等）都按 route 拆 chunk。`<RouteSuspense>` 在 `Suspense` 边界统一 fallback `Loading…` 文本，每个 lazy element 用 `lazyEl()` helper 包一层让 routing table 清爽。**结果首屏 gzip 从 143 KB → 103.5 KB**（达 ROADMAP 目标 200KB 双倍裕度），最大单个 lazy chunk `issue-detail` 6.4 KB gzip / `client.ts` 7.6 KB / `useQuery` 5.5 KB / `react-hotkeys-hook` 2.2 KB；总 19 个 view chunks 平均 1-2 KB gzip。Vite 自动按 import graph 共享子 chunks（react-hotkeys-hook 抽出来给 `issues` + `issue-detail` 共用）。dashboard build 整体未变大，只是切片：路由切换时按需加载 < 50ms 走本地 cache。
- [x] **sub-E**：empty / loading / error 一致化 —— 新文件 `src/components/states.tsx` 三个组件 `<LoadingState label?>` / `<ErrorState label, detail?, onRetry?>` / `<EmptyState title, hint?, cta?>`：统一 padding (`px-6 py-6` for compact / `px-6 py-10` for empty)、配色（loading + empty `text-fg-muted` / error `text-red-400`）、ARIA roles (`role="status"` / `role="alert"`)。替换 7 个主 view 的 inline state blob：alerts / overview / releases / release-detail / release-compare / issue-detail / issues。文案借机一致化（"No X yet" + 可执行 hint，避免单行干描述）。`onRetry` 字段为 sub-F polish 留接口（query.refetch() 接进），本 sub 暂不暴露。dashboard build 103.5 KB gzip 首屏（无变化，state 组件本身 < 200 字节 minified）。后续 view（team-list / org-settings / token-settings 等）有零散内联 state 留 sub-F 顺手清理。
- [x] **sub-F**：theme 微调 + 设计 token 文档化 —— 新 `docs/design-tokens.md`：完整列出 light + dark palette 8 个 token（bg / bg-tertiary / fg / fg-secondary / fg-muted / border / accent）含 hex 值 + 用途描述；status 颜色语义表（success/warn/danger/info/neutral/distinct 对应 Tailwind palette 引用）；typography 三档（dashboard 14px / marketing 15px / docs `--sl-text-base: 14.5px`）；density tokens（compact `h-7 + py-0.5 + 12px` / cozy `h-10 + py-1.5 + 13px` 来自 `lib/density.ts`，故意不放 CSS 因为每表挑哪些 slot 用得不一样）。**Hard rules**：no raw hex inline、no new font family、`prefers-reduced-motion: reduce` 必须尊重、status 颜色 one-way（绿不能复用做 neutral）。三处 CSS（`web/src/index.css` / `marketing/src/styles/global.css` / `docs-site/src/styles/overrides.css`）顶上加注释指向 doc table 作 single source of truth：**值仍手动镜像不走 npm 共享包**——三个 surface 各打 bundle，shared CSS package 强制每次 token 改动跑发布循环成本不值，doc-driven reconciliation 够用（review checklist 加 "PR 同时改三处 + 表"）。本 sub 不调具体颜色值（已收敛），只做 hardening：注释 + docs。dashboard build 103.5 KB gzip 不变。

**Phase 28 ✅** — 全 6 sub 完成：Cmd+K 全局搜索 / `?` 键盘 cheatsheet / a11y baseline (focus-visible + skip-to-content + reduced-motion) / route-level code splitting 首屏 143 → 103.5 KB / empty + loading + error 一致化 / design token 文档锁定。

---

# 🎉 v0.2 ROADMAP COMPLETE 🎉

Phase 18 → 28 全部 ✅。从 Phase 18 的 org / team 账户结构、19 的角色权限矩阵、20 的审计日志、21-22 的 SDK 矩阵 + 原生符号化、23 的 release 一等公民、24 的 issue list power-user、25 的 issue 详情 revamp、26 的 health metrics、27 的告警规则引擎、到 28 的搜索 + polish —— 跨 11 个 phase、~60 sub、Rust + TypeScript + Kotlin + Swift 多语言、server + dashboard + marketing + docs + 6 SDK 全栈。下一阶段进 v0.3 规划。

---

---

## v0.1.x — SaaS 上线 + dogfood（Phase 11-17）

self-hosted v0.1.0 之后的 SaaS arc：DNS/TLS（11）→ marketing + docs site（12）→ 多租户改造（13）→ self-serve onboarding（14）→ free tier 配额（15）→ 生产就绪 + 公开上线 sentori.golia.jp（16）→ SDK 分发链路 + dogfood + qualcomm/insight 真接入（17）。

### Phase 11 — 域名 / DNS / TLS 准备

**Goal:** 通过 devops `zones.yaml` 把 `sentori.golia.jp` 主域 + 5 个 4 段 subdomain（status 留到 Phase 16）落地；origin VM 上 Caddy 自动 ACME 出 cert。
**Entry:** Phase 10 完成（self-hosted v0.1.0 已发布）。
**Exit:** 6 个域名都能 HTTPS 访问（即使内容是 502/404 也行），证书 valid。
**Estimate:** 0.5 周。

#### Steps

##### 决策

- [ ] **决策**：DNS 通过 devops 项目 `zones.yaml` 管理（`golia.jp` zone 下加 records），**不**自起 Cloudflare client
- [ ] **决策**：3 段 `sentori.golia.jp` → CF Pages + orange cloud（Universal SSL 自动覆盖）；4 段子域 → grey cloud + origin Caddy + Let's Encrypt
- [ ] **决策**：4 段子域全部反代到同一台 origin VM（Phase 16 决定具体是 t01 还是 Hetzner，Phase 11 阶段先指 t01 占位）

##### DNS（在 devops 项目）

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

##### TLS（在 origin VM）

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

##### 收尾

- [ ] 写 `docs/infrastructure/dns.md`：subdomain 表 + cf 模式（grey/orange）+ 续期路径（CF Universal SSL 自动 / Caddy 自动）+ 链接到 devops zones.yaml
- [ ] commit：`infra: sentori dns records via devops, caddy tls on origin`

---

### Phase 12 — Marketing 站 + 文档站

**Goal:** `sentori.golia.jp`（主站）和 `docs.sentori.golia.jp`（文档）都有内容并部署。
**Entry:** Phase 11 完成。
**Exit:** 两个站可访问；主站含 Hero / Features / Self-Hosted CTA / GitHub 链接；文档站含 getting-started / SDK / protocol 全套。
**Estimate:** 2 周。

#### Steps

##### Marketing 站
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

##### 文档站
- [x] `cd sentori && bunx create-astro@latest docs-site --template starlight`（手搓——避开 create-astro 的交互 prompt）
- [x] 把 `docs/getting-started.md`、`sdk-react-native.md`、`protocol.md`、`self-hosting.md` 迁入 `docs-site/src/content/docs/`
- [x] 配置侧栏导航：Guides（Getting started / Self-hosting）+ Reference（SDK / Protocol）
- [x] 配置内置全文搜索（Pagefind）—— Starlight 默认开启，build 输出 `dist/pagefind/`，索引 1230 词
- [x] 暗色为默认（`overrides.css` 复用 `web/` 的 palette）

##### 部署
- [x] GitHub Actions：`.github/workflows/pages.yml` —— `wrangler pages deploy` 双 job（marketing + docs），trigger 限定 marketing/ docs-site/ docs/ 改动
- [ ] **(user-owned)** Cloudflare 控制台开两个 Pages 项目：`sentori-marketing` + `sentori-docs`（项目名与 workflow 写死的 `--project-name` 对齐）
- [ ] **(user-owned)** 在每个 Pages 项目里绑 custom domain：`sentori.golia.jp` / `docs.sentori.golia.jp`（DNS 已在 zones.yaml 准备好；CF Pages 加域名时会自动签 cert）
- [ ] **(user-owned)** GitHub repo Secrets：`CLOUDFLARE_API_TOKEN`（scope=Pages: Edit）+ `CLOUDFLARE_ACCOUNT_ID`
- [ ] **(user-owned)** 首次手动触发 workflow_dispatch（或推一个改动）验证 deploy 通；之后 main commit 自动 deploy

---

### Phase 13 — 多租户改造（org / user / membership）

**Goal:** server + dashboard 支持 user / org / project 三层模型；项目数据按 org 隔离。
**Entry:** Phase 12 完成。
**Exit:** 一个用户能注册、创建 org、邀请协作者、管理多个 project，看不到别人 org 的数据。
**Estimate:** 3 周。

#### Steps

##### 数据模型

- [x] migration `0007_multi_tenant.sql` (前 6 个 migration 已用：0001 init / 0002 issues / 0003 partition / 0004 issue_denorm / 0005 release_artifacts / 0006 notifications)：
  - [x] `users` (id, email UNIQUE, password_hash, email_verified, created_at)
  - [x] `orgs` (id, slug UNIQUE, name, created_at, owner_id FK)
  - [x] `memberships` (org_id FK, user_id FK, role enum('owner','admin','member'), created_at, PK(org_id, user_id))
  - [x] `projects.org_id` 加 FK + 回填默认 org（dev system org `019508a0-0001-...`，password_hash 占位非合法 argon2 → 不可登录）
  - [x] `tokens.org_id` 加 FK + 回填
  - [x] `email_verifications` (token, user_id, expires_at)
  - [x] `sessions` (id, user_id, expires_at, ip, user_agent)
  - [x] `org_invites` (token, org_id, email, role, expires_at, used_at)

##### Server

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

##### Dashboard

- [x] 路由：`/login`（替换原 admin_password 登录为 email+password）、`/register`、`/verify?token=`、`/forgot-password`（stub）—— `userAuthApi`（`/api/auth/*`）+ `adminApi`（`/admin/api/*`）拆分；AuthProvider 升级带 `user: {id, email}`
- [x] 顶栏 org switcher（`OrgSwitcher` native select；切换 → `navigate('/org/{slug}/issues')`）
- [x] `/org/:slug/settings`（`OrgSettingsView`）：org 重命名 / 成员列表 + role select（owner-only）+ Remove/Leave / 邀请创建 + pending invites 列表 + Revoke
- [x] `/org/:slug/projects/{id}/settings/recipients`（`RecipientSettingsView`）：增删 `notification_recipients` + on_new_issue / on_regression toggles —— 回填 Phase 9 deferred
- [x] server: 新 `api/recipients.rs` 4 端点（list / create / patch / delete），挂在 `/admin/api/projects/{id}/recipients`，自动经过 `require_admin` + `require_project_in_org`
- [x] 所有 issue/project 路由前缀加 `/org/:slug` —— `/org/:slug/issues[/...]`；`OrgLayout` 提供顶栏 + `OrgCtx`；`/` 由 `RootRedirect` 跳第一个 org 或 `/onboarding`；废弃 `DEV_PROJECT_ID` 写死，`useOrg().currentProject` 给 `IssuesView` / `IssueDetailView` 用
- [x] onboarding：verify 成功后 server 自动 bootstrap personal org（slug ← email 前缀 sanitized + 冲突自动 `-2/-3/...` 后缀，事务原子写入 orgs + memberships）；dashboard `/onboarding` 改造为 fallback 手动建 org form（只在 server 自动建失败或用户失去所有 org 时命中）

##### 测试

- [x] 集成测试 + commit：`scripts/test-phase13.sh` —— 重跑安全（fixture suffix 用 `date +%s%N`），覆盖：
  - [x] register / verify / login + sub-H bootstrap personal org
  - [x] cross-org `GET /admin/api/projects` 隔离（alice ≠ bob 的 projects 列表）
  - [x] alice GET bob's project issues → 403；反向 → 403；本人 → 200；dev token super-admin → 200
  - [x] alice 邀请 bob → bob accept → bob 现在能看 alice 的 project issues（隔离解除）
  - [x] mismatched-email invite → 403 inviteEmailMismatch
- [x] Phase 13 整体收尾（`feat: multi-tenant orgs, users, memberships` 由 sub-A..I 8 个 commit 累计完成）

---

### Phase 14 — SaaS 自助 onboarding

**Goal:** 用户从 `sentori.golia.jp` 注册到拿到第一个 token 接入应用 ≤ 5 分钟。
**Entry:** Phase 13 完成。
**Exit:** 一个新人按 dashboard 引导能 5 分钟内 RN 应用接入并看到第一条事件。
**Estimate:** 1.5 周。

#### Steps

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

### Phase 15 — 配额 / 限流 / usage 计量（free tier）

**Goal:** Free tier 配额（100k events/月、保留 30 天）执行到位，超额时优雅降级。
**Entry:** Phase 14 完成。
**Exit:** 一个 org 超过 100k events 后新事件被 429 拒收，dashboard 显示 banner，邮件告知 owner。
**Estimate:** 1 周。

#### Steps

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

### Phase 16 — 生产就绪 + 公开上线 sentori.golia.jp

**Goal:** sentori.golia.jp 公开可注册；监控/告警/备份/runbook 全部就位；自己用 Sentori 监控 Sentori。
**Entry:** Phase 15 完成。
**Exit:** 域名公开访问；dogfooding ≥ 1 周无 P1 事故；上 Show HN 时不会被打挂。
**Estimate:** 2 周。

#### Steps

##### 部署底座

- [ ] **决策**：起步 Hetzner CCX23（4 vCPU / 16GB RAM / 80GB SSD）× 2（主备） + 1 个独立 PG VM（CPX21）
- [ ] **决策**：v0.1 不上 k8s，docker compose 即可（简单 + 易调试）
- [ ] **决策**：边缘 Caddy（自动 ACME、HTTP/3）替 nginx
- [x] 写 `docker/production-compose.yml`：blue/green 双 server + caddy + valkey；PG 通过 `DATABASE_URL` 指向独立 VM
- [x] 写 `docker/Caddyfile`：app./api./ingest. 三个 site，自动 ACME TLS、`ip_hash` lb（blue/green session 粘附）+ `/v1/events/_recent` 健康检查、HSTS+CSP+CORS（dashboard 限同源、ingest 公开）
- [x] 写 `docker/README.production.md`：day-zero 部署、blue/green 滚动、回滚步骤
- [ ] **(user-owned)** 配置 Cloudflare：DNS → VM IP（grey cloud, Caddy 出 TLS；apex 仍走 CF Pages 兜 marketing）
- [ ] **(user-owned)** 部署：`docker compose -f production-compose.yml pull && up -d`

##### 监控 / 告警

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

##### 日志 / 备份

- [x] 日志：`ops/vector.toml` —— journald (docker.service / caddy.service) → vector → Grafana Cloud Loki，static labels service/env/unit；JSON parse 提取 tracing 字段；5 MB / 5 s 批
- [x] PG 备份脚本就绪：
  - [x] `ops/backup.sh` —— `pg_dump --format=custom --no-owner --no-acl` → R2 daily/，`rclone delete --min-age 30d` 自动 retention
  - [x] `ops/postgresql.archive.conf` —— `archive_mode=on` + `archive_timeout=300` + `archive_command='rclone copyto %p r2:.../wal/%f'` 给 ≤ 5 min RPO 的 PITR
  - [x] `ops/restore.sh` —— 从 R2 拉 latest 或指定 stamp，DROP+CREATE+pg_restore，强制交互式 `yes` 确认
  - [x] `ops/README.backup.md` —— PG VM / app VM 一次性 setup + recovery drill checklist
- [ ] **(user-owned)** 演练：在 fresh VM 跑一次完整 restore，记下分钟数到 `docs/runbook/backup-restore.md`

##### 安全 / 隐私

- [x] HTTPS only + HSTS（max-age=63072000; includeSubDomains; preload）—— Caddyfile 全局 `security_headers` snippet (sub-A)
- [x] CORS：dashboard 限同源 + ingest 公开 —— api./ingest. site 不同 CORS (sub-A)
- [x] CSP 收紧：dashboard `default-src 'self'; connect-src 'self' api./ingest.` (sub-A)
- [x] secrets 管理：`ops/secrets.md` —— sops + age cookbook（recipient 列表 in `.sops.yaml`，VM 用独立 age key，rotation 流程）
- [ ] **(user-owned)** DDoS：Cloudflare 兜底（CF 控制台 grey/orange 切换 + WAF 规则）
- [x] `docs/legal/privacy.md` + `docs/legal/terms.md`（draft template，需 lawyer review；marketing footer 已加 Privacy/Terms 链）
- [x] PII 默认行为：SDK 不上传 user.email；schema enforce —— SDK `User = {id?, anonymous?}` 已就位 (Phase 1)；server `event::User` 加 `deny_unknown_fields` 强拒 PII；SDK `setUser` JSDoc 明确政策
- [x] 数据导出 API（GDPR 风险预防）：`GET /api/orgs/{slug}/export` —— owner/admin 拿到 org + members + projects (含 tokens metadata + recipients) + pending invites 的 JSON dump，附 `Content-Disposition: attachment; filename=...`（events 全量留 V2，太大）

##### Testing（回填 v0.1 deferred）

- [x] iOS XCTest：`sdk/react-native/ios/Tests/SentoriCrashHandlerTests.swift` —— 通过 `persistForTesting(exception:)` helper 直接驱动 native handler 的 persist 路径（直接 raise NSException 会终止 test runner），断言 `<Documents>/sentori/pending/*.json` 出现 + JSON 反序列化为合法 Event（kind/platform/error.type 匹配）；CI workflow `mobile-e2e.yml::ios-xctest` 走 macOS runner
- [x] Android Robolectric：`sdk/react-native/android/src/test/.../SentoriCrashHandlerTest.kt` —— Robolectric 跑 `installForTesting(ctx)` + `persistForTesting(throwable, thread)`，断言 `<filesDir>/sentori/pending/` 内文件 JSON shape；CI workflow `mobile-e2e.yml::android-robolectric` 走 Ubuntu runner
- [x] mailcatcher 集成测试：`scripts/test-mailcatcher.sh` —— 起 mailpit 容器，注册用户 → notifier 发 verification email → 用 mailpit HTTP API 断言 subject/body 含 verify link；server 加 `SENTORI_SMTP_TLS=plain` env 兼容 mailpit；CI 跑（macOS Docker port-forwarding quirk 在本地可能漏 SMTP banner，Linux runner 无此问题）
- [ ] **(user-owned)** iOS simulator e2e 自动化（`xcrun simctl install` + `launch` + `/v1/events/_recent` poll）—— 工作量大、纯 native build 链路，留作 launch 后 dogfood 用例
- [ ] **(user-owned)** Android emulator e2e 自动化（`adb shell am start`）—— 同上
- [x] minified bundle → `sentori-cli upload sourcemap` → 触发错误 → dashboard 显示原始位置：`scripts/sourcemap-e2e/{run.sh,throw-and-format.js,app.tsx,metro.fixture.config.js}` —— Metro 出 minified bundle + map → cli upload → Node eval bundle 触发 throw → POST 到 server → 拉 admin API + symbolicated=true → 断言 top frame 指向 `app.tsx` 而非 `bundle.js`
- [x] GitHub Actions：`.github/workflows/mobile-e2e.yml` —— 4 jobs (ios-xctest macos-14, android-robolectric ubuntu, mailcatcher with services, sourcemap-e2e)，path filter 限定 `sdk/`、`cli/`、`server/`、`scripts/sourcemap-e2e/` 改动才跑

##### Dogfooding

- [ ] sentori 自己接入 sentori：marketing / dashboard / server 都向自家 prod 报错
- [ ] 跑 ≥ 1 周观察：crash 率、ingestion latency、grouping 准确度、自家邮件告警是否触发

##### Runbook

- [x] `docs/runbook/incident-response.md` —— P1/P2/P3 ladder + on-call rotation + 60s P1 checklist + 显式 NOT-page 列表
- [x] `docs/runbook/scaling.md` —— v0.2 capacity baseline + 横向加 app VM 步骤（更新 Caddy upstream + reload）+ PG vertical resize 阈值表 + 烫手 org 处理（quota first, compute later）+ "我们 yet 不做 autoscaler / 跨 region active-active / SDK 队列"
- [x] `docs/runbook/backup-restore.md` —— 备份矩阵表 + 何时 restore 决策表 + 完整 failover 步骤 + quarterly drill checklist + "Last drill: never" 跟踪
- [x] `docs/runbook/deploy.md` —— pre-flight + cut release + blue/green 滚动（每个 container 间隔 5 min 看 Grafana）+ 双步骤式 destructive migration 模式 + rollback

##### 公开发布

- [x] 改 `marketing/pricing.astro`：去掉 "Beta 邀请制"，开放注册（"$0" 标价 + "Sign up — free →" 直链 `app.sentori.golia.jp/register`，footer 加 Privacy/Terms）
- [x] 写 launch 文章 draft：`docs/launch/show-hn-draft.md`（80 字符 HN 标题 + 体 + 反 obvious-question prep + 跨平台节奏指引）
- [x] 准备 demo 视频脚本：`docs/launch/demo-script.md`（30 秒 storyboard，注册→onboarding wizard→token→dashboard→issue 出现，无 voiceover、burn-in caption）
- [x] 整合 launch checklist：`docs/launch/checklist.md` —— `[code]` vs `[ops]` 标注，跨 Phase 11/12/16 user-owned 全部 inventory
- [ ] **(user-owned)** tag `v0.2.0` + GitHub release notes
- [ ] **(user-owned)** 录视频 + Lawyer review 法律文档 + 配 SPF/DKIM/DMARC + 一周 dogfooding 无 P1
- [ ] **(user-owned)** HN 发文（周二/周三 早上 PT）
- [ ] 🎯 **里程碑：sentori.golia.jp 正式开放**

---

### Phase 17 — SDK 分发链路 + dogfood + qualcomm/insight 真接入

**Goal:** 让 sentori SDK / CLI 从 "git 路径安装" 提升到 "`npm install` / `npx` 一行装"；dashboard onboarding wizard 提供 RN / JavaScript 双 snippet；sentori 自家 web 三个项目接入做 dogfood；最终给 `qualcomm/insight` (Expo RN) 上 sentori。
**Entry:** Phase 16 sub-H ✅。
**Exit:** 任意 RN 或 web 项目能用一行 `bun add @sentori/react-native` (或 `@sentori/javascript`) 装上 + init 即工作；`qualcomm/insight` 在生产抛错能在 sentori dashboard 看到 + symbolicated stack。
**Estimate:** 1.5–2 周。

#### Steps

##### sub-A — `@goliapkg/sentori-react-native` npm publish ✅

实际包名 `@goliapkg/sentori-react-native`（@sentori free org 必须 npmjs.com 网页手动创建；规避到 @goliapkg user-controlled scope；brand 仍是 sentori-react-native）。Expo Config Plugin 路径不需要——现有 `expo-module.config.json` + podspec + android/build.gradle 已让 `expo prebuild` autolink。

- [x] `package.json`：0.0.0 → 0.1.0；license MIT、repo / bugs URL、keywords、publishConfig.access=public
- [x] `files` whitelist 加 `android/src/`、`android/build.gradle`、`ios/`、`expo-module.config.json`、`SentoriReactNative.podspec`（86 files / 32 kB tarball）
- [x] `npm publish` —— 0.1.0 上线；`bun add @goliapkg/sentori-react-native` 安装 verified
- [x] 全仓搜替 `@sentori/react-native` → `@goliapkg/sentori-react-native`：web onboarding wizard 三段 snippet、`docs/{getting-started,sdk-react-native}.md`、`docs-site/src/content/docs/{index,getting-started,sdk-react-native}.{mdx,md}`
- [ ] tag-driven `publish-sdk-rn.yml` workflow（与 sub-B 的 CLI release pipeline 一起做）

##### sub-B — `@goliapkg/sentori-cli` 跨平台 prebuilt binary + npm 包装 ✅

- [x] `.github/workflows/release-cli.yml`：tag `cli-v*` 触发 `cargo build --release` 矩阵 (linux-x64 / linux-arm64 / darwin-arm64)，`.tar.gz` + `.sha256` 传到 GitHub Release。darwin-x64 这次跳过（GH-hosted Intel mac runners 排队 stuck）；cargo install 是 fallback
- [x] `cli/npm/`：thin Node wrapper，bin 走 spawn 子进程，postinstall 按 `process.platform-arch` 下载 release 资产到 `vendor/`，`SENTORI_SKIP_DOWNLOAD=1` 逃生
- [x] `npm install -D @goliapkg/sentori-cli` → 二进制下载、`./node_modules/.bin/sentori-cli --help` 正常输出 Rust CLI help
- [x] `docs/sdk-react-native.md` + `docs-site/.../sdk-react-native.md` sourcemap upload snippet 改成 `npx @goliapkg/sentori-cli upload sourcemap ...`
- [x] README 单独说明 bun 用户需 `bun pm trust @goliapkg/sentori-cli`

##### sub-C — Dashboard onboarding wizard SDK 选择 ✅

- [x] `InstallSdkStep` 加两按钮 picker：React Native / JavaScript（默认 RN）
- [x] `sdkSnippets()` helper 按 SDK 分别返回 `install` + `init` 字符串；CodeBlock 复用，复制体验不变

##### sub-D — `@goliapkg/sentori-javascript` (web + node) ✅

实际包名 `@goliapkg/sentori-javascript`（与 sub-A 的 scope 决定一致）。ESM-only（modern Node + browsers + Bun 都吃；CJS dual-build 收益太薄）。

- [x] `sdk/javascript/`：tsc-only build；零运行时依赖
- [x] 核心 surface：`initSentori` / `captureError` / `captureException` / `setUser` / `getUser` / `addBreadcrumb` / `getBreadcrumbs` / `clearBreadcrumbs`
- [x] 浏览器 hooks：`window.error` + `unhandledrejection`，idempotent
- [x] Node hooks：`process.on('uncaughtException' | 'unhandledRejection')`，**故意不 process.exit**（host 拥 crash policy）
- [x] uuid v7 自实现（crypto.getRandomValues + ms timestamp）；stack regex 同时认 V8 与 SpiderMonkey + URL-style file paths
- [x] transport：browser 优先 `navigator.sendBeacon`（小 body + tab close 存活），fallback `fetch keepalive: true`；4xx/5xx silent drop（v0.1 不带 retry queue）
- [x] bun:test 8 个单测（uuid 形态 + 唯一性、stack v8/spider/url、breadcrumb FIFO 100 cap、captureError 正确 POST shape + cause chain）
- [x] `npm publish @goliapkg/sentori-javascript@0.1.0` 上线；`npm install` 起 ESM import + initSentori + captureError 都通

##### sub-E — mailrs `sentori@golia.jp` 密码改 argon2id ✅

- [x] 用 `debian:13-slim` docker 一次性 + `argon2 -id -m 16 -t 3` 生成 hash
- [x] `docker cp` 写入 mailrs container 的 `/data/users.toml` 替换 `password = "..."` 为 `password_hash = "$argon2id$..."`
- [x] mailrs 重启 + STARTTLS + AUTH LOGIN 探活通
- [x] sentori 端 SMTP_PASS secret 不变（明文密码相同），无需 redeploy
- [x] `ops/secrets.md` 加 mailrs SMTP user 完整轮换 playbook

##### sub-F — Sentori 自家 dogfood ✅

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

##### sub-G — `qualcomm/insight` 接入（Phase 17 的真目的地）

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

##### 实际部署落地（Phase 16 sub-H — 通过 devops infra 接入，而非原计划的"Hetzner + 独立 Caddy"）

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

## v0.1 — self-hosted MVP（Phase 0-10）

从零到 self-hosted v0.1.0：项目方向（0）→ event schema（1）→ server 骨架（2）→ RN SDK JS 层（3）→ E2E smoke（4）→ PG 落库 + grouping（5）→ web dashboard MVP（6）→ RN SDK Native（7）→ sourcemap（8）→ release / 邮件告警（9）→ docker compose + docs（10）。

### Phase 0 — 项目方向对齐

**Goal:** 把所有"非编码决策"一次性定下来，避免后续返工。
**Entry:** 当前会话已有的方向（自研协议 / RN-first / Rust+axum+PG+Valkey / 全 SPA dashboard / sentori.golia.jp 公网）。
**Exit:** 下面所有 checkbox 全勾完，仓库进入 git 管理。
**Estimate:** 0.5 天。

#### Steps

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

### Phase 1 — Event Schema + Token/Ingest 协议初稿

**Goal:** 一份 markdown spec 作为 SDK ↔ Server 双方契约，写死字段、命名、类型、token 格式、ingest URL。
**Entry:** Phase 0 完成。
**Exit:** `docs/protocol.md` 通过 review，包含至少 3 个 example payload + token/URL 设计说明。
**Estimate:** 1 天。

#### Steps

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

### Phase 2 — Server 骨架

**Goal:** `sentori-server` 二进制在 `:8080` 接收 `POST /v1/events`，stdout 打印解析后的 Event。
**Entry:** Phase 1 完成。
**Exit:** `curl -X POST localhost:8080/v1/events -H "Authorization: Bearer st_pk_dev" -d @example1.json` 返回 `202`，stdout 输出结构化 event。
**Estimate:** 1.5 天。

#### Steps

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

### Phase 3 — RN SDK JS 层

**Goal:** `@sentori/react-native` 能在 demo app `init`、捕获 JS 错误、batch 上报到 Phase 2 的 server。
**Entry:** Phase 2 完成。
**Exit:** demo app 调用 `throw new TypeError("test")`，Phase 2 的 server stdout 看到完整 event。
**Estimate:** 1 周。

#### Steps

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

### Phase 4 — 端到端 smoke test

**Goal:** 锁第一个对外 visible 的里程碑——demo app throw → server 收到，建 CI 防回归。
**Entry:** Phase 3 完成。
**Exit:** `bash e2e/run.sh` 一个命令端到端跑通并退出 0（SDK transport ↔ server 协议契约自动验证）。
**Estimate:** 2–3 天。

#### Steps

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

### Phase 5 — PG 落库 + 最小 grouping

**Goal:** 事件落 Postgres，同 fingerprint 归到同 issue。
**Entry:** Phase 4 完成。
**Exit:** 同一段错误连续 throw 5 次，DB 中 `issues` 表 1 行、`events` 表 5 行。
**Estimate:** 1.5 周。

#### Steps

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

### Phase 6 — Web dashboard MVP

**Goal:** 在 `web/` 能登录、选项目、看 issue 列表（dense table）+ 看 issue 详情（event 列表 + stack）。
**Entry:** Phase 5 完成。
**Exit:** 浏览器 `http://localhost:5173` 能看到由 Phase 5 入库的真实事件，键盘 `j/k/Enter` 可用。
**Estimate:** 2 周。

#### Steps

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

### Phase 7 — RN SDK Native 层

**Goal:** iOS NSException + Android 未捕获异常都能落盘 + 下次 JS 启动 flush 上报。
**Entry:** Phase 6 完成。
**Exit:** iOS Swift `NSException.raise(...)` + Android Kotlin `throw RuntimeException(...)`，重启 demo app 后 server 收到事件并在 dashboard 显示。
**Estimate:** 2 周。

#### Steps

##### iOS

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

##### Android

- [x] `sdk/react-native/android/.../SentoriModule.kt`：注册 turbo module
- [x] `sdk/react-native/android/.../SentoriCrashHandler.kt`：
  - [x] `Thread.setDefaultUncaughtExceptionHandler { t, e -> writeToDisk(e); previousHandler?.uncaughtException(t, e) }`
  - [x] 写文件路径：`<filesDir>/sentori/pending/<uuid>.json`
- [ ] Android 单测（JUnit + Robolectric）：同 iOS 双断言
- [x] example app 加按钮 "Throw RuntimeException"
- [ ] Android emu 端到端：throw → 重启 → server 收到 + dashboard 显示

- [x] commit：`feat(sdk): native uncaught exception capture (iOS + Android)`

---

### Phase 8 — Sourcemap 上传 + 服务端符号化

**Goal:** dashboard 中 JS 错误的 stack 显示原始 `src/Form.tsx:42:10`，而非 minified 位置。
**Entry:** Phase 7 完成。
**Exit:** 用 production bundle 触发的错误，dashboard 默认显示原始位置；可切换 raw view。
**Estimate:** 1 周。

#### Steps

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

### Phase 9 — Release / Env / 邮件告警

**Goal:** dashboard 可按 env / release 过滤；新 issue 自动邮件通知。
**Entry:** Phase 8 完成。
**Exit:** 在两个 release 各 throw 一次相同错误，dashboard 显示"出现于 v1 + v2"；新 issue 触发 mailcatcher 收到邮件。
**Estimate:** 1 周。

#### Steps

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

### Phase 10 — Docker compose + 文档 + self-hosted v0.1.0

**Goal:** 一行 `docker compose up` 起完整 sentori，文档够新人 5 分钟上手。
**Entry:** Phase 9 完成。
**Exit:** 全新机器跟着 docs/getting-started.md 5 分钟内能起 sentori 并接入一个 RN demo 看到事件。
**Estimate:** 1 周。

#### Steps

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

### v0.1.0 launch checklist

Phase 0–10 代码层面全部完成（26 commits 落地）。下面是发布 v0.1.0 之前由你拾起的收尾——做完后 Phase 0–10 真正 close，进入 Phase 11（SaaS arc）。

- [ ] 用一台干净 mac 跑 `docs/getting-started.md`，计时 ≤ 5 分钟（来自 Phase 10 line 441）
- [ ] iOS simulator 端到端：`cd sdk/react-native/example && bunx expo prebuild && cd ios && bundle exec pod install && cd .. && bun run ios` → tap "Native crash" → relaunch → server stdout 收到 `platform: ios` 事件（来自 Phase 7 line 358）
- [ ] Android emulator 端到端：`bun run android` → 同上验证 `platform: android` 事件（来自 Phase 7 line 368）
- [ ] `git tag v0.1.0 -m "Sentori v0.1.0 — self-hosted MVP"` + 推 + 写 GitHub release notes（来自 Phase 10 line 442）
- [ ] （可选）self-dogfooding：本地 server 接 1-2 天看 ingestion / grouping / 邮件告警

### v0.1 范围内已 deferred 项（已分配到后续 phase）

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



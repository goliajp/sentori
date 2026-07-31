# 新 Sentori Roadmap(v1 重定位实施)

**创建:2026-07-24。** 设计锚:`design.md`。本文件是**完全线性**的执行 checklist,也是执行状态的唯一事实源。

## 工作方式(读我)

1. **完全线性**:S0 → S9 顺序执行,不并行开段。段内条目也按序做。
2. **段头细化**:执行到某段时,先把该段展开成细步骤(直接编辑本文件,在该段下加子清单),再动手。
3. **计划优先**:发现问题(设计冲突、现状不符、更好路径)先调整本文件/design.md,再继续。不带着已知问题硬推。
4. **Gate 硬约束**:每段末尾的 gate 不绿不进下一段。gate 结果(命令 + 输出摘要)记录在该段的「gate 记录」处。
5. **到位再想**:预注册的待决点(文末)到达对应段时决策,决策写回本文件。
6. 分支:`feature/v1-redesign`(从 develop 拉);每段完成 merge --no-ff 回 develop。S8 用 release 分支。
7. 版本策略:server / webapp / self-host 镜像 → **2.0.0**;RN SDK → **5.0.0**(breaking);expo/cli 各自 major bump。

---

## S0 落盘、清场、修门

- [x] roadmap.md 落盘(本文件)
- [x] 开 `feature/v1-redesign`
- [x] 版本策略定稿(见头部第 7 条)
- [x] 清场 v0.1 尸体:`server/`、`web/`、根 `docker-compose.yml` + `docker-compose.override.example.yml`、`/docker/`、`migrate-tool/`(477+236 tracked 文件,7.4GB 磁盘)
- [x] 删 6 个 Web SDK 包:`sdk/{javascript,react,next,vue,svelte,solid}`(残余引用仅注释,S3 清理)
- [x] 根 `package.json`:workspaces / build:sdks / test:sdks 收缩到 4 包;bun.lock 更新
- [x] CI 收缩:build.yml(sdk matrix 4 包、server-test 去 services/free-disk、infra filter 去 docker/**、加 workflow_dispatch);sdk-perf.yml 去 sdk/javascript;**v0.2-core-check.yml branches 改 feature/\*\***(修「gate 憋到 develop 才爆」的坑)
- [x] preflight 重写:core(fmt/clippy/check)+ self-hosted/server(fmt/clippy/check + lib test)+ rfc3339/orphan + webapp(check)+ 4 包 SDK;check-rfc3339/check-orphan-modules/check-cargo-features 扫描根重指;check-error-docs(扫死目录)暂摘出,S2 重建 error-docs 体系时定
- [x] **gate**:`bun run preflight` 全绿;build.yml 在 feature 分支 workflow_dispatch 跑绿

gate 记录(2026-07-31):
- `bun run preflight` → `✓ preflight green — safe to push`(全链:lockfile / actionlint / core+server fmt+clippy+check / rfc3339 / orphan / webapp check / 4 包 SDK build+test / server 59 bins 测试)
- build.yml run 30623787795(workflow_dispatch @ feature/v1-redesign)→ 8 jobs 全 ✓
- v0.2-core-check run 30623324167(push 自动触发,branches 修复生效)→ ✓ 6m33s(含 testcontainers 集成)
- 途中修真门:check-cargo-features 规则表按 v0.1 写死 rust_crypto,v0.2 合法用 aws_lc_rs → 规则改二选一,正例绿 + 负例红实测

## S1 Schema 从零(五 kind + 单租户)

段头细化(2026-07-31,S0 等 CI 期间展开):

**推送纪律(施工中补)**:S1 完成后**不单独 push / merge** —— migrations 换新后 server 代码仍查旧表,push 会让 core-check 的集成测试红着挂在 remote(「门红着过关」反模式)。S1+S2 改到 server 编译 + 测试绿再一起 push。

- [x] **决策落定**:不建 `spans`(trace 是 events 的一个 kind;APM 语汇随 Sentry 兼容一起废)。不建 `runtime_metrics` 表(metric 流降级为 SDK 侧场景判定信号,不上报;S3 落实删 batch 上报)。不建独立 `replay_sessions`(B 型 replay = event attachment,replay-store 的 PII scrub/gzip 逻辑复用到 attachment 写入路径)。不建 session ping 表。
- [x] 清空 `core/migrations/`(旧 0001-0036 git 里留档),新序列:
  - `0001_identity.sql` — users(id, email uq, password_hash, role CHECK superadmin|admin, display_name, created_at, last_login_at)、sessions(复用 auth-session crate 表形状)、audit_logs(复用 audit-event crate 表形状,去 workspace 列)
  - `0002_projects.sql` — projects(id, name, platform, created_at)、project_assignments(user_id, project_id, assigned_by, created_at, PK(user,project))、tokens(id, project_id, name, scope CHECK ingest|api, secret_hash, created_at, last_used_at, revoked_at)
  - `0003_events.sql` — events(id 客户端预生成, project_id, issue_id, kind CHECK 五值, received_at, occurred_at, release, environment, platform, user_key, payload jsonb;BRIN(received_at),不分区 —— replay tick 已死,量级回落)、issues(id, project_id, fingerprint uq(project,fingerprint), kind, title, status CHECK open|resolved|ignored, first_seen, last_seen, event_count, users_count 广度, max_per_user 深度, assignee_user_id, surface jsonb, resolved_at, resolved_in_release, regressed_at, regressed_in_release)、issue_user_hits(issue_id, user_key, hit_count, last_hit, PK(issue,user_key))— 广度×深度实现核心、issue_activity(id, issue_id, at, actor_user_id nullable, kind CHECK status|assign|note|regression, body)
  - `0004_attachments.sql` — event_attachments(ref, project_id, event_id, kind, media_type, size_bytes, blob_hash, received_at)
  - `0005_releases.sql` — releases(id, project_id, name uq(project,name), created_at)、release_artifacts(id, release_id, kind CHECK sourcemap|dsym|proguard, content_hash, meta jsonb, created_at)、probes(id, project_id, ref, uq(project,ref), issue_id nullable, first_registered_release, last_seen_release, registered_at, last_fired_at, fire_count)、assert_stats(project_id, name, release, pass_count, fail_count, last_pass_at, last_fail_at, PK(project,name,release))
  - `0006_notifications.sql` — notification_prefs(user_id, project_id, on_new_issue, on_regression)
  - `0007_push.sql` — push 系列表机械搬运(去 workspace 列)
- [x] **gate**:空库 migrate 跑通;表形状 vs design.md §2/§9 逐表核对记录

gate 记录(2026-07-31):
- postgres:18-alpine 空库,0001-0007 逐个 `psql -v ON_ERROR_STOP=1` 全过,25 张表建成
- CHECK 约束 pg_constraint 走查:events/issues kind 五值 ✓;issues status 三态 + regressed_* 标记列 ✓;tokens scope(ingest,api)✓;users role(superadmin,admin)✓;release_artifacts kind 三合一(sourcemap,dsym,proguard)✓
- 广度×深度:issues.users_count/max_per_user + issue_user_hits PK(issue,user_key)✓;resolve 锚定 resolved_in_release ✓;probes uq(project,ref)+ fire_count + issue 关联 ✓;assert_stats PK(project,name,release)✓
- 设计决策兑现:无 workspaces、无 RLS、无 spans、无 runtime_metrics、无 replay_sessions、无 email_verifications(无 self-signup);delivery_log 按 notifier crate 真实形状搬运(dedup 全局唯一化)

## S2 Server 核心(执行时细分 2a-2e)

段头细化(2026-07-31,施工中转向记录):

**转向:改造 → 重建。** 2a-i(删 SaaS/billing/OAuth 面 13 文件 + 路由 + state 摘除)做完后确认:AppState 挂的 IngestService/IssueStore/SpanStore/MetricsStore/ReplayStore 全部绑死旧 schema,「带着 30 个旧 handler 剥 workspace」不如「按新 API 面重建 handlers」。旧 handler 大面积删除,保留横切件 + push 系列(机械改)+ auth(裁剪)。bootstrap.rs 已重写为声明式 owner(SENTORI_OWNER_EMAIL/PASSWORD,密码缺省随机生成打日志,email 声明式 reconcile,password 永不覆盖已有账号)。

**新 API 面(全清单,server 的目标形状):**

SDK 面(Bearer ingest-scope token):
- `POST /v1/events` + `/v1/events:batch` — 五 kind 统一入口;assert 聚合计数捎带在 batch envelope(`assertStats` 字段);ingest response 捎带 kill-switch 指令位
- `POST /v1/events/{id}/attachments/{kind}` — replay/screenshot/viewTree/stateSnapshot/logTail
- `POST /v1/deploys`(release 注册)、`POST /v1/releases/{release}/artifacts`(sourcemap/dsym/proguard 上传,触发 retro-symbolication)
- push 系列 11 endpoints 机械保留
- 删除:spans、metrics、track、security、control、heartbeat、sessions、user_reports、cert 相关全部 SDK 端点

AI 面(Bearer api-scope token):
- `GET /api/issues?status=&project=` / `GET /api/issues/{id}` / `GET /api/issues/{id}/bundle`(markdown + json)/ `POST /api/issues/{id}/notes` / `POST /api/issues/{id}/resolve`(body 带 release)

Dashboard 面(cookie session):
- auth:login/logout/me/change-password + reset(密码重置);**无 register/verify/oauth**
- owner 管理:users CRUD、project_assignments、projects CRUD、tokens CRUD(双 scope)、audit 查询、SMTP 状态+测试邮件
- 工作流:issues list(Inbox 排序 = 广度×深度)/detail/resolve/ignore/assign/notes、occurrences、attachments 读(replay 播放)、releases + artifacts 三灯 + probes、instruments(assert_stats/probes/trace 聚合)、stats(pulse:今日新增/回归/crash-free)
- CLI 复用 api-scope 或 session:probe 注册 `POST /admin/api/projects/{id}/probes:sync`(release + refs 清单)

废除 handler 清单(除 2a-i 已删外):spans、metrics、track_query、runtime_metrics_query、user_reports_query、search、self_test、api_describe、cert、alerts + alerts_fire + periodic_alert_worker(规则引擎废,S6 用 notification_prefs)、saved_views、events_live、issue_comments、issue_watchers、replays(重做为 attachment 读)、heartbeat、sessions、security_*、control、track、tenant、sessions_admin(保留——自身会话管理)、notifications(重做为 prefs)、archive_worker(改新表)、probe_worker(endpoint 探活,与新 probe 概念无关,废)、cert-monitor 接线

Crate 处置:event-pipeline 重写(五 kind + fingerprint 规则 + 广度深度 + probe 触发/regression + assert 聚合)、issue-store 重写(三态 + activity + bundle 数据装配)、release-store 实现(stub→真)、ingest-token 改 scope、auth-session 裁剪(去 workspace/verify)、span-store/runtime-metrics/replay-store/saved-view/alert-rule/cert-monitor/integration-traits/workspace-identity/tenant-scoping/billing/stripe-webhook-verify/license-jwt/analytics-store/security-engine/session-store 从 server 依赖中摘除(crate 文件留在 repo,不编译不算账;S9 收尾时统一删目录)

**施工状态(2026-07-31,S2 进行中,供压缩后接续)**:
- 已完成:13 文件 SaaS/billing/OAuth 面删除;39 个废 handler/worker 删除;三个 mod.rs 声明清理;state.rs 重写(thin:pool/source_maps/limiters/attachments/events_bus/mailer);bootstrap.rs 重写(声明式 owner,SENTORI_OWNER_EMAIL/PASSWORD + 随机密码打日志 + email reconcile + password 不覆盖 + 2 单测);main.rs 对齐;Cargo.toml 摘 12 个 crate 依赖加 proguard/dwarf/issue-fingerprint/rand;5 个 sdk handler quota 剥离
- **已完成(第二批)**:①② done;③ session_mw.rs 重写(直接 sqlx,SessionContext{user_id,role,session_id_hash},Role enum superadmin/admin,hash_token 供 auth.rs,auth-session crate 摘除待办);④ src/pipeline.rs 写完(Kind enum、group_identity per-kind fingerprint、锁行事务式 ingest、release 锚定 is_regression(双注册比 created_at,否则 fallback resolved_at 时间)、issue_user_hits 广度深度、probe 触发 + guarded issue 联动 regression、record_assert_stats);⑤ sdk/events.rs(WireEvent camelCase + prepare 含 symbolicate)+ events_batch.rs(envelope events+assertStats,MAX_BATCH 200,逐条 outcome)重写完,**events_batch.rs 是 untracked 新文件,commit 需显式 add**;notifier crate 单租户化完成(lib 16 测试绿,integration fixture 已对新 0001/0002/0006);ingest-token crate 改造完成(TokenKind→Scope ingest|api,st_ 前缀,touch(),去 workspace,all-targets 绿)
- **剩余(cargo check 26 文件,模式已知)**:push 系 11 文件(ctx.workspace_id 删、ProjectId→Uuid、ctx.token_kind→ctx.scope、SQL 去 workspace 列)→ admin/tokens(新 TokenStore.create(project_id, scope, name) 签名)→ admin/projects(新表列 + audit 直接 sqlx)→ ⑥ issues.rs 重写(Inbox 排序 users_count desc + api-scope 闭环 GET/resolve/notes)→ ⑧ auth.rs 裁剪(login/logout/me/change-password/reset only,session 直接 sqlx 写 auth_sessions,用 session_mw::hash_token)→ ⑨ audit.rs / ⑩ projects.rs(assignments 过滤)/ attachments.rs / artifacts_upload.rs(新 release_artifacts 列)/ activity_log.rs(→issue_activity)/ notifications.rs(→notification_prefs)/ sessions_admin.rs / events.rs(dashboard occurrences)→ ⑫ handlers/mod.rs 路由重排 ⑬ archive_worker 新表 ⑭ health.rs;还有 2c bundle.rs + /api scope 面 + 2e dwarf/proguard 接线 + retro-symbolication 未开工
- 注意:core/crates 一批 crate 的 testcontainers 测试 include_str! 旧 migration 文件名,全部红着 —— 摘依赖后 core-check 只测仍被引用的 crate?不对,core-check 在 core/ workspace 全量跑 —— **需要在 core/Cargo.toml workspace members 里摘除废 crate 或修其测试**,gate 前处理

- [x] 2a 单租户化(骨架部分):删 saas_routes / saasadmin_mw / billing / stripe*(代码摘除,Stripe 账号冻结);state.rs 收敛;bootstrap env 声明式 owner;owner/admin 两角色 + project 分配 API(admin API 部分待 ⑦)
- [ ] 2b 五 kind ingest:新 wire 协议、per-kind fingerprint、广度×深度、assert 聚合捎带、probe 注册消费 + 触发→regression、error-in-data
- [ ] 2c issue 体系:三态 + regressed(resolve 锚定 release)、activity/note、api-scope AI 闭环 API(GET issues / GET bundle / POST notes / POST resolve)
- [ ] 2d bundle 生成:markdown + bundle.json;LLM 段可选(ANTHROPIC key 未配则跳过)
- [ ] 2e 符号化接线:sourcemap(已有)+ dwarf-resolver + proguard-resolver 进 ingest;retro-symbolication backfill
- [ ] **gate**:fmt / clippy -D warnings / test(含 testcontainers)全绿;新 API curl 走查脚本通过

gate 记录:(待)

## S3 SDK(两层 + 8 动词 + 铁律门)

- [ ] core 包:五 kind wire types、8 动词骨架、signal ring(breadcrumbs+trail 合并);safe/self-report/coerce-error/uuid 原样保留
- [ ] RN 绑定:40+ 动词 → 8;删 compat/sentry;track/metrics/moments/feedback 并入或砍
- [ ] warn 场景检测最小集(mini-spec 就地写进本段):rage_tap / long_freeze / slow_cold_start / slow_api
- [ ] B 型 replay:native 30s ring(ReplayCapture 改造),error/warn 触发上传
- [ ] 铁律五门:故障注入、API 模糊、init 计时、包体积(perf bench 已有)
- [ ] expo plugin 对齐新 init
- [ ] **gate**:五门进 CI 全绿;rn-example @ sim-sentori 端到端(8 动词 → 本地 server → issue 聚合 → bundle 可拉)

gate 记录:(待)

## S4 CLI

- [ ] probe 静态扫描命令(随 release 上传注册绊线)
- [ ] 全部 upload:失败 exit 0 + 友好提示(后果 + 可复制补救命令)+ `--strict`
- [ ] issue / mcp serve 对齐新 API
- [ ] **gate**:CLI 测试绿;断网 upload 实测 exit 0 + 提示文案

gate 记录:(待)

## S5 Webapp(4 导航)

- [ ] 用 /frontend-design:frontend-design 出视觉设计;IA = design.md §11(Inbox / Instruments / Releases / Settings)
- [ ] 保留 lib 层(api.ts 方法面重写)、i18n 三语、auth 页;删旧 36 页、SaasAdmin、Billing
- [ ] 问题详情 = bundle 叙事页:录屏⊕时间轴合体、栈内源码展开、Copy for AI、守护状态卡
- [ ] Cmd+K、j/k triage、批量操作、空状态 onboarding、四态齐
- [ ] **gate**:bun run check 绿;本地 mock + headless Chrome 截图走查每页四态

gate 记录:(待)

## S6 渠道(email)

- [ ] 新 issue / regression → 邮件(notifier + mailer 复用,正文 = bundle 精简版 + 回链)
- [ ] Settings 个人通知偏好;SMTP 状态区 + 测试邮件按钮
- [ ] **gate**:mailpit 端到端收信;未配 SMTP 降级路径走查

gate 记录:(待)

## S7 Self-host 打包

- [ ] compose 定稿唯一入口(env 面 = design.md §10;_FILE 变体;cookie 密钥自动生成)
- [ ] .env.example / README(客户视角)对齐;镜像 CI 改造
- [ ] **gate**:干净目录 `docker compose up -d` 冷启动 → owner 登录 → 建 project → rn-example 上报 → bundle 可拉,全程只靠 README

gate 记录:(待)

## S8 Dogfood cutover(生产)

- [ ] lx64 新栈部署(devops compose 更新;caddy 走 edit-live → devops import 铁律)
- [ ] sentori.golia.jp 切新栈;deploy.yml 重写(marketing/docs 去留在此决定);prod-drift 对齐
- [ ] insight-mobile 接新 SDK,上传 sourcemap/mapping,种一颗真 probe
- [ ] **gate**:生产真实 crash + warn 各 ≥1 例走完闭环(事件→issue→bundle→email);gh run list 全绿;/healthz version 核对

gate 记录:(待)

## S9 收尾

- [ ] saas/ marketing/ docs-site/ 处置执行;oss-mirror 排除表校准;preflight 最终校准
- [ ] Stripe 摘除确认(账号冻结保留);memory 更新;design.md 台账回填
- [ ] **gate**:三栏交账;残留清单归零或明示

gate 记录:(待)

---

## 到位再想(预注册)

| 待决点 | 决策位置 | 状态 |
|---|---|---|
| iOS dSYM 的 SDK 侧改造深度(可先 sourcemap+mapping 100%,dSYM 随后)| S3 | 未决 |
| spans / runtime_metrics 表去留 | S1 | 未决 |
| SDK npm 包名(@goliapkg vs @sentori org)| S3 发包前问用户 | 未决 |
| marketing 站去留 | S8 | 未决 |
| LLM 段模型与成本参数 | S2d | 未决 |

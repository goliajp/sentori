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
- **里程碑(2026-07-31)**:server `cargo check` 零错误、`cargo test --bins` 32 全绿。已重写/新写:auth.rs(login/logout/me/change/forgot/reset,无 register)、admin/tokens.rs(ensure_project_access 共用守卫)、admin/projects.rs、admin/users.rs(新:owner 管 admin + assignments)、issues.rs(Inbox 排序 regressed 置顶→广度→深度 + occurrences + activity/note)、projects.rs、events.rs(occurrence 详情+附件清单)、attachments.rs(blob 读)、src/audit.rs(best-effort 写入 helper)+ handlers/audit.rs、handlers/mod.rs 路由表重排为新 API 面、artifacts_upload.rs 对新表(KINDS 三值)、archive_worker 裁到两表、push 系全部机械单租户化(push-provider crate 含)、identity_link/symbolicate::prepare/stats.rs 删。
- **S2 尚余**:push 系 11 文件(ctx.workspace_id 删、ProjectId→Uuid、ctx.token_kind→ctx.scope、SQL 去 workspace 列)→ admin/tokens(新 TokenStore.create(project_id, scope, name) 签名)→ admin/projects(新表列 + audit 直接 sqlx)→ ⑥ issues.rs 重写(Inbox 排序 users_count desc + api-scope 闭环 GET/resolve/notes)→ ⑧ auth.rs 裁剪(login/logout/me/change-password/reset only,session 直接 sqlx 写 auth_sessions,用 session_mw::hash_token)→ ⑨ audit.rs / ⑩ projects.rs(assignments 过滤)/ attachments.rs / artifacts_upload.rs(新 release_artifacts 列)/ activity_log.rs(→issue_activity)/ notifications.rs(→notification_prefs)/ sessions_admin.rs / events.rs(dashboard occurrences)→ ⑫ handlers/mod.rs 路由重排 ⑬ archive_worker 新表 ⑭ health.rs;2c 的 /api scope AI 面(GET/POST /api/issues*,复用 issues.rs 逻辑 + api-scope bearer)、2d bundle.rs(markdown+json 装配,LLM 段可选)、2e dwarf/proguard 接线 + retro-symbolication、admin/releases.rs SQL 对新表核查(list_artifacts 旧列名)、clippy -D warnings 清理、S6 前 stats/pulse 端点、testcontainers 集成测试重写(core crates 一批 include_str 旧 migration 仍红:audit-event/auth-session/event-pipeline/issue-store/span-store/replay-store/runtime-metrics/billing/alert-rule/saved-view/tenant-scoping/workspace-identity/push-provider/integration-traits/cert-monitor —— 这些 crate 已不被 server 引用,**core workspace members 收缩**后它们不再编译,或 S9 删目录)
- 注意:core/crates 一批 crate 的 testcontainers 测试 include_str! 旧 migration 文件名,全部红着 —— 摘依赖后 core-check 只测仍被引用的 crate?不对,core-check 在 core/ workspace 全量跑 —— **需要在 core/Cargo.toml workspace members 里摘除废 crate 或修其测试**,gate 前处理

(S2 全项完成,gate 记录见下;CI:core-check 30626914178 ✓ + build.yml 30626998815 ✓ @ remote)
- [x] 2a 单租户化(骨架部分):删 saas_routes / saasadmin_mw / billing / stripe*(代码摘除,Stripe 账号冻结);state.rs 收敛;bootstrap env 声明式 owner;owner/admin 两角色 + project 分配 API(admin API 部分待 ⑦)
- [ ] 2b 五 kind ingest:新 wire 协议、per-kind fingerprint、广度×深度、assert 聚合捎带、probe 注册消费 + 触发→regression、error-in-data
- [ ] 2c issue 体系:三态 + regressed(resolve 锚定 release)、activity/note、api-scope AI 闭环 API(GET issues / GET bundle / POST notes / POST resolve)
- [ ] 2d bundle 生成:markdown + bundle.json;LLM 段可选(ANTHROPIC key 未配则跳过)
- [ ] 2e 符号化接线:sourcemap(已有)+ dwarf-resolver + proguard-resolver 进 ingest;retro-symbolication backfill
- [ ] **gate**:fmt / clippy -D warnings / test(含 testcontainers)全绿;新 API curl 走查脚本通过

gate 记录:(待)

## S3 SDK(两层 + 8 动词 + 铁律门)

段头细化(2026-07-31):

**wire 契约锚(server 已定,S2 走查实测)**:`POST /v1/events` 单发 / `POST /v1/events:batch` envelope `{events: WireEvent[], assertStats: [{name, release, passDelta, failDelta}]}`。WireEvent camelCase:`{id?, kind, occurredAt(rfc3339), platform(javascript|ios|android), release, environment, name?(warn/trace/assert name, probe ref), surface?({screen,element}), userKey?(SDK 侧 salted hash), payload}`。payload.error.stack 帧:`{file, function, line, column, inApp}`;payload.signals = ring 数组。响应:`{eventId, issueId, isNewIssue, regressed}` / batch `{accepted, outcomes[]}`。attachment:`POST /v1/events/{id}/attachments/{kind}`(replay|screenshot|viewTree|stateSnapshot|logTail)。token 前缀 `st_`。

**施工序(细分 3a-3f)**:
- [ ] 3a core 包重写:types.ts 对上述 wire(删 Breadcrumb/Span/Push wire 类型);signal-ring.ts(breadcrumbs+trail 合并,有界环,签名 `pushSignal(kind, data)`);8 动词接口定义;**保留原样**:safe.ts/self-report.ts(自杀开关)/coerce-error.ts/uuid.ts/logger/sampling/session
- [ ] 3b RN 绑定瘦身:index 公开面 40+ → 8 动词 + ErrorBoundary;init.ts 重写(ingestUrl 必填可配,GOLIA 自己实例填 sentori.golia.jp);capture.ts → 五 kind 发射器;transport.ts 适配新 batch envelope(assertStats 捎带、离线队列保留);删 compat/sentry、track/metrics/moments/measure/feedback*/trust-score/report-security/heartbeat/control-channel/state-snapshots/sample-profiler/runtime-metrics*(场景信号源除外);navigation/network 改为 signal ring 供给者
- [ ] 3c warn 场景检测最小集(mini-spec 就地):rage_tap(native touch 序列,≥3 tap/1s/30px)、long_freeze(HangWatchdog/AnrWatchdog ≥2s)、slow_cold_start(MobileVitals >3s)、slow_api(network.ts p95 >3s 按 endpoint)——每个:判定阈值 + surface + payload.signals 附 ring
- [ ] 3d B 型 replay:ReplayCapture 改 30s 滚动 ring(内存),error/warn 触发打包上传 attachment(kind=replay);replay tick 上报路径删除
- [ ] 3e 铁律五门:故障注入套件(server 500/断网/坏 token → host 零影响)、API 模糊(null/循环引用/巨对象/init 前调用)、init 计时(<50ms 预算)、包体积 gate(CI);perf bench 已有
- [ ] 3f expo plugin 对齐新 init 签名;probe 的 babel 无关(CLI 静态扫描,S4)
- [x] **gate**:五门全绿;SDK→server 端到端(8 动词 → 本地 server → issue 聚合 → bundle 可拉)

gate 记录(2026-07-31):
- 五门:故障注入+API模糊+init计时 = iron-rule.test.ts 7 测试绿;包体积 = check-sdk-size.sh(built .js:core 56/100KB、RN 176/200KB)进 preflight;perf bench 已在 sdk-perf.yml。preflight 全链 `✓ green`
- 端到端(bun 运行时,编译后 lib 直跑):真 SDK init/user/context + 五动词 → 真 transport(batch envelope)→ 本地 server → **9/9 检查过**:五 kind 全部正确分组、userKey 驱动广度、bundle 含 stack + What-the-user-was-doing(ring signals 打包实证)、native 模块未 bound 时优雅降级(铁律实证)。DB 落库验证:assert_stats(5 pass/1 fail)、probes(SENT-E2E fire_count=1)
- **gate 调整(到位再想)**:模拟器端到端(native 桥:crash handler / replay capture / watchdog)移到 S8 dogfood 前置 —— insight-mobile 接入时必须真机验证(Android verify rig + sim-sentori),在那里一次做全。native .swift/.kt 本段未改(native-pending.ts JS 侧转换器兼容旧格式,规避 native-not-in-preflight 的漏发风险)
- rn-example App.tsx 重写为 8 动词走查页(每动词一按钮 + long_freeze 阻塞按钮 + RageTapCapture 包裹)

**S9 追加待办**:dependabot 报 default branch 1 个 high 漏洞(https://github.com/goliajp/sentori/security/dependabot/13)—— master 老依赖,S8 cutover 后处理

- [x] (原粗清单并入上方 3a-3f)core 包:五 kind wire types、8 动词骨架、signal ring(breadcrumbs+trail 合并);safe/self-report/coerce-error/uuid 原样保留
- [ ] RN 绑定:40+ 动词 → 8;删 compat/sentry;track/metrics/moments/feedback 并入或砍
- [ ] warn 场景检测最小集(mini-spec 就地写进本段):rage_tap / long_freeze / slow_cold_start / slow_api
- [ ] B 型 replay:native 30s ring(ReplayCapture 改造),error/warn 触发上传
- [ ] 铁律五门:故障注入、API 模糊、init 计时、包体积(perf bench 已有)
- [ ] expo plugin 对齐新 init
- [x] **gate**:五门全绿;SDK→server 端到端(8 动词 → 本地 server → issue 聚合 → bundle 可拉)

gate 记录(2026-07-31):
- 五门:故障注入+API模糊+init计时 = iron-rule.test.ts 7 测试绿;包体积 = check-sdk-size.sh(built .js:core 56/100KB、RN 176/200KB)进 preflight;perf bench 已在 sdk-perf.yml。preflight 全链 `✓ green`
- 端到端(bun 运行时,编译后 lib 直跑):真 SDK init/user/context + 五动词 → 真 transport(batch envelope)→ 本地 server → **9/9 检查过**:五 kind 全部正确分组、userKey 驱动广度、bundle 含 stack + What-the-user-was-doing(ring signals 打包实证)、native 模块未 bound 时优雅降级(铁律实证)。DB 落库验证:assert_stats(5 pass/1 fail)、probes(SENT-E2E fire_count=1)
- **gate 调整(到位再想)**:模拟器端到端(native 桥:crash handler / replay capture / watchdog)移到 S8 dogfood 前置 —— insight-mobile 接入时必须真机验证(Android verify rig + sim-sentori),在那里一次做全。native .swift/.kt 本段未改(native-pending.ts JS 侧转换器兼容旧格式,规避 native-not-in-preflight 的漏发风险)
- rn-example App.tsx 重写为 8 动词走查页(每动词一按钮 + long_freeze 阻塞按钮 + RageTapCapture 包裹)

gate 记录:(待)

## S4 CLI

- [x] probe 静态扫描命令:`probes sync --release <r> --dir .`(扫 `probe('REF')` 跨引号风格 + 去重 + 跳过 node_modules/dist;server 补 `POST /api/probes:sync` 端点,api-scope,upsert first/last_seen_release)
- [x] 全部 upload:统一走 `POST /v1/releases/{r}/artifacts`(multipart);lenient.ts 契约(失败 exit 0 + 四要素提示 + `--strict`);dsym 保留 dwarfdump slice 解析,slice 身份暂存 artifact name(dwarf 接线 S8);source-bundle 命令删(Related code 走 git 集成,design 已定)
- [x] issue 命令对齐 /api 面(list/resolve/note/bundle;silence/close 随三态状态机废);**mcp serve 重写为 4-tool /api 版**(issue_list/issue_bundle/issue_note/issue_resolve —— AI 闭环 1:1),协议框架保留
- [x] **gate**:CLI 测试绿;断网 upload 实测 exit 0 + 提示文案

gate 记录(2026-07-31):
- CLI 20 测试全绿(lenient 契约 3、probes 扫描 3、mcp 面 3、native-artifacts 8、react-native 3),typecheck 0 错
- 断网实测(--api-url http://127.0.0.1:1):默认 **EXIT=0** + 完整四要素提示(不挡 build / 影响 / 可复制补救命令 / 回填承诺);`--strict` **EXIT=1**

## S5 Webapp(4 导航)

- [x] 用 /frontend-design:frontend-design 出视觉设计;IA = design.md §11(Inbox / Instruments / Releases / Settings)
- [x] 保留 lib 层(api.ts 方法面重写)、i18n 三语、auth 页;删旧 36 页、SaasAdmin、Billing
- [x] 问题详情 = bundle 叙事页:录屏⊕时间轴合体、栈内源码展开、Copy for AI、守护状态卡
- [x] Cmd+K、j/k triage、批量操作、空状态 onboarding、四态齐
- [x] **gate**:bun run check 绿;本地 mock + headless Chrome 截图走查每页四态

gate 记录:2026-07-31。`bun run check` 绿(0 errors;i18n 112 keys × 3 locales all referenced;no hard-coded prose)。真栈走查(cargo 编译 server :18099 + postgres 容器 + 真 SDK 五 kind seed + probes:sync),CDP 注入 session cookie 截图并逐张目检 16 态:login(dark 卡片)、forgot(hint 文案修正)、inbox(filled/empty/error/loading 四态)、issue-detail(open + resolved 守护状态卡 + activity)、instruments(assert 红点/probe 红绿/trace)、releases(三灯 + 空态)、settings(projects/tokens/audit tabs)、j/k 光标 + x 勾选批量条、Cmd+K palette。走查中修 4 处:登录/forgot 全局 initTheme()(dark 首屏)、forgot 说明文案误用 resetSent、login 无卡片容器、role 裸显 superadmin(显示层映射所有者/管理员)。server 侧 fmt/clippy -D warnings/32 tests 绿。

## S6 渠道(email)

细步骤(2026-07-31 到段展开):

- [x] 6a mailer.rs 暴露 transport/状态;state 组 NotifierService(EmailTransport 注册,delivery_log + dedup 复用 0006)
- [x] 6b notify.rs:spawn_issue_notification(fire-and-forget;收件人 = owner + project assignees − prefs opt-out;dedup_key 按 issue+user+事由;正文 = bundle 精简版 + `SENTORI_BASE_URL` 回链);events.rs + events_batch.rs 接线
- [x] 6c admin API:GET /admin/api/smtp(状态)、POST /admin/api/smtp/test(发给当前用户)、GET/PUT /admin/api/notification-prefs(per-project 两开关,无行 = 全开)
- [x] 6d webapp Settings 加「通知」tab:per-project 开关 + SMTP 状态卡 + 测试邮件按钮;i18n ×3
- [x] **gate**:mailpit 端到端(新 issue 一封、regression 一封、test 按钮一封,校验正文回链);未配 SMTP 全降级走查(ingest 不受影响、UI 状态区提示)

gate 记录:2026-08-01。mailpit(:51025/:58025)+ postgres + SMTP-配置 server 端到端:新 error → `[sentori/mailtest] New: error — Error` 一封(正文含 impact/seen-in/回链);resolve 锚定 mt@1.0.0 后同 fingerprint 在 mt@1.1.0 再现 → Regression 一封(正文含 "was resolved in mt@1.0.0 — this recurrence reopened it");POST /admin/api/smtp/test → 第三封。PUT prefs onNewIssue=false 后新 fingerprint ingest → 邮件数不变(opt-out 生效,且 UI 通知 tab 截图勾选状态与之一致)。途中修 notifier crate 邮件 charset(lettre 无显式 ContentType 时 UTF-8 标点 mojibake → singlepart + TEXT_PLAIN;crate 16+2+1 tests 绿)。未配 SMTP 栈:GET smtp configured:false、POST test 409、ingest 正常、prefs API 正常、boot 仅 WARN。正文组装重构后重跑一封端到端核对一致。server fmt/clippy -D warnings/32 tests 绿;webapp check 124 keys 绿。

## S7 Self-host 打包

细步骤(2026-08-01 到段展开)。注:design §10「cookie 密钥自动生成存卷」已被 DB-backed session token 方案自然消解 —— server 无 cookie 密钥可管理,该条标不适用:

- [x] 7a server:`env_or_file` helper(SENTORI_DATABASE_URL / SENTORI_OWNER_PASSWORD / SENTORI_SMTP_PASS 支持 `_FILE` 变体);`sentori-server reset-password <email>` 子命令(design §10 owner 忘密码路径,不依赖 SMTP;顺带清空该账号全部 session)
- [x] 7b compose 定稿:9-env 面(必须 3:POSTGRES_PASSWORD 组装 DSN / OWNER_EMAIL / BASE_URL;SMTP 6 可选),清掉旧名(SESSION_SECRET / BOOTSTRAP_*);db + data 卷;prebuilt image + build fallback
- [x] 7c `.env.example` 新写(9 env 带注释;高级面注释掉)
- [x] 7d `self-hosted/README.md` 客户视角重写(冷启动、反代、reset-password、SDK 接入四步)
- [x] 7e 镜像 workflow 校准(v0.2-self-hosted-image.yml → selfhosted-image.yml;paths 修正)
- [x] **gate**:干净目录 `docker compose up -d` 冷启动 → owner 登录 → 建 project → SDK 上报 → bundle 可拉,全程只靠 README;`_FILE` 变体 + reset-password 实测

gate 记录:2026-08-01。镜像本地构建 69.6MB(<100MB 目标内,distroless + bundled SPA)。冷启动走查(scratchpad 干净目录,只按 README 步骤):cp .env.example → 填 3 必须值(owner password 留空走生成路径)→ up -d → 日志抓生成密码 → 登录 → 建 project → 双 token → **真 SDK**(编译产物)8 动词上报 → /api 校验 9/9(五 kind 分组、breadth、bundle stack/signals/in-app)。途中修 2 个冷启动才暴露的问题:postgres:18 镜像拒绝 /var/lib/postgresql/data 挂载点(改挂 /var/lib/postgresql);distroless nonroot 下 named volume /data 会 root 属主(Dockerfile 烘焙 --chown skeleton)。reset-password 双路径实测(compose exec + `SENTORI_DATABASE_URL_FILE` 挂 secret 的 docker run,后者同时验 _FILE 变体),旧 session 401、新密码 200。server fmt/clippy/37 tests 绿(+5 env_config)。注:macOS 下 `localhost:8080` 走 IPv6 会 connection reset,`127.0.0.1` 正常 —— docker-proxy 行为,非产品问题。

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
| iOS dSYM 的 SDK 侧改造深度(可先 sourcemap+mapping 100%,dSYM 随后)| S3 → S8 | 已决:dSYM 切片身份先乘 artifact name,dwarf 接线随 S8 |
| spans / runtime_metrics 表去留 | S1 | 已决:不建;trace 进 events |
| SDK npm 包名(@goliapkg vs @sentori org)| 发包前问用户 | 未决(S8 发包前问) |
| marketing 站去留 | S8 | 未决 |
| LLM 段模型与成本参数 | S2d | 未决 |

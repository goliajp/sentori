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
- [ ] **gate**:`bun run preflight` 全绿;build.yml 在 feature 分支 workflow_dispatch 跑绿

gate 记录:(待)

## S1 Schema 从零(五 kind + 单租户)

- [ ] 决策:spans / runtime_metrics 表去留(倾向:不建 spans;runtime_metrics 保留待议)
- [ ] 清空 `core/migrations/`,新 0001 系列,表清单:
  - users(role: superadmin|admin)、sessions
  - projects、project_assignments、tokens(scope: ingest|api,named,多个)
  - events(kind: error|warn|trace|assert|probe)、issues(open|resolved|ignored + regressed_at/regressed_in_release + resolved_in_release + 广度深度列)、issue_activity(系统事件 + note)
  - event_attachments、releases、release_artifacts(sourcemap|dsym|proguard)、probes(release 注册表)、assert_stats
  - audit_logs、notifications;push 表机械保留
- [ ] **gate**:空库 migrate 跑通;表形状 vs design.md §2/§9 走查一致(逐表核对记录)

gate 记录:(待)

## S2 Server 核心(执行时细分 2a-2e)

- [ ] 2a 单租户化:删 saas_routes / saasadmin_mw / workspace-identity / tenant-scoping / billing / stripe*(代码摘除,Stripe 账号冻结);state.rs 收敛;bootstrap env 声明式 owner;owner/admin 两角色 + project 分配 API
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

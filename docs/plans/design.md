# Sentori 总设计(2026-07 重定位)

**日期:2026-07-24**。本 doc 是 2026-07-23/24 产品重定位讨论的收束,是后续一切实施的锚。子设计 doc:`bundle-schema.md`(bundle 结构)、`native-symbolicate.md`(符号化)、`backlog.md`(挂起项)。文末「决策台账」区分了已钉死 / 工作假设 / 明确悬置。

---

## 1. 产品身份

> **Sentori — errors + warnings monitoring for mobile apps, AI-native bug report supply chain.**

- **只做 mobile**(RN 一等公民)。Web 明确不做,限定即武器(Instabug 模式)。
- **只做 self-host**。不做 SaaS(2026-07-24 决定,「之前想多了搞复杂了」)。分发形态 = 一份 docker compose。
- **AI 是一等消费者**。产品的核心产物是 **bundle** —— 一份「读完就够修」的 LLM-ready 事件报告。SDK / server / dashboard 全部为 populate bundle 服务。
- **自包含**。Sentori 内建 issue 体系是事实源;Jira / email 只是可选的订阅渠道。没配任何外部集成的 Sentori 是完整产品。
- 对比 Sentry 的差异化:不做全能观测(8 pillar 都浅),在 mobile 稳定性一条线上做深 —— 亚健康检测、JS↔Native 穿透、回归探针、AI-ready bundle 都是竞品没有或很浅的。

## 2. 概念模型:五 kind

**完全打破 Sentry 兼容** —— wire protocol、概念、API 词汇都不继承(capture* 动词族、breadcrumb、DSN、severity levels 全部废除)。

每个 kind 对「坏」的时间关系不同,五类互斥无模糊地带:

| kind | 一句话 | 时间关系 | 产生方 | issue 分组(fingerprint)|
|---|---|---|---|---|
| `error` | 已经坏了 | 现在 | SDK 自动(crash / 未捕获异常 / 致命 ANR)+ `sentori.error()` 兜底 | 符号化后的栈(inApp 帧)+ error type |
| `warn` | 用户正在不舒服(亚健康)| 正在逼近 | SDK 场景检测 + `sentori.warn(name)` | 检测型:(category, scenario, surface);手写型:name |
| `trace` | 开发者想观察的中性点 | 无关坏 | `sentori.trace(name)` | name |
| `assert` | 这里应该成立(生产断言)| 应然 | `sentori.assert(name, ok)` | name |
| `probe` | 曾经的 bug 的哨兵(回归绊线)| 过去 | `sentori.probe(ref)` | ref |

DB enum 直接用动词名:`kind IN ('error','warn','trace','assert','probe')`。

**存量概念迁移**:`anr` → 致命归 `error`、可恢复冻结归 `warn`;`near_crash` → `warn` 各 scenario;`message` → 删除,`trace` 原生接任,无 alias。

### 重要性:客观计算,不主观声明

没有 severity 分级。issue 层两个客观维度:

- **广度** —— unique users 数
- **深度** —— 每用户重复次数(p50 / max)

展示:「23 users × median 2 次,最惨一人 47 次」。1000 人各 1 次(广度问题)和 1 人 1000 次(边缘环境问题)是不同诊断,数字摆着让客户/AI 自己判断。`payload.severity` 可作 hint 字段存在,但不参与分类。

### 回归探针(probe)—— 最强差异化

绊线语义:**调用即触发**(「这行代码不该被执行到」),不是声明式条件。闭环:

```
bundle → AI 修 bug → AI 在曾出 bug 的分支种 sentori.probe('SENT-123')
       → 上线 → probe 静默 N 天 = 修复被生产验证(可提示拆线)
       → probe 触发 = issue 自动 regressed + 重新生成 bundle(带新证据)
```

- ref 收自由字符串;命中 issue id 时自动挂闭环,否则当独立哨兵
- **沉默可见性**:CLI 在 release 上传时静态扫描 `sentori.probe()` 调用,把 ref 列表注册到 release —— server 因此知道哨兵存在,能区分「安静」和「被删」
- 语义级回归检测,不依赖栈 fingerprint 跨版本稳定

### assert 的存活证明

pass 不逐条上报:本地计数、随下一个事件捎带聚合数。Dashboard 显示「跑了 45k 次,挂了 3 次」—— 存活证明 + 失败率,零心跳流量。fail 立即上报(带 data 上下文)。

## 3. Warning(亚健康)定义

> **Warning event(中文:亚健康事件)**:app 运行中出现「值得知道,但未构成 error」的情形。以**用户体验出现异常**为判定基准(UX 摩擦、资源异常、网络/服务端质量、性能降级),**不按技术根因或团队归属区分** —— 用户会不舒服就算。

边界(工作假设,见台账):
- 与 crash **严格互斥**(crash 是 error,不是 warning 的最右端)
- **感觉为准**:用户没感知的纯 metric 不算事件(metric 可作为场景判定的信号)
- **SDK 能被动检测的才进自动范畴**:业务逻辑 bug(价格算错)走客户手写通道,不是自动检测承诺

### 六大类(category)

| category | 用户感受 | scenario 示例 |
|---|---|---|
| A. Interaction | 按了没反应 / 反应慢 / 反复按 | dead_button / sluggish_button / useless_button |
| B. Freeze | 卡住了 / 死了几秒 | brief_freeze / long_freeze(near-ANR)/ scroll_stutter |
| C. Loading | 转圈不完 / 空白等半天 | slow_api / infinite_loading / slow_cold_start / blank_screen |
| D. Navigation | 走错路 / 出不去 | u_turn / nav_trap / broken_deep_link |
| E. Resource | 耗电 / 发热 / 流量异常 | battery_drain / memory_pressure / thermal_serious |
| F. Data / Trust | 输的东西没了 / 提交没反应 | input_eaten / silent_submit_failure |

每个 scenario = 多个原子信号(touch 序列 / 主线程 / 网络计时 / nav 路径)的组合模式,由 SDK 侧规则判定后**封成场景事件上报**。scenario 逐个写 mini-spec(判定阈值 / 采集数据 / fingerprint / bundle 呈现)—— 待做,先从 A/B/C 的核心场景开始。

## 4. API 面(全 SDK 就这 8 个动词)

```ts
// 基础
sentori.init(config)              // 唯一配置入口
sentori.user(u | null)            // 当前用户;驱动广度×深度
sentori.context(patch)            // 环境状态(AB 实验 / flags / tags)

// 事件(动词名 = kind 名)
sentori.error(err, data?)         // 出了什么事?(自动抓取是主路径,这是兜底)
sentori.warn(name, data?)         // 用户哪里不舒服?
sentori.trace(name, data?)        // 这里发生了什么?
sentori.assert(name, ok, data?)   // 这里应该成立吗?
sentori.probe(ref, data?)         // 那个 bug 回来了吗?
```

**语义硬约束(铁律派生):**
- 8 动词全部**同步、无 Promise、不可能 throw**。同步路径只做 O(1) 入队
- `assert` 失败只上报,**永不中止程序**(与语言级 assert 的根本区别,文档放大写)
- `probe` 纯记录,不改变控制流
- init 失败 = 全体动词降级 no-op(最多一条 console.warn)
- 事件动词同步返回本地预生成的 event id

**扩展规则:**
1. 每个事件动词末尾保留 `opts` 参数位(目前只有 `trace` 用:`{ quiet: true }` 只进 ring 不上报)
2. 行为配置全部住 `init`(场景检测开关/阈值、replay buffer 秒数)
3. 新能力 = 新名词,永不重载五动词;第六个 kind 必须先在概念模型挣到位置
4. **Error-in-data 约定**:data 里任何 `Error` 实例自动完整序列化(stack + cause 链)—— `sentori.warn('pay.retry', { error: e })` 不需要专门 API

**Breadcrumb 概念消失**,由两样接任:自动信号(nav/http/touch/生命周期)进本地 ring + trace 事件同时进 ring。error/warn 触发时,ring 最近 30 秒打包进 bundle。

**SDK 总纲:平时安静,出事时完整。** 常态下几乎不发网络请求;只有五 kind 的「事」发生时,带完整上下文出门。

## 5. Replay:B 型(on-error)

- SDK 端 30 秒滚动 wireframe buffer(内存,原生层维护)
- error / warn(可配哪些 scenario)触发时打包上传为 attachment
- 不做 always-on session replay(那是 FullStory/UXCam 的市场,买家是 PM 不是 engineer)
- Bundle 内嵌 3-5 张关键帧的**文字 wireframe 描述**,LLM 不解析二进制也能读 UI 状态

## 6. 铁律:Client 零成本(四维)

正式文本在 `.claude/CLAUDE.md`(2026-07-24 钉死)。摘要:

1. **Perf 零影响** — 主线程 <1%、单 tick >5ms 标红、默认保守
2. **Net 零可感** — 平时安静;批量 + 压缩
3. **失败零传染** — 任何 Sentori 失败绝不中止/阻塞/改变业务流程;**build-time 同样适用**:CLI / build phase 上传(dSYM/mapping/sourcemap/probe 扫描)失败默认 exit 0 不挡 release + 友好提示(说清后果 + 可复制补救命令)+ `--strict` opt-in;配套 **retro-symbolication**(补传后对已存未符号化 events 回填重跑)
4. **Footprint 有界** — 包体积 / 内存 buffer / 磁盘队列硬上限

自杀开关:SDK 自身异常超阈值 → session 内降级 no-op;远程 kill switch 由 ingest response 捎带。

**五个门**(缺门不 ship):故障注入套件、API 模糊测试、perf 对比 bench、init 计时、包体积检查。

## 7. SDK 架构与 client 矩阵

**两层结构**:native core(石头)+ 框架绑定(薄):

```
绑定层:react-native │ ios │ android │ (flutter)
core 层:sentori-ios (Swift) / sentori-android (Kotlin)
```

crash 捕获、freeze/ANR watchdog、cold start 计时、**warning 场景检测**、B 型 replay、磁盘队列/传输全部住 core → **每个新 client 免费继承**。绑定层只做:语言层 error 捕获、五动词绑定、语言↔Native 穿透。

| Tier | Client | 状态 |
|---|---|---|
| 1(现在)| RN + Expo(必须出 config plugin)| 既有,待按新 API 重构(第一天就按两层写)|
| 2(core 抽出后顺产)| 纯 iOS / 纯 Android | 无;iOS 一行 `Sentori.start(token:)`,Android gradle + manifest 零代码(ContentProvider 自动 init)|
| 3(以后)| Flutter | 悬置(见台账)|
| 不做 | Web / KMP / Unity / MAUI | 定位声明 |

**API parity 硬规则**:8 动词在所有 client 名字、语义、签名一致,文档写一份。

非 runtime 件:CLI(上传 + probe 扫描)、expo config plugin。

## 8. 符号化与 JS↔Native 穿透

详见 `native-symbolicate.md`。要点:

- dSYM(iOS)/ ProGuard mapping(Android)必须 app 侧上传(生态硬约束),竞争在集成 UX:Xcode build phase 一行 / Gradle plugin 一句 / fastlane / CI action + dashboard 缺料诊断提示
- 上传失败不挡 release(铁律),配套 retro-symbolication
- 100% 符号化是 bundle stack 段的硬指标;没有它,fingerprint 跨版本不稳,issue 聚合 / regression 检测 / 广度深度统计全部失灵 —— **这是产品基础,不是 nice-to-have**
- JS↔Native 穿透 = backlog B-01(JS 侧 ring + Native 侧 ring + crash 时 ±1s 合并),依赖符号化先行

## 9. Self-host 体系

```
Sentori 实例(一套 compose = 一个客户)
├─ owner(superadmin)×1:env 声明式;建/删 project、建/删 admin、分配、全局设置
├─ admin ×N:只看/管被分配的 projects(project_assignments 表)
└─ project ×N ─ token ×N
```

- `users.role IN ('superadmin','admin')`,扩展留给 enum 加值
- **无 RLS、无 workspaces、无 self-signup、无 OAuth**(单租户,应用层 `WHERE project_id IN (...)` 足够)
- **token**:project 级,多个 named token(name / created_at / last_used_at,轮换友好),**双 scope**:
  - `ingest` — SDK 写事件
  - `api` — automation / AI agent:读 issue、拉 bundle、改状态、追 note

### 自包含 issue 体系(事实源)

| 组件 | 设计 |
|---|---|
| 聚合 | event → fingerprint → issue(五 kind 各有规则)|
| 状态机 | `open → resolved →(regressed 自动回 open)` + `ignored`,就这些 |
| 分配 | assignee = admin |
| Activity 流 | append-only:系统事件 + note(人/AI 追加)。不是评论系统;为 AI 回写而存在 |
| Bundle | issue 的 AI-ready 导出物:dashboard 查看/下载、API 拉取、随渠道分发 |

**AI 自包含闭环**(无 Jira 也完整):

```
GET  /api/issues?status=open
GET  /api/issues/:id/bundle
POST /api/issues/:id/notes        ← 「fixed in abc123, probe planted」
POST /api/issues/:id/resolve
```

### 渠道层(全部可选,订阅 issue 体系)

- **Email**(SMTP 配了就有):新 issue / regression,正文 = bundle 精简版 + 回链
- **Jira**(配了就推):深度悬置(见台账)
- Webhook / Slack:不做,订阅者模式留扩展

## 10. 部署形态

- **一个应用镜像**(server 内嵌 webapp 静态文件)+ postgres,两个服务
- TLS 留给客户反代;`SENTORI_URL` 填 https
- 配置面 = 9 个 env(必须 3 + SMTP 可选 6),带密码的支持 `_FILE` 变体;cookie 密钥自动生成存卷
- owner 声明式:email 变更即更新;password 只在账号不存在时生效
- SMTP:启动不校验、失败不影响主流程、管理页状态区 + 测试邮件按钮;owner 忘密码走 `docker compose exec … reset-password`(不依赖 SMTP)

```yaml
services:
  sentori:
    image: sentori/sentori:latest
    ports: ["8080:8080"]
    env_file: .env
    volumes: ["sentori-data:/data"]
    depends_on: [db]
  db:
    image: postgres:18
    volumes: ["sentori-db:/var/lib/postgresql/data"]
```

## 11. Webapp 功能设计

**立法:反 data pool 三原则**(之前整体重做的根因,不再犯):

1. 每个页面回答一个**工作流问题**,不展示表。答不出「用户来这页要干什么」的页面不存在
2. **事件没有全局浏览器**。event 只作为 issue 的实例存在,永远从 issue 进入
3. **图表最小化**。数字优先;分布只在它是诊断信号时出现(「47 次里 100% iOS 18.2」窄分布自动高亮 —— 线索,不是图表)

技术栈保留:React SPA + GDS(dark-native)+ 三语言 i18n。

### IA:4 个主导航

```
[Project 切换]
├─ Inbox        「现在该处理什么?」    ← 默认页
├─ Instruments  「我埋的装置怎么样了?」 ← trace / assert / probe 合一
├─ Releases     「这个版本发得健康吗?」
└─ Settings     (管理面;admin 仅见个人节)
```

- **Inbox**:error + warn 同箱(徽章区分 `💥 TypeError` / `⚠ dead_button @ /checkout`);排序 = 广度×深度;分组 **Regressed(红,永远置顶)→ New → Open**;过滤用几个 chip(kind/category/release/assignee/状态),**不做 query builder**;顶部一条窄 pulse(「今日:3 新 · 1 回归 · crash-free 99.2%」,点不开,无图表页);多选批量 resolve/ignore/assign
- **问题详情 = bundle 的 interactive 版**,纵向叙事流不 tab 化,右侧固定行动栏:
  - Summary(LLM 段)→ **Stack + 源码反查**(帧内就地展开 ±N 行源码,inApp 高亮,JS↔Native 边界标出;缺 dSYM/mapping → 黄条 + 可复制上传命令)→ **录屏⊕时间轴(同一个组件**,wireframe 播放器与 nav/tap/http/trace/rage 标记时间轴同步游标,warn 的录屏与 error 同权重)→ 环境(窄分布高亮)→ 回归历史(生命线)→ Occurrences(默认收起,只从这里看实例)→ Activity + notes
  - 行动栏:assign / resolve / ignore / + note / **★ Copy for AI**(一键 bundle markdown 进剪贴板 + 等价 curl 命令)/ 守护状态卡(关联 probe 静默 N 天 ✓;无 probe 提示「建议种绊线」)
- **Instruments**:assert(存活/失败率,失败链到 issue)、probe(每 release 绊线清单、静默天数、触发历史)、trace(按 name 计数/最近出现,只答「走到过吗、量级」)
- **Releases**:每 release 一行 = 符号化物料三灯(dSYM/mapping/sourcemap)+ 新增问题数 / 回归数 + probe 注册数;点开见该版本新增 issues(链回 Inbox 过滤)。物料缺失在这里最显眼,配上传命令
- **Settings**:owner 节(projects / admins+分配 / tokens 双 scope 管理 / audit log / SMTP+测试邮件 / 集成)+ 个人节(通知偏好、语言)。管理面用表是对的形态 —— 反 data pool 原则只约束观测数据

### 回归 UX

- **Resolve 锚定 release**(「resolved in 5.4.3」);回归判定 = 同 fingerprint 在 **≥ 5.4.3 版本**再现才算(旧版本长尾不误报)
- 两条触发路:fingerprint 再现(被动)/ probe 触发(主动、语义级)
- 回归发生:回 open + regressed 红徽章 + Inbox 置顶 + 渠道通知 + activity 自动记录(「regressed in 5.4.4(probe SENT-123),3 events,2 users」)
- 「修完」和「修好被验证」是 UI 上的两个状态(守护状态卡承载)

### 专业性基线

- **Cmd+K command palette** = 唯一搜索入口:搜 issue / release / scenario / user id(客服工作流:搜用户 → 该用户撞过的 issues),**导航导向不是浏览导向** —— 没有 search results 数据表页
- **键盘 triage**:j/k 移动、Enter 进入、e resolve、i ignore、a assign
- **深链稳定**:每个 issue / occurrence 稳定 URL(bundle 回链、email 回链、AI 引用依赖它)
- **空状态 = onboarding**:新 project 零数据 → token + init 代码 + 「等待第一个事件」实时灯;首个事件到达是 aha moment,按此设计
- **全态齐**:每页 loading / 空 / 错误 / 无权限四态(webapp UX 是交付的一部分)

## 12. 决策台账

### 已钉死(用户明确拍板)

| 决定 | 时间 |
|---|---|
| 停 kevy 迁移,先业务 | 07-23 |
| 产品方向:error + 亚健康、必须 replay、startup、网络质量、点击困难、JS+Native 关联、AI 一等公民 | 07-23 |
| Replay B 型(on-error)| 07-23 |
| 亚健康以用户不舒服为基准,不分团队归属 | 07-24 |
| 命名用 warnings(errors + warnings monitor)| 07-24 |
| kind 共享 + 新增 trace / test(→assert)/ 回归探针 | 07-24 |
| 重要性 = 客观重复度(不同用户数 × 单用户重复),不分级 | 07-24 |
| 6 大类 category | 07-24 |
| 完全打破 Sentry 兼容(协议 + 概念 + API 词汇)| 07-24 |
| API 面 8 动词(「可以先这样」)| 07-24 |
| Client 零成本铁律(perf / net / 失败零传染)+ build-time 扩展(上传失败不挡 release + 友好提示)| 07-24 |
| 只做 self-host;最简体系(superadmin + admins + project 分配 + project token)| 07-24 |
| docker compose + env 定 owner + SMTP/sender 配置 | 07-24 |
| 一个镜像 | 07-24 |
| Jira 选用;必须自包含,内建 issue 体系 | 07-24 |
| issue 三态 + regressed;activity/note 流;token 双 scope | 07-24 |
| Webapp:不做数据展示 dashboard,聚焦 API/问题/录屏/源码反查/回归;细节授权 Claude 定案(§11)| 07-24 |

### 工作假设(已提出、未逐项确认,默认按此走)

- `test` → `assert` 改名;probe 自由 ref + 自动挂闭环;`context()` 保留
- trace 默认上报 + `{quiet}`;亚健康三边界(与 crash 互斥 / 感觉为准 / SDK 能采的)
- Client tier 表(web 明确不做;native core 抽出为架构方向)
- 存量处置:workspaces 删 / Stripe **冻结不删** / 法务页冻结 / SaaS 面板删 / self-signup 删 / OAuth 砍 / 审计留瘦身 / **生产数据全扔不迁移**
- token 多个 named;owner env 声明式语义;email 通知进第一版
- 铁律第 4 维(Footprint)与 init <50ms 预算数字

### 明确悬置(用户说以后再定)

- Jira 集成深度(单向推 vs 回流)
- Warning → ticket 自动触发规则(先手动)
- Flutter 進 roadmap 与否

### 未讨论的存量遗留

- Push 系列(v2.7-2.12)归属 —— 与观测定位是「第四条腿」,去留未议
- spans 表 / APM(transaction/span)语汇去留;runtime_metrics 去留
- **商业模式** —— SaaS 砍掉后,self-host 免费?license 售卖?完全未议(Stripe 资产冻结中)
- kevy 迁移(暂停;若恢复,容量前提已因 replay tick 消失而改变,见 `kevy-spans-capacity.md`)

## 13. 下一步(实施序,建议)

1. Scenario mini-spec:A/B/C 三大类的核心场景(dead_button / sluggish_button / long_freeze / slow_cold_start / slow_api)定判定阈值
2. 新 schema 设计:五 kind + 单租户 + project 中心,从零(不背迁移)
3. SDK 重构:两层结构 + 新 API + 铁律五门
4. Bundle 端到端:符号化 P0(G1/G2/G3)→ 手工填一份真 bundle 验证 schema
5. Self-host 打包:单镜像 + compose + env

顺序可调,每步开工前按惯例先过一轮设计确认。

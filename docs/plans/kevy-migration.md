# Sentori 换 kevy 迁移计划(草案)

**状态:研究 + 草案。未开工。**

## 战略召定

三条已定:

1. **动机是 dogfood**。GOLIA 用自己的产品 —— 用 Sentori 作 kevy 的历练场。这重新框定了风险:碰到 kevy bug 不是「意外」,是**目标**。反过来意味着 kevy 那边要有对等的响应带宽。
2. **形态:两种都支持,默认 embedded**。代码写在 trait 后面,客户想拆能换成 server。默认 embedded 是因为它才有 `store.atomic()` 闭包和 `fsync_aof()` 这些 embedded-only 语义,后面会用到。
3. **射程:Postgres + Valkey 全迁**。Valkey 那部分好办(纯 cache、fail-open),Postgres 是真活。

## 事实前提(先复习一次)

- Sentori 现在:**36 个 migration、93 张表、~30 个 store crate、~396 个 sqlx 查询点**。
- Postgres 特性使用清单:**34 RLS 策略 / 125 CASCADE FK / 58 UPSERT / 14 事务 / 8 FOR UPDATE(1 SKIP LOCKED)/ 3 张分区表**。
- Valkey 只在 legacy `server/` 里、纯 cache、5 处消费者全 fail-open。self-hosted 目标 crate 里**零调用**。
- kevy 是 KV + IDX + VIEW + CDC + Lua/atomic 闭包,**永远不会有 SQL / join / RLS / FK / row lock**。全内存驻留、单主写、全局 64 索引上限、PITR 只到 in-memory CDC backlog(≤1 GiB/shard)。

## 四个 anchor 决定(动代码前必须钉住)

### A. 抽象边界

**每个 `*Store` crate 的 pub trait 就是边界**。它今天返回什么(`Vec<Event>`、`IssueRow` 等)明天照样返回什么;换掉的是 impl,不是 API。

具体做法:
- 每个 store crate 加一个 `backend` 模块,里面两个 impl:`pg`(现有 sqlx)和 `kevy`(新)。
- Cargo feature:`--features backend-pg` 与 `--features backend-kevy`(互斥)。默认 `pg`,便于回滚。
- 上层 handler / worker 完全不知道底下是谁。

这么做的代价是**一段时间里两套实现并存**,读代码的人多看一份。收益是任何一个 crate 都能独立切换、独立回滚,不用一次赌全部。

### B. 租户作用域(取代 RLS)

Postgres 靠 `SET LOCAL app.current_workspace_id` + 34 张表上的 RLS policy 强制隔离。kevy 没有这个,**必须应用层做**。

方案:**所有 key 强制带前缀 `t:<workspace_uuid>:...`**。

- 通过一个 `ScopedStore` wrapper 把 `WorkspaceId` 拿到,自动拼前缀。**上层永远拿不到裸的键**。
- 一个静态检查:`grep -rn "kevy_key(\|Store::key(" src/ | grep -v "with_workspace"` 必须为空。做成 CI 门。
- 少数跨租户的操作(saasadmin 视角):走 `admin_scope()` 显式开口子,并且默认全部审计。

这个抽象是 RLS 的**主动同构物** —— 不做,以后每一处漏加前缀就是跨租户泄漏。

### C. 事务与并发

映射表:

| Postgres 用法 | kevy 替代 |
|---|---|
| 简单单键 CAS | `SET NX` / `HSETNX` |
| 短序列多键(小 tree) | embedded `store.atomic(key, \|_\| { ... })`(shard-locked 闭包) |
| 读判决写多键 | Lua `EVAL` on `KEYS[1]` shard |
| Multi-shard 事务 | **不做**。设计上禁止 —— 拆到 CDC 后处理 |
| `FOR UPDATE SKIP LOCKED`(push 队列) | `BLPOP` list + claim key TTL(kevy cookbook 有 recipe) |
| `pool.begin()` 多语句 | 如果全在一 shard → atomic 闭包;跨 shard → 拆两步 + 幂等 |

**跨 shard 事务被禁**这一条会强迫我们检视 14 处 `pool.begin()`。看不出能不能拆的,那个 crate 就要重新设计。

### D. 键命名 & 索引预算

**命名一次定死**(不然重构会到处踩):

```
t:<ws_uuid>:<entity>:<pk>                     # 主行
t:<ws_uuid>:<entity>:by-<field>:<val>:<pk>    # 手工二级索引
t:<ws_uuid>:<entity>:list                     # ZSET(时间序等)
q:<queue_name>                                # 全局队列(push worker)
audit:log:<ws_uuid>                           # 特例:跨租户 saasadmin 读
```

**索引预算 = 64 全局**。要先做一次盘点:每个 store 声明想要几个 `IDX.CREATE`,把总数拉出来。超了必须重新设计(用 view 拼)。

## 交叉基础设施(建一次)

先于任何 store 迁移:

1. **`sentori-kevy-adapter` crate** —— 集中放:
   - kevy `Store` 单例(embedded 或 server client)
   - `ScopedStore` wrapper(强制 workspace 前缀)
   - 序列化助手(Rust struct ↔ HGETALL)
   - 时间戳编码(kevy 无 date 类型,存 Unix ms i64)
2. **数据迁移工具** —— 一次性把 Postgres 数据 dump 出来灌进 kevy;每张表一个 mapper。
3. **对拍框架** —— A/B 模式:同一个请求走两个 backend,结果 diff。用于 phase 1-3 期间。
4. **备份/恢复策略** —— kevy `SAVE` 到磁盘 + `kevy-cli export` 到冷存储。文档化,写进 runbook。
5. **容量模型** —— 每个 workspace 预估 RAM(spans 是大头)。定一个 `MAXMEM` + 拒绝策略。

## 阶段与 off-ramp

**每个阶段结束必须留一条清晰的回滚路径。** 不然中途撞墙就地狱。

### Phase 0:地基(1-2 周,不影响生产)

- 建 `sentori-kevy-adapter` crate、`ScopedStore` wrapper、序列化助手。
- 选一个**最傻**的 store 做 POC:`ingest-token`(hash-keyed,~5 个查询,零 join)。
  - 加 kevy impl,加对拍测试,证明 API 契约不变。
  - **不上生产**。CI 里跑两遍(pg + kevy)证明结果一致。
- 建 kevy embedded 的 dev 环境:docker compose 里加 kevy 服务(server 模式,方便调试;embedded 集成放后面)。

**Off-ramp:** 删掉 adapter crate,回到起点。

### Phase 1:低风险 store 批量(2-4 周)

`release-store`、`notifier`、`alert-rule`、`saved-view`、`push-provider`、`ingest-token`。

- 每个 store 一个 PR,加 kevy impl,feature flag。
- **每个 store 单独在 staging 用 flag 切**,跑 24-72 小时。有问题 flag 切回 pg。
- 数据一致性:仍以 pg 为准,kevy 是 shadow write。观察一致性偏差。

**Off-ramp:** flag 全部切回 pg,数据仍在。

### Phase 2:中等 store(3-5 周)

`workspace-identity`、`auth-session`、`billing`、`issue-store`、`integration-traits`。

这些开始有多表关系:成员/邀请/项目跨表、issue 指纹去重、billing 累加计数。每一个都要仔细看是否有跨 shard 事务。

- **`workspace-identity` 是决定性的一个**:它承载 RLS 的语义等价。这里的 `ScopedStore` 前缀检查必须先跑通,后面所有 store 才能安全用。
- **`auth-session` 的 prune 必须并行迁**:现在我加的 archive_worker 依赖 Postgres 表存在。

**Off-ramp:** 单个 store flag 切回 pg;但如果 issue-store 或 billing 已经 kevy,数据要反向回灌,**这是回滚成本首次跳升的地方**。

### Phase 3:高难度 store(4-8 周)

`event-pipeline`、`span-store`、`runtime-metrics`、`replay-store`、`audit-event`。

- **`span-store` 的月分区**:改用 `t:<ws>:span:2026-07:*` 键命名 + 定期 `delete-prefix` 到期分区。cron 从 partition-manager 改为 prefix-manager。
- **`runtime-metrics` 的三级 rollup**(1m→1h→1d):UPSERT 密集,可以用 kevy `KIND agg` 索引一部分,复杂 rollup 走 CDC 消费者(kevy 的 FEED)。
- **`event-pipeline`** 的 issue 指纹去重:核心是 `INSERT ... ON CONFLICT (project_id, fingerprint) DO UPDATE`,而且要拿到 `is_new`。用 embedded `atomic()` 闭包做 CAS,或 Lua EVAL。
- **`audit-event`** 的跨租户 saas 查询:靠额外的全局键 `audit:log:*`,写两份(每 workspace 前缀 + 全局)。

**Off-ramp:** 单 store 切回;event-pipeline 或 span-store 切回意味着**期间在 kevy 侧新写的数据要 replay 到 pg**,回滚成本高。这里之前必须有 CDC 双写机制。

### Phase 4:cutover(1-2 周)

- 所有 flag 切 kevy,pg 只做 shadow read 对拍一周。
- 对拍无问题 → 删 pg 依赖、删 sqlx、删 pg 相关代码路径。
- devops compose 移除 `postgres-v2` 与 `sentori-blobs-v2`。
- 数据从 pg 单向到 kevy 的**最后一次全量迁移**,时间点公示。

### Phase 5:Valkey 收尾(几小时)

top-level `server/` 里的 5 处 Valkey 消费者:全部替换为 kevy 或去掉。全部 fail-open,不阻塞任何东西。

## kevy 反向输入 Sentori 的约束

**这些不是 bug,是设计决定,Sentori 必须适应:**

- **持久化 vs 容量**:kevy 有 AOF + snapshot,数据不丢(`appendfsync always` 零丢,`everysec` ≤1s)。但 kevy 是 Redis 家族 —— **所有可查询的键空间全部在 RAM**。AOF 只是启动时回放进内存的一次性事件,不是查询路径。所以 kevy 在「不丢数据」上和 Postgres 等价,在「能装多少」上是 RAM 决定的。
- **具体到 spans**:Postgres 100GB 磁盘 + ~8GB 热页在 RAM 完全正常;kevy 就是 100GB RAM。90 天保留的 spans 未来任何量级增长都直接翻译成 RAM 账单。选一个:**缩保留期、给 spans 建冷存储层(复用现有 `BlobStore`,近期在 kevy 里、远期在磁盘)、或者接受 RAM 账单**。
- **索引 64 个上限**。现在还不清楚需要几个,预算表要早做。**超了必须重设计**,不是加钱能解决的。
- **单主 = 无 read replica scaling**。Sentori 现在也没这么用,但未来的横向扩展要提前想。
- **PITR 只到 in-memory CDC**。生产必须有独立的备份轮换(每小时快照到对象存储、每天 export)。
- **无原生 date/decimal**。billing 金额已经是 i64 minor units(¥4,900 存 4900),没问题;时间戳存 Unix ms i64 就够了。

## 可能出的错(honest list)

1. **kevy 遇 real-world 负载出未知 bug**。dogfood 目标,但会阻塞 Sentori 发布 —— 每个 kevy bug 都可能是 Sentori 事故。响应带宽要事先约定。
2. **索引超 64** —— phase 3 中期最可能撞。缓解:phase 0 就做索引预算表。
3. **event-pipeline 的 CAS 性能** —— 现在 issue 指纹去重每秒可能几百次,atomic 闭包序列化到 shard 是不是够快,不实测不知道。
4. **CDC 消费者的位置管理** —— kevy CDC 无 server-side consumer position,Sentori 要自己存。用得多起来就是新一套子系统。
5. **备份验证** —— 之前 legacy 备份验证过可读那次是我做对的稀有一次;这次要一开始就写进 runbook,不然 phase 4 cutover 那天才发现备份不能恢复就是灾难。
6. **迁移期间的 rollback 数据** —— phase 2-3 时,如果切回,pg 侧从切换点之后就没数据了;必须有反向 replay 工具或者接受某段数据丢。

## 时间信封

- **Phase 0:1-2 周**(全职一人)
- **Phase 1:2-4 周**
- **Phase 2:3-5 周**
- **Phase 3:4-8 周**(高不确定性)
- **Phase 4-5:1-2 周**

**合计范围 11-21 周**,不含 kevy 侧的 bug 修复时间。全职一人估算。这个数字必然乐观 —— 类似规模的迁移工程通常两倍于估算。

## 立刻能做的四件小事(不阻塞主线)

如果你打算走这条路,这四件事今天开始都没损失:

1. **索引预算表**:遍历 396 个 sqlx 查询点,给每个查询归类需要什么索引,做一张表。这决定第 2 号约束会不会挤爆。
2. **spans 容量模型**:算一下 Sentori 生产当前 spans 数 × 90 天 × 未来最悲观增长的 RAM 占用。这决定 kevy 的机器规格。
3. **在 kevy 侧确认可承诺的响应带宽**:如果 Sentori 团队报 bug,kevy 团队多久修?写下来。
4. **`sentori-kevy-adapter` 空 crate**:立刻建,加 CI,phase 0 拆多个小 PR 时不会卡在 workspace 结构调整上。

## 什么样的结果算「Phase 0 通过,可以推进」

- `sentori-kevy-adapter` + `ScopedStore` 有测试。
- `ingest-token` 两个 backend impl,property test 证明 API 契约一致。
- CI 双跑(pg + kevy)双绿一周。
- 索引预算表出炉,总数 ≤ 64。
- 容量模型算过,RAM 需求可接受。
- 备份/恢复流程实测过一次(dump + restore + 校验)。
- kevy 侧响应带宽有书面承诺。

**任意一条没过,phase 1 不开工。**

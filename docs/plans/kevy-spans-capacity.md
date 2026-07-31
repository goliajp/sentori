# Spans 容量模型 —— kevy 迁移的关键数字

**测量日期:2026-07-23**。生产 Postgres 实测,不是估算。

## 现状实测

| | |
|---|---|
| 行数 | 1,545,330 |
| 时间跨度 | 2026-07-01 → 07-23(**22 天**) |
| 日均 spans | **~70,242 / 天** |
| Postgres heap | 264 MB |
| Postgres 索引 | 211 MB(5 个索引)|
| **Postgres 合计** | **475 MB** |
| 平均行大小 | 169 B(pg_column_size)/ 308 B(含索引摊销) |
| 平均 trace 长度 | 1.545M / 9,281 traces = **~166 spans/trace** |

一个坑先记下:**所有 1.5M 行都在 `spans_default`**,月分区 Jan–Jun 全空。partition manager 没有创建 07 月之后的分区。**这是既有 bug**,不阻塞今天的分析,但迁 kevy 时反正要重写分区逻辑,一并解决。

## Postgres 每行组成(实测)

```
id / ws / proj / trace UUID   4 × 16 = 64 B
parent UUID(常 NULL)         0-16 B
received_at + started_at      2 ×  8 = 16 B
duration_ms i32                        4 B
op text avg 19 B
name text avg 4 B
status text 3 B
tags jsonb avg 8 B(多数 {})
data jsonb avg 57 B(多数存在)
──────────
                             ~170 B/row
```

索引摊销 137 B/row → 每行系统总占用 **~308 B**。

## kevy 表示估算(保守)

每条 span 变成一个 Hash `t:<ws>:span:<uuid>`,13 个字段。Redis 家族的内存模型:

- 每 key 开销:字典条目 + 过期槽 + 主哈希表 = **~60-100 B**
- 每 hash field:短哈希用 ziplist ≈ **20-30 B/field**(13 字段 × 25 ≈ 325 B)
- 值本身 ~170 B(和 Postgres 一样,因为 payload 是同样的字节)
- 每行 kevy 主哈希表 **~500-600 B**

再加索引(必须为查询模式覆盖):

| 查询 | 需要的 kevy 索引 | 每行索引条目 |
|---|---|---|
| `WHERE trace_id = $1`(trace 视图,166/trace)| `IDX.CREATE trace_id ...` | ~50 B |
| `WHERE project_id AND received_at ≥ 24h`(dashboard 统计)| `IDX.CREATE received_at ...` 或 ZSET | ~50 B |
| `WHERE parent_span_id = $1`(可选,现有 Postgres 是 partial index)| 可能不需要 | 0-50 B |

保守估算:**每行 kevy 总内存 ~700 B**(数据 500 + 索引 200)。

**Postgres 308 B/row → kevy ~700 B/row = 约 2.3x**。这在 Redis 家族里是正常的 —— 磁盘型 DB 的行拼装比内存型 hash 结构紧凑。

## 容量表(90 天保留期)

以「今天 70K spans/天」为 1x,按 kevy 700 B/row:

| 场景 | Spans/day | 90d 行数 | Postgres 90d(现在的比例)| **kevy 90d RAM** | 谁能用 |
|---|---:|---:|---:|---:|---|
| **今天(dogfood)** | 70K | 6.3M | ~1.9 GB | **~4.4 GB** | 笔记本、任何机器 |
| 10x | 700K | 63M | ~19 GB | **~44 GB** | 64 GB 服务器 |
| 100x(中型 SaaS)| 7M | 630M | ~190 GB | **~440 GB** | 高内存服务器,月费 ~$2-4k |
| 1000x(大 SaaS)| 70M | 6.3B | ~1.9 TB | **~4.4 TB** | 需要集群,或**必须**冷分层 |

## 关键判断

**假设 GOLIA 短期只跑 Sentori 自家 dogfood,长期做面向开发者的 SaaS**:

- **今天 → 10x 之间没问题**。一台 64 GB 服务器搞定。这段路 kevy 全内存就是最优。
- **10x → 100x 是决定性拐点**。440 GB 单机是可选的,但月费开始成为决策变量。
- **100x 起**:**必须冷分层**。不能靠加机器解决 —— 每次内存扩容都是量级跳。

## 冷分层设计(如果做)

**读取模式支撑冷分层**:span-store 的读接口只有三个,而且模式友好:

```rust
INSERT ...                               // 写入,热
spans_for_trace(trace_id)                // 一次拉一整条 trace,166 行左右
COUNT(*) WHERE project ∧ received_at ≥ 24h  // 24h 统计
```

**没有**分析型查询、没有 `WHERE ... ORDER BY ... LIMIT` 长分页翻页、没有跨 trace 的复杂过滤。这是**冷存储的理想场景** —— 老数据只在「历史 drill-down」时读一次一整条 trace。

**设计:**

- **热层(kevy)**:最近 N 天(建议 **7 天**)。
- **冷层(BlobStore,已有 trait)**:>N 天。
  - 一个 gzip'd JSON blob 一整条 trace(166 行 × 200 B raw ≈ 33 KB,压缩后 ~8 KB)。
  - key = `spans-archive/<ws>/<project>/<trace_id>.json.gz`。
  - 归档 worker:每天扫 kevy 里 age ≥ 7d 的 trace,拉出所有 span,压 blob,写 BlobStore,删 kevy 里的原行。

**冷分层后的容量:**

| 场景 | 热(7 天 kevy) | 冷(83 天 BlobStore) | 决策 |
|---|---:|---:|---|
| 10x | ~3.4 GB | ~3.4 GB(BlobStore/S3)| 32 GB 机器绰绰有余 |
| 100x | ~34 GB | ~34 GB | 64 GB 机器 |
| 1000x | ~340 GB | ~340 GB | 512 GB 机器,或再压缩热窗口到 3 天 |

**冷读延迟代价**:一次历史 trace 拉取 = 一次 S3 GET + gunzip ≈ 50-200ms。今天 Postgres 走热页缓存 <10ms。**对「历史 drill-down」来说 100ms 是可接受的,dashboard 首屏因为只读热层不受影响**。

## 索引预算摊销

kevy 全局 64 个 `IDX.CREATE` 上限。spans 的查询模式只需:

- 1 个 `trace_id` 索引(range 或 unique)
- 1 个 `received_at` 索引(按 workspace 前缀分开可以不算全局)—— 可能可以用 ZSET 替代不占 IDX 名额

**spans 只占 1-2 个 IDX 名额**。剩下 62 给其它 30 个 store 分,平均每个 2 个 —— 需要严格。

## 拐点判决

给你三个数字定夺:

- **今天** 70K/天:kevy 全内存,4 GB。任何机器。**没顾虑**。
- **接第一个 100 QPS 的付费客户**(8.6M/天,约 100x):440 GB RAM 或冷分层。**必须做冷分层**除非愿意上 1TB 机器。
- **kevy 单机上限**:实际是「服务器能给多少 RAM」。当今云上单机 4TB RAM 存在(AWS x2iedn.32xlarge, ~$45/hr),但那是灾难性成本。**冷分层是唯一线性可扩展的路径**。

## 建议

从这个数字出发的两条路,你选:

<details>
<summary><b>选项 A:先纯 kevy,以后再补冷分层</b></summary>

- 相信增长曲线短期不会 100x,先把结构最简单的方案跑起来,等真到量再补冷分层。
- 风险:100x 那一天到了才做冷分层等于大改,可能来不及。
- 收益:phase 3(高难度 store)少一个复杂度,能更快出结论「kevy 到底适不适合」。

</details>

<details>
<summary><b>选项 B:一开始就做热冷分层(kevy 7d + BlobStore >7d)</b></summary>

- 复杂度上升 —— phase 3 里 span-store 要写归档 worker、读接口要检查两层。
- 收益:容量增长线性可扩展,不受 RAM 天花板。
- 收益:立刻验证「BlobStore 做时序数据分层」这个模式,以后 runtime_metrics / replay_sessions 也能复用。

</details>

选 A 是「先做通再优化」,选 B 是「一步到位不返工」。**如果 dogfood 是核心动机(用 Sentori 打磨 kevy),选 A** —— kevy 全内存路径是让 kevy 真正被压出问题的路径,冷分层反而让 kevy 承受的量下降。

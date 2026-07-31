# Crash Bundle Schema —— Sentori 唯一的产品

**创建日期:2026-07-23**。这份 doc 定义 Sentori 的 crash bundle 长什么样。

> **2026-07-24 更新**(见 `design.md`):bundle 的家是 Sentori **自建 issue 体系**(自包含,事实源),Jira 降级为可选订阅渠道;分发也包括 API 拉取(`GET /api/issues/:id/bundle`)和 email 精简版。本文里「送到 Jira / 建 ticket」的表述按此理解。事件模型已改为五 kind(error/warn/trace/assert/probe),本文的 near_crash 对应新体系的 warn。

## 定位

Sentori 的产品身份不是 SDK,不是后端,不是 dashboard。**产品身份是这份 bundle**。

- **消费者:LLM**(Claude / Cursor / Copilot / Devin / 客户内部 agent)
- **载体:客户的 issue tracker**(第一版 Jira Cloud,后续 GitHub Issues / Linear)
- **形式:markdown**(附一个 `bundle.json` 结构化版本)
- **目标:「读完就够修」** —— AI 不需要问 Sentori 拿别的数据,不需要连远端 API,markdown 里就够所有关键上下文

其它一切(SDK 采什么、后端存什么、数据库选什么)都是为了 **populate 这份 bundle**。

## Bundle 顶层结构

```
# Crash — <issue.error_type>: <message_sample truncated 80 chars>
<meta line: platform · app version · issue.id · N occurrences · first seen · last seen>

## Summary                    ← LLM-generated 1-2 段自然语言
## Where                       ← file:line / native frame / release / device
## Stack trace                 ← 100% symbolicated,inApp 帧标出,附源码 ± 20 行
## What the user was doing     ← breadcrumbs 时间轴(最近 30 秒)
## Replay                      ← 30 秒 attachment link + 关键帧文字描述
## Environment                 ← device / OS / network / memory / battery / locale
## Similar crashes             ← 同 issue 内其它事件、regression 标记、cluster
## Related code                ← file 源码 snippet(from git)
## For the AI                  ← Sentori 自己的诊断信号 / confidence / 建议 action

---
attachments:
- bundle.json          (结构化版本 for tool-based agents)
- replay.rrweb.json    (播放序列)
- screenshot-<t>.png   (关键帧 x N)
- source-<file>.txt    (相关源码,若接了 git repo)
```

## 每段的字段与数据来源

字段名 → 来自哪张表 / 哪个 payload 字段。★ = 现在没有,是 gap。

### Meta line

| 字段 | 来源 |
|---|---|
| issue.error_type | `issues.error_type` |
| message_sample | `issues.message_sample` |
| platform | `events.platform` |
| app.version + build | `events.payload → app.version / build` |
| issue.id | `issues.id`(用短 hash 显示)|
| event_count | `issues.event_count` |
| first_seen / last_seen | `issues.first_seen / last_seen` |

### `## Summary`

**LLM-generated,不是 raw 数据**。用 error type + stack top frame + breadcrumb 末尾 + user action → 生成 1-2 段自然语言:

> User tapped "Pay" in checkout after adding item ¥12,500 to cart. TypeError thrown in `handlePaymentSubmit` because `cardToken` from `TokenService.getActive()` was `null` — likely a race between token fetch and button enable. 47 occurrences past 7 days, all on iOS 18.2 after commit abc123.

**Sentori 后端调 LLM 生成**。默认 model:Claude Haiku(便宜、够用)。缓存在 `issue` 或 `event` 级别。

### `## Where`

| 字段 | 来源 |
|---|---|
| 主要文件 line col | 从 `events.payload.error.stack[0]` 拿第一 inApp 帧 |
| 函数名 | 同上 |
| Native bridge 帧 | ★ 需要 SDK 上报 native frame 时把 JS ↔ native 关联填 `nativeFrameRef` |
| release + build | `events.release` |
| environment | `events.environment` |
| affected devices | 用 issue_id 聚合 events 里的 device.model / os.name-version |

### `## Stack trace`

**100% 符号化是硬指标**。任何 `<anonymous>` / `bundle.js:1:12345` 都是失败。

- **JS 侧**:SDK 上报 minified stack + source map bundle id → 后端解 symbolication。**已经有的字段:`events.payload.symbolication`**(现在只出现在 error 类,near_crash 里没有 ★)
- **iOS 侧**:上报 dSYM UUID + 二进制 offset → 后端查 dSYM store → 解出符号。★ 尚未确认现有 pipeline 完成度
- **Android 侧**:上报 ProGuard mapping id + minified name → 后端解。★ 同上
- **每帧的 preContext / postContext**:payload 已经有字段,但当前生产样本里全是空数组。★ SDK 没填

**Bundle 输出格式**:

```
1. handlePaymentSubmit
   at src/screens/CheckoutScreen.tsx:142:23
   ```
   140  const onPay = () => {
   141    const token = TokenService.getActive();
   142    return processPayment(token.value);  ← throws here (token is null)
   143  }
   144  const setup = () => TokenService.refresh();
   ```

2. processPayment  (native bridge → Android)
   at PaymentModule.kt:87:12
   [inline source snippet]

3. ...
```

### `## What the user was doing`

**Breadcrumbs 时间轴,最近 30 秒**。format:相对时间 + 类型 + 简述。

- 来源:`events.payload.breadcrumbs`
- ★ 当前 near_crash 没上报 breadcrumbs
- ★ replay tick 之前一直被作为 span 存,应该改为「on-error trigger 打包成 replay attachment」

```
- 24.3s ago  [nav]    user opened /products/12345 (via feed tap)
- 18.1s ago  [ui]     tapped "Add to cart" (SKU 12345, ¥12500)
- 12.4s ago  [nav]    navigated to /checkout
- 8.7s ago   [ui]     filled address (34 chars)
- 3.1s ago   [http]   POST /api/tokens → 200 in 4.2s (slow network)
- 0.4s ago   [ui]     tapped "Pay"
- crash
```

### `## Replay`

**On-error 触发的 30 秒 wireframe attachment**。参见 `docs/plans/replay-on-error.md`(待写)。

- 上报形态:`event_attachments.kind='replay'`
- Bundle 里内嵌 3-5 张关键帧的**文字描述**(不是图),让 LLM 不解析二进制也知道 UI 长什么样:

```
Key frames (see attached replay.rrweb.json for full session):

Frame @ -8s (checkout screen loaded):
┌────────────────────┐
│ Ship to            │
│ [Address field   ] │
│ Payment            │
│ [Card ····1234   ] │
│ ┌──────────────┐   │
│ │  Pay ¥12,500 │   │  ← button was enabled
│ └──────────────┘   │
└────────────────────┘

Frame @ -0.5s (right before tap):
[loading spinner overlay covering address field — payment button still enabled]

Frame @ 0 (crash moment):
[white screen — RN error boundary triggered]
```

**LLM 消费这段就能理解 UI 状态,不用解析二进制**。

### `## Environment`

| 字段 | 来源 |
|---|---|
| device model / os / version | `events.payload.device` |
| screen size / density | `events.payload.device.screen`(★ 未确认字段名一致性) |
| battery level | ★ SDK 未采,需加 |
| network type (wifi/4G/5G) | ★ 未采 |
| memory usage / available | ★ 未采(有 `sentori.longtask` op 但不是 crash 时快照) |
| locale | `events.payload.device.locale` |
| geo.country | `events.payload.geo.country` |

### `## Similar crashes`

- 用 issue_id 反查 events 表:
  - 24h / 7d / 30d 出现次数
  - 出现的 release 分布(是 regression 吗)
  - 影响 user 数(unique `payload.user.id`)
  - 主要 platform / device 分布
- **Regression 标记**:`issues.regressed_at / regressed_in_release`
- **Cluster hint**(★ 尚未实现):同一时段是否其它 issue 大量新增 —— 提示可能是一次部署撞的

```
- 47 occurrences past 7 days, 12 unique users
- First seen: 2026-07-15 (release 5.4.26071500)
- Suspected regression from: 5.4.26071500 (commit abc123 — see git blame below)
- Platform breakdown: iOS 18.2 (44), iOS 18.1 (3)
- 3 other new issues appeared same window — possible batch regression
```

### `## Related code`

★ **需要新集成:客户接入 git repo**。

- 客户在 Jira 集成时提供 GitHub / GitLab repo URL + read-only token
- Sentori 后端把 stack top frame 的 `file:line` → git blame,拉 ± 20 行源码
- 拉最近改这段代码的 commit 作为 suspect

如果客户不接 git,这段可 fallback 为「Bundle 只有 stack trace + preContext/postContext(SDK 采的)」。

### `## For the AI`

**Sentori 自己的诊断信号**。目的:LLM 拿到这份 bundle 之前,Sentori 已经把它能算的都算了。

```
Sentori confidence: HIGH
- Fully symbolicated: yes (JS + native)
- Replay captured: yes (30s pre-crash)
- Similar crashes: 47 in past 7d (cluster confirmed)
- Suspected root cause: null return from TokenService.getActive() — check refresh() race
- Suggested first read: src/services/TokenService.ts (blame shows commit abc123 changed retry logic)
- Devices / OS narrow: 100% iOS 18.2 (Android unaffected — likely iOS-specific timing)
- Network correlation: 78% of occurrences on slow network (>2s ping) — timing hypothesis
```

**这段生成需要 Sentori 后端在 issue 层跑一些 analysis**:
- 相似度聚类
- Release regression detection(已有 `regressed_at` 字段)
- Platform / device 分布统计
- Network 相关性(相似 crash 的 breadcrumbs 里 network 分布)
- LLM-generated hypothesis(用 issue 汇总数据 + 少量样本 events 做一次 LLM 调用)

## Bundle 生成时机

**Lazy on trigger,不 eager**。触发条件:

1. **新 issue 出现** —— 第一次达到某阈值(比如 5 次 occurrences)时,生成 bundle → 建 Jira ticket
2. **Regression** —— `issues.regressed_at` 更新时,如果 Jira 里有原 ticket → 更新 bundle 追加到 comment;若无 → 新建
3. **手动触发** —— dashboard 里客户可点「重新生成 bundle」

**为什么 lazy**:
- Bundle 生成涉及 LLM 调用(Summary + For the AI 段)—— 有 cost
- 需要等 similar crash 累积到有意义的 sample size
- 需要等 symbolication pipeline 完成(异步)

## 待做的 gap 清单

按优先级排:

### P0 —— 阻塞 bundle 能不能生成

- [ ] **near_crash payload 补齐** —— 现在缺 breadcrumbs / attachments / symbolication / user / geo / traceId,SDK 上报路径需要跟 error 走同一份
- [ ] **stack trace 完全符号化** —— iOS dSYM / Android ProGuard mapping 上传 pipeline 完整度未确认,写 audit 报告
- [ ] **preContext / postContext 填充** —— SDK 采的字段全空,需要补 SDK 逻辑(把 error 帧前后 ±3 行代码带上,若能)
- [ ] **on-error replay attachment** —— 参考 `docs/plans/replay-on-error.md`(待写),SDK 改成 30 秒滚动 buffer + 触发上传

### P1 —— bundle 质量提升

- [ ] **Similar crash aggregation** —— 后端在 issue 层跑 24h/7d/30d 统计 + platform/device 分布 + network correlation
- [ ] **LLM-generated Summary** —— 后端接 Anthropic API,per-issue 缓存
- [ ] **`For the AI` 段 hypothesis** —— 后端在有足够 sample 时跑 LLM 调用生成诊断
- [ ] **Battery / network / memory 采集** —— SDK 在 crash / near_crash 触发时快照,填 `events.payload.device`

### P2 —— bundle 上分发

- [ ] **Jira Cloud 集成** —— OAuth + create issue + attach files + append comment on update
- [ ] **Repo git 集成** —— 客户配 repo URL + token,后端在 bundle 生成时拉源码 + blame
- [ ] **触发规则可配** —— per-project 设置「多少 occurrences 建 ticket」「哪些 severity 建」「哪些 label 走 P1 track」

### P3 —— 长尾

- [ ] **GitHub Issues / Linear 集成**
- [ ] **Cluster hint**(同时段其它 issue 新增预警)
- [ ] **Bundle 版本化** —— 同一 issue 后续更新时,diff 「变化了什么」而不是重发全文

## 下一步

**产出这份 doc 之后,建议动作:**

1. **拿现在生产的 focus-ai-app TypeError event,手工填一份完整 bundle** —— 看填不满的地方就是 gap
2. **写 P0 gap 的详细任务清单** —— 每条 gap → 一个具体的 SDK / server change
3. **写 `docs/plans/replay-on-error.md`** —— 30 秒 buffer + trigger + rrweb-style event stream 格式定义
4. **搭 Jira 集成 spike** —— 一个能创建 test ticket + attach markdown 的最小实现,验证 attachment 长度 / format 限制

不要一次全做。这份 doc 定型之后再挑一件先开工。

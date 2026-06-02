# Insight 升级笔记 — `sentori-react-native` 0.7.3 → 0.8.3

这一轮 SDK 带来 **9 项新功能**：4 项零配置自动生效，5 项需要你接一行
API 或在 `init` 加一个开关。先看 TL;DR，再按下面分节直接抄代码。

---

## 一行升级

```sh
bun add @goliapkg/sentori-react-native@0.8.3
bun install
# rebuild 原生 bundle 不需要 — 没有破坏性变更，没动 native module
```

会顺带升级 `@goliapkg/sentori-core` 到 0.8.1（peer dep 自动）。

可选 peer dep（按需）：

```sh
bun add @react-native-community/netinfo  # device.networkType
bun add expo-updates                      # OTA bundle 感知 + 启动崩溃回滚
bun add expo-sensors                      # FeedbackButton trigger="shake"
```

不装这些，对应功能优雅降级（字段缺失 / 触发方式退化），不会报错。

---

## TL;DR — 这次拿到什么

| 功能 | 怎么开启 |
|---|---|
| GraphQL operation 自动命名 | ✅ 默认 on |
| Rage tap / 连点检测 | `<sentori.RageTapCapture>` 包 App 根 |
| Feature Flag 维度 | `sentori.setFeatureFlag(name, value)` |
| measureFn 函数计时 | `sentori.measureFn(name, fn)` |
| Velocity 告警（服务端） | ✅ 默认 on（服务端 cron） |
| Moments / 流失追踪 | `sentori.startMoment('checkout').end()` |
| OTA bundle 感知 (EAS Update) | ✅ 装 expo-updates 后自动 |
| 启动崩溃循环防护 | `capture.launchCrashGuard.enabled: true` |
| Feedback Widget | `<sentori.FeedbackButton />` |
| 崩溃前哨（pre-crash） | `capture.preCrashSentinel: true` |
| State 时光机 | `sentori.bindState({ redux: store })` |
| Repro-as-test 导出 | Dashboard 操作（无 SDK 改动） |
| Privacy Lab 评分 | Dashboard 操作（无 SDK 改动） |

---

## 1. 零配置自动生效

### 1.1 GraphQL operation 自动命名

之前所有 GraphQL 请求 breadcrumb 都是 `POST /graphql`（看不出哪个 op
出问题）。现在自动从请求 body 提取 `operationName`：

- breadcrumb 名 → `graphql/UpdateCart`
- trace span 名 → 同上
- 额外 tag `gql.operation: 'UpdateCart'`

支持 Apollo / urql / Relay 的标准 JSON-body 形态。bare query body
（`application/graphql`）也支持。8 KB 体积限制（再大就跳过解析，
避免热路径阻塞）。

要关掉：

```ts
sentori.init({
  capture: {
    network: { graphql: false },
  },
});
```

### 1.2 Velocity 告警

服务端 cron 每 5 分钟扫一次：每个 issue 的过去 30 分钟事件数与之前 30
分钟比。条件：

- 绝对量 ≥ 20 事件
- ratio ≥ 3× → warn 通知
- ratio ≥ 5× → page 通知

30 分钟冷却防止 spam。发到项目的 `on_new_issue` 收件人邮件列表。
SDK 不用改任何代码 — 升级 server 之后自动起作用。

### 1.3 OTA bundle 感知 (EAS Update / CodePush)

如果装了 `expo-updates`，SDK 自动 detect `Updates.updateId` +
`Updates.commitTime`，每个 event 自动带：

```ts
event.bundle = {
  id: 'r/123',
  deployedAt: '2026-05-15T...',
  source: 'expo',
}
```

也支持 `react-native-code-push`（label / hash 作 id，async 检测，
第二个 event 起带上）。Dashboard 在 Issue Context 里展示 bundle
（与 release 并列），server 也加了 expression index 方便按 bundle
过滤 issue 列表。

### 1.4 Privacy Lab + 评分（服务端）

服务端 cron 每 15 分钟扫所有入库 events，找疑似 PII：

- email 模式
- phone 模式
- 信用卡式数字
- 街道地址式字符串

每个 release 算一个 **Privacy Score (0-100)**：
- ≥ 80 = low risk（绿）
- 50–79 = medium（黄）
- < 50 = high（红）

Dashboard → **Monitor → Privacy** 看：

1. 当前 release 评分 gauge
2. Top leaking surfaces（哪个字段路径泄漏最多）
3. 最近 50 条 findings（每条带 4 类匹配 + 样本截断 64 字节）

SDK 不用改任何代码。如果你想"主动减少泄漏"：把 PII 留在 store 之外、
用 `<Maskable>` 包 PII 视图、用 `coerceError` 处理 throw（这些之前
版本就有）。

---

## 2. 一行 API 调用就能用

### 2.1 Rage tap / 连点检测

App 根（`App.tsx` 或入口最外层）包一层：

```tsx
import { sentori } from '@goliapkg/sentori-react-native';

export default function App() {
  return (
    <sentori.RageTapCapture style={{ flex: 1 }}>
      {/* ...原有的整个 app 树 */}
    </sentori.RageTapCapture>
  );
}
```

800ms 内对同元素 ≥ 3 次点击 → 自动 emit `ui.multiClick` breadcrumb。
不拦截 / 不 capture / 不干扰任何 Touchable / Pressable /
GestureHandler — 是被动观察。

### 2.2 Feature Flag

```ts
import { sentori } from '@goliapkg/sentori-react-native';

// 实验 / A-B 开关 / 灰度的当前值:
sentori.setFeatureFlag('checkout-v2', 'variant-a');
sentori.setFeatureFlag('new-shipping', 'on');

// 用户切换分组时:
sentori.clearFeatureFlag('checkout-v2');
```

每个 event 自动携带 flag map。Dashboard 在 Issue Context 里把每个
flag 显示成 `flag:checkout-v2 = variant-a` 行，方便区分"只在 variant
A 才炸"。

约束（静默丢弃，不报错）：
- 名 / 值最大 200 字符
- 最多 50 个 flag

### 2.3 measureFn 函数计时

任何要测的代码块包一下：

```ts
const result = await sentori.measureFn('addToCart', async () => {
  return await api.addToCart(item);
});
```

会自动开一个 `op = sentori.measureFn` 的 span，名为 `addToCart`，
跑完时 finish。如果 fn 抛错 → span 状态标 `error` + 错误信息进 tag，
错误本身原样抛出（透传）。可加 tags：

```ts
sentori.measureFn('addToCart', fn, { tags: { region: 'jp' } });
```

### 2.4 Moments / 流失追踪

跟踪用户流程时长 + 流失率：

```ts
const m = sentori.startMoment('checkout', {
  properties: { cartValue: 42 },
});

// 流程中的关键里程碑:
m.checkpoint('payment-method-selected');
m.checkpoint('payment-submitted');

// 终态三选一:
m.end();              // 成功
// m.fail('declined'); // 失败 — 用户走完但结果不 OK
// m.abandon();        // 用户中途中断
```

如果 app 进 background 超 30 秒还没调任何终态方法 → 自动算 abandon。

Dashboard → **Monitor → Moments** 看每个 moment 的 p50 / p95 / 流失
率，按 release / device 过滤。

适合追踪：checkout / 注册 / 首充 / 申请流程 / 任何多步操作。

### 2.5 Feedback Widget

```tsx
import { FeedbackButton } from '@goliapkg/sentori-react-native';

<FeedbackButton
  trigger="shake"           // 'shake' | 'manual' | 'fab' (default fab)
  attachScreenshot
  attachReplayBuffer
/>
```

三种触发方式：

| trigger | 说明 |
|---|---|
| `fab` | 右下角浮动 "?" 按钮（默认） |
| `shake` | 摇一摇打开 — 需要装 `expo-sensors`；不装则退化为 fab |
| `manual` | 不显示按钮，用 ref 程序触发：`feedbackRef.current.open()` |

打开后是个 modal：标题输入 + body 输入 + 可选 email，submit 后调
现有的 `sentori.sendUserFeedback(...)` 接到 server。

把 ref 传出来：

```tsx
const feedbackRef = useRef<FeedbackButtonHandle>(null);

// 在 captureException 后弹反馈:
sentori.captureError(err);
feedbackRef.current?.open({ eventId: lastEventId });
// (eventId 自动关联到该 issue)

<FeedbackButton ref={feedbackRef} trigger="manual" />
```

### 2.6 State 时光机

**Sentori 原创** — 竞品都没有。Sentry 的 replay 只有 UI 截图，
没有 state。我们记 actual state diff。

绑定一次（init 后立即）：

```ts
import { sentori } from '@goliapkg/sentori-react-native';
import { store } from '@/redux/store';

sentori.bindState({ redux: store });

// 或 zustand:
// sentori.bindState({ zustand: useStore });

// 或非 store 的状态:
// sentori.recordState({ user, cart }, 'manual');
```

每次 store 变化记一个 shallow diff 到 ring buffer (最多 50)。
`captureException` 时整体作为 `stateSnapshot` attachment 上传。

Dashboard 现在能在 issue detail attachment 列表里看到 JSON，
完整 time-travel scrubber UI 在 v0.9.2.1 出。

**重要的 PII 提醒**：bindState 拿整个 store。请在 store 设计阶段就
排除敏感字段（密码、token、PII）。Privacy Lab (#1.4) 会扫到泄漏
并打分提醒，但前置预防更好。

---

## 3. init 加配置即可

### 3.1 启动崩溃循环防护

OTA 更新有 bug → 连续启动崩溃 → 自动回滚到上一个 safe bundle：

```ts
sentori.init({
  token: '...',
  release: '...',
  capture: {
    launchCrashGuard: {
      enabled: true,
      onLaunchCrashDetected: (info) => {
        // info.consecutiveCount: 连续未完成启动次数
        // info.crashedBundle:    崩溃的 bundle id
        // info.lastSafeBundle:   上一个完成 init 的 bundle
        return {
          action: 'rollback',
          toBundle: info.lastSafeBundle,
        };
        // 或:
        // { action: 'reset', clearKeys: ['user-cache'] }
        // { action: 'continue' }
      },
      threshold: 2,      // 几次连续 → 触发，默认 2
      timeoutMs: 200,    // callback 最多阻塞这么久，默认 200
    },
  },
});
```

工作原理：
1. 每次 init 写 `launch_marker` 到 AsyncStorage（含当前 bundle id）
2. init 完整结束后 2 秒写 `launch_completed`
3. 下次启动检查：marker 存在但 completed 不存在 → 上次没完成 →
   计数 +1
4. 计数 ≥ threshold → 触发 callback（200ms 超时）→ 按 action 处理

`rollback` / `reset` action 需要 `expo-updates` 才能真正 reload；
没装就只 callback 不执行。

> v0.9.0 这版是 **JS-only** — catches everything after JS bridge is
> up（绝大多数 OTA 更新坏的情形）。完全在 JS bridge 起来前就 crash
> 的 native 路径，v0.9.1 会补原生 marker。

### 3.2 崩溃前哨（pre-crash sentinel）

**Sentori 原创** — 行业第一个 predictive。监测 JS 线程帧预算：

```ts
sentori.init({
  capture: {
    preCrashSentinel: true,   // 默认 false，opt-in
    sentinelChannels: ['frame-budget-overrun'],  // 默认仅这个
  },
});
```

工作原理：每帧测 `requestAnimationFrame` 间隔。如果 60 帧窗口里 ≥
50% 帧超过 32ms（< 30 fps），主动发一条 `kind = 'nearCrash'` 事件
给服务端。1 分钟冷却防 spam。

Dashboard 看：在 Issues 列表用 `kind=nearCrash` 过滤 → 看哪些场景在
crash 前夕已经卡顿了。

> v1.0 会加 native channels：`memory-pressure` / `oom-warning` /
> `storage-low`，本版不可用。

---

## 4. Dashboard 操作（无需 SDK 改动）

### 4.1 Repro-as-test 导出

Issue detail 右上角："**↓ export as jest test**" 按钮。

点击下载 `repro-<8-char>.test.ts`：

- 文件头部注释：event id / release / error type / message
- breadcrumb 时间序列（最多 50 条）作为复现 outline
- 顶 8 个 stack frames（function + file:line）
- `expect().toThrow(/<errorType>/)` 默认断言
- TODO 标记 arrange / act / assert 三段

**不是开箱即用的通过测试** — 是 30 秒的调试 scaffold。开发者下载、
丢到 `tests/__repros__/`、用 breadcrumb outline 写复现路径、跑、断
点。

未来当 `bindState` (#2.6) 在 v0.9.2.1 完整呈现 state 时，会自动填充
arrange 段。

### 4.2 Privacy Lab

Dashboard → **Monitor → Privacy**。已在 §1.4 详述。

---

## 5. 完整 `init` 示例

把上面所有开关汇总：

```ts
import { initSentori, sentori } from '@goliapkg/sentori-react-native';
import { store } from '@/store';

initSentori({
  token: 'st_pk_...',
  release: `insight@${appVersion}+${buildNumber}`,
  environment: __DEV__ ? 'dev' : 'prod',

  capture: {
    // 现有 (v0.7.x)
    globalErrors: true,
    promiseRejections: true,
    sessions: true,
    screenshot: true,
    sessionTrail: true,

    // network 子开关
    network: {
      graphql: true,   // GraphQL operation 自动命名（默认 on）
    },

    // v0.9.0 新
    launchCrashGuard: {
      enabled: true,
      onLaunchCrashDetected: (info) => ({
        action: 'rollback',
        toBundle: info.lastSafeBundle,
      }),
    },

    // v0.9.1 新（Sentori 原创）
    preCrashSentinel: true,
  },

  sampling: {
    errors: 1.0,
    traces: 0.1,
  },
});

// init 后立即:
sentori.bindState({ redux: store });            // v0.9.2 State 时光机
sentori.registerMaskQuery(getMaskedNativeIds);  // v0.7.3 既有
```

App 根：

```tsx
import {
  ErrorBoundary,
  FeedbackButton,
  sentori,
} from '@goliapkg/sentori-react-native';

export default function App() {
  return (
    <ErrorBoundary>
      <sentori.RageTapCapture style={{ flex: 1 }}>
        {/* ...你的整个 app 树 */}
        <FeedbackButton trigger="shake" />
      </sentori.RageTapCapture>
    </ErrorBoundary>
  );
}
```

业务代码任意位置：

```ts
// 实验开关 / 灰度状态
sentori.setFeatureFlag('checkout-v2', 'variant-a');

// 用户流程跟踪
const m = sentori.startMoment('checkout');
// ...
m.end();

// 关键操作计时
await sentori.measureFn('addToCart', () => api.addToCart(item));
```

---

## 6. 升级清单

按这个跑一遍：

```
[ ] bun add @goliapkg/sentori-react-native@0.8.3
[ ] bun install

可选 peer dep（按需）:
[ ] bun add @react-native-community/netinfo   # device.networkType
[ ] bun add expo-updates                       # OTA 回滚 + bundle 感知
[ ] bun add expo-sensors                       # shake trigger

代码改动:
[ ] init 加 capture.launchCrashGuard
[ ] init 加 capture.preCrashSentinel: true
[ ] init 后立即 sentori.bindState({ redux: store })
[ ] App 根用 <sentori.RageTapCapture> 包裹
[ ] 合适入口放 <FeedbackButton trigger="shake" />
[ ] checkout / 注册等关键流程加 sentori.startMoment(...).end()
[ ] 实验 / A-B 分组处加 sentori.setFeatureFlag(...)
[ ] (可选) 慢函数加 sentori.measureFn(name, fn)

验证:
[ ] rebuild + 重启 app
[ ] 在 dashboard issue 列表看看新 event 是否带:
      - flags / bundle / device.networkType 字段
      - graphql/<op> breadcrumb（如果有 GraphQL 流量）
[ ] dashboard → Monitor → Moments 看到 moments
[ ] dashboard → Monitor → Privacy 看到 Privacy Score
```

---

## 7. 升级后如果遇到问题

- **Privacy Score 偏低（红色 high risk）** — 看 top fields，多数是
  store 里有 email/phone。让 redux store 用 selector 排除，或在
  bindState 不传 redux 改用 manual recordState 只发非 PII 字段。
- **Velocity 告警没收到邮件** — 检查项目 notification recipients 里
  `on_new_issue = true` 的收件人。
- **FeedbackButton shake 不响应** — 装 `expo-sensors` 没？没装会
  退化为 fab。
- **launchCrashGuard rollback 没生效** — 装 `expo-updates` 没？没
  装时 callback 会触发但 reload 走不通。
- **bindState 后 RAM 涨** — 50 个 snapshot ring 应该不大；如果你的
  store 单 diff 也很大（千级对象），换 manual `recordState` 只发
  关心的字段。
- **任何其它问题** — Sentori dashboard 直接搜你应用的 release，
  事件就在那。或者 ping 一下我们。

---

## 8. 还在路上（等 Insight 反馈后再做）

下一批（v0.9.1 收尾 / v1.0）：

- 移动 Vitals（冷启动 / TTID / TTFD / 慢冻帧统计）— 需要原生模块
- Session Replay（wireframe 模式，不是光栅截图）— 大改动
- TurboModule 异常保真修复（修连 Sentry 都没修的新架构 bug）
- AI 语义聚合 + 根因建议 + 修复 diff
- 罪魁 commit 定位 + 自动 Revert PR
- 实时调试流（dashboard 选一个 user → 实时看他下一段所有 event）
- 统一 Issue 视图（一屏看完 stack + replay + state + 根因 + 罪魁）

完整 roadmap：`docs/design/v0.9-rn-deep-dive.html`（可视化版）+
`docs/design/v0.9-rn-deep-dive.md`（markdown 详细版）。

你们升级 0.8.3 跑起来后我们再决定优先级 — 哪个最痛就先做哪个。

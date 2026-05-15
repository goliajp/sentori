# Sentori SDK 升级笔记 — 0.7.3 → 0.8.3

> Roadmap 文档: `docs/design/v0.9-roadmap.md`
> 路线设计: `docs/design/v0.9-rn-deep-dive.{md,html}`

Insight 当前在 `@goliapkg/sentori-react-native@0.7.3`。**0.8.3 是当前
推荐升级目标** — 包含 v0.9.0 全部 8 项行业对标功能 + v0.9.1/v0.9.2 中
6 项 sentori 原创功能（共 9 项已 publish）。

```sh
bun add @goliapkg/sentori-react-native@0.8.3
bun install
```

会一起升级 `@goliapkg/sentori-core@0.8.1` 经 peer dep。
没有破坏性变更，不需要重建原生 bundle。

---

## TL;DR — 0.8.x 全新能力

| 编号 | 名称 | 怎么用 | 触发 |
|---|---|---|---|
| #11 | GraphQL operation 自动命名 | 无需配置 (默认 on) | 自动 |
| #12 | Rage tap / 连点 | `<sentori.RageTapCapture>` 包 app 根 | 自动 |
| #13 | Feature Flag 维度 | `sentori.setFeatureFlag('exp', 'A')` | 手动 |
| #14 | measureFn | `await sentori.measureFn('addToCart', () => ...)` | 手动 |
| #5 | Velocity 告警 | server 自动 (5min 扫一次) | 自动 |
| #6 | Moments / 流失追踪 | `sentori.startMoment('checkout').end()` | 手动 |
| #10 | EAS Update / CodePush 感知 | 自动检测 expo-updates | 自动 |
| #3 | 启动崩溃循环防护 | `init({ capture: { launchCrashGuard: {...} } })` | 配置 |
| #9 | Feedback Widget | `<sentori.FeedbackButton trigger="shake" />` | 配置 |
| +S4 | 崩溃前哨（JS 帧预算） | `init({ capture: { preCrashSentinel: true } })` | 配置 |
| +S6 | Privacy Lab + 评分 | Dashboard → Monitor → Privacy | 自动 |
| +S5 | Repro-as-test | Issue detail → "export as jest test ↓" | 手动 |
| +S2 | State 时光机 | `sentori.bindState({ redux: store })` | 手动 |

> 其中 +S2 / +S5 / +S6 是 **sentori 原创** — Sentry / Bugsnag /
> Crashlytics 都没有。

---

## 1. 一行接入的小功能

### GraphQL operation 自动命名 (#11)

零配置。所有 POST 到 `/graphql` 的请求自动从 body 提取 `operationName`：
breadcrumb `POST /graphql` → `graphql/UpdateCart`。Insight 用 Apollo /
urql / Relay 都会自动捕获。如需关闭：

```ts
sentori.init({
  capture: {
    network: { graphql: false },  // 关闭
  },
});
```

### Rage tap 检测 (#12)

包 App 根：

```tsx
import { sentori } from '@goliapkg/sentori-react-native';

<sentori.RageTapCapture>
  {children}
</sentori.RageTapCapture>
```

800ms 内对同元素 ≥ 3 次点击 → `ui.multiClick` breadcrumb。
不干扰任何 Touchable / Pressable / GestureHandler。

### measureFn (#14)

```ts
const result = await sentori.measureFn('addToCart', async () => {
  return await api.addToCart(item);
});
```

包装任何函数为 span。错误时自动标 status=error 并透传。

---

## 2. 配置开关的新功能

### Feature Flag 维度 (#13)

```ts
sentori.setFeatureFlag('checkout-v2', 'variant-a');
sentori.setFeatureFlag('shipping', 'fast');

// 在用户切换实验组时:
sentori.clearFeatureFlag('checkout-v2');
```

每个 event 自动携带当前 flag map。Dashboard 在 Issue Context 展示
`flag:checkout-v2 = variant-a` 行，方便区分"哪个实验组才出问题"。

### Moments / 流失追踪 (#6)

```ts
const m = sentori.startMoment('checkout', {
  properties: { cartValue: 42 }
});
m.checkpoint('payment-submitted');
// ...
m.end();           // 成功
// m.fail('declined'); // 失败
// m.abandon();        // 用户中断
```

app 进入背景 > 30s 没调 `.end()` 会自动 `abandon`。
Dashboard → Monitor → Moments 看 p50/p95 + 流失率。

### Launch Crash Guard (#3)

OTA 更新有 bug 导致连续启动崩溃时，自动回滚到上一个 safe bundle：

```ts
sentori.init({
  token: '...',
  release: '...',
  capture: {
    launchCrashGuard: {
      enabled: true,
      onLaunchCrashDetected: (info) => {
        // info.consecutiveCount, info.crashedBundle, info.lastSafeBundle
        return { action: 'rollback', toBundle: info.lastSafeBundle };
        // or { action: 'reset', clearKeys: ['user', 'cache'] }
        // or { action: 'continue' }
      },
    },
  },
});
```

需要 `expo-updates` 才能真正回滚（无 expo-updates 时 callback 仍触发，
action 由 host 端自行实现）。Callback 有 200 ms 超时（D3 决策）。

### Feedback Widget (#9)

```tsx
import { FeedbackButton } from '@goliapkg/sentori-react-native';

<FeedbackButton
  trigger="shake"           // 'shake' | 'manual' | 'fab'
  attachScreenshot
  attachReplayBuffer
/>
```

`shake` 需要 `expo-sensors` peer dep；无装则自动退化为 `fab` 触发。

### 崩溃前哨 (+S4) — sentori 原创

JS 线程帧预算监测，crash 前预警：

```ts
sentori.init({
  capture: {
    preCrashSentinel: true,  // 默认 false
    sentinelChannels: ['frame-budget-overrun'],  // 默认
  },
});
```

60 帧窗口内 ≥ 50% 帧 ≥ 32ms（< 30fps）→ 主动发 `kind=nearCrash`
事件。Dashboard 在 issue 列表可按 kind 过滤。1 分钟冷却防 spam。

---

## 3. State 时光机 (+S2) — sentori 原创

竞品全靠 UI 截图猜，sentori 记 actual state。

```ts
import { sentori } from '@goliapkg/sentori-react-native';
import { store } from './redux/store';

sentori.bindState({ redux: store });
// 或 zustand:
// sentori.bindState({ zustand: useStore });
// 或非 store 的状态:
// sentori.recordState({ user, cart }, 'manual');
```

每次 store 变化记 shallow diff 到 ring buffer (50)，
`captureException` 时整体作为 `stateSnapshot` attachment 上传。
Dashboard time-travel viewer 在 v0.9.2.1 出 — 当前可在 issue
detail attachment 列表看到 JSON。

**注意 PII**：bindState 拿 store 全量。敏感字段（密码、token、PII）
请在 store 设计时就用 selector 排除。S6 Privacy Lab 会扫到并打分提醒。

---

## 4. Repro-as-test (+S5) — sentori 原创

Issue Detail 顶部一个 "export as jest test ↓" 按钮 →
下载 `repro-<8-char>.test.ts` scaffold。模板包含：

- 头部注释：event id / release / error type / message
- breadcrumb 时间序列（最多 50 条）作为复现 outline
- 顶 8 个 stack frames 作为 jump-to 位置
- `expect().toThrow(/<errorType>/)` 默认断言

不是能直接通过的测试 — 是 30 秒上手的调试 scaffold。
当 +S2 state 时光机的 attachment 在时，未来版本会自动填入 arrange 段。

---

## 5. Privacy Lab (+S6) — sentori 原创

Dashboard → Monitor → Privacy。Server 后台每 15 分钟扫所有入库 events
找疑似 PII（email / phone / cc-like / address-like）。

每个 release 算 Privacy Score (0-100) + risk tag：
- ≥ 80 = low risk
- 50-79 = medium
- < 50 = high

页面三段：
1. Score gauge + risk + 当前 release 总览
2. Top leaking surfaces 表（哪个字段路径泄漏最多）
3. 最近 50 条 findings

合规团队不用再写 SQL 统计。

---

## 6. 自动生效（无需 SDK / dashboard 配置）

| 功能 | 说明 |
|---|---|
| Velocity 告警 (#5) | server cron 5 min 扫一次，issue 30m 计数 ≥3× / ≥5× prev 30m 触发邮件 |
| EAS Update / CodePush 感知 (#10) | SDK 自动 require expo-updates，event 加 bundle 字段；server expression index |
| Server schema 加 `flags` / `bundle` 字段 | 由 #10 / #13 自动填充 |

---

## 7. 现有 capture.* 配置完整示例

```ts
import { initSentori } from '@goliapkg/sentori-react-native';

initSentori({
  token: 'st_pk_...',
  release: `insight@${version}`,
  environment: __DEV__ ? 'dev' : 'prod',

  capture: {
    // 已有
    globalErrors: true,
    promiseRejections: true,
    sessions: true,
    screenshot: true,
    sessionTrail: true,

    // network 现在能配 GraphQL 子开关
    network: {
      graphql: true,         // 默认 true
    },

    // v0.9.0 新
    launchCrashGuard: {
      enabled: true,
      onLaunchCrashDetected: (info) => ({
        action: 'rollback',
        toBundle: info.lastSafeBundle,
      }),
    },

    // v0.9.1 新
    preCrashSentinel: true,  // 默认 false
  },

  sampling: {
    errors: 1.0,
    traces: 0.1,
  },
});

// 全局 mount 一次:
import { sentori } from '@goliapkg/sentori-react-native';
import { store } from '@/store';

sentori.bindState({ redux: store });   // v0.9.2 +S2
sentori.registerMaskQuery(getMaskedNativeIds);  // 既有
```

---

## 8. 升级清单

```
[ ] bun add @goliapkg/sentori-react-native@0.8.3
[ ] bun install
[ ] (可选) bun add @react-native-community/netinfo  → device.networkType
[ ] (可选) bun add expo-updates                      → OTA bundle 感知 + 启动崩溃回滚
[ ] (可选) bun add expo-sensors                      → FeedbackButton shake 触发
[ ] init 加 launchCrashGuard + preCrashSentinel + network.graphql 配置
[ ] init 后调 sentori.bindState({ redux: store })
[ ] 把 App 根用 <RageTapCapture> 包裹
[ ] 在合适入口放 <FeedbackButton trigger="shake" />
[ ] 任何 PII surface 用 <Maskable> 包裹（既有 v0.7.3 API）
[ ] 在关键 UX 流程加 sentori.startMoment('flow').end()
[ ] (可选) 实验 / experiment 处加 sentori.setFeatureFlag(...)
[ ] rebuild — 重启 app
```

---

## 还在路上 (Insight 帮忙测试时反馈)

- **#1 Mobile Vitals** (TTID / TTFD / 冷启动 / 慢冻帧) — 原生模块开发中
- **#2 Session Replay (wireframe)** — XL，原生 view-tree 遍历
- **#8 TurboModule 异常保真** — 修 Sentry 也没修的新架构 bug
- **+S1 AI 语义聚合 + 根因建议** — 需 LLM 接入
- **+S3 罪魁 commit + Revert PR** — 需 GitHub PAT 同步
- **+S7 实时调试流** — SDK control channel + server SSE
- **#15 统一移动 Issue 视图** — dashboard 收口（依赖前面 features 完整）

`docs/design/v0.9-rn-deep-dive.html` 看完整 roadmap + 决策。

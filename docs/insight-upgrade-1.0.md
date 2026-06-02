# Insight 升级笔记 — `sentori-react-native` 0.9.11 → 1.0.0-rc.1

接续 [`docs/runbook/insight-followup-2026-05-17.md`](runbook/insight-followup-2026-05-17.md)
（0.9.11 verify path + dashboard v0.9）。本文涵盖：

- 一行升级 + 验证步骤
- 接入流程**重大变化**：现在 Insight 自己在 dashboard 里 mint token、管账户、邀人，
  **不再向 Sentori 索取 token**
- v1.0 修了哪些老问题（你之前的反馈列表）
- 你接入完后能从 dashboard 直接看到什么

> **TL;DR**：`bun add @goliapkg/sentori-react-native@1.0.0-rc.1`，把
> 现有的 `token` 字面量替换成 dashboard **`/integrate`** 里 mint 的那串
> `st_pk_…`，重启 metro。其他不动。原来的接入代码继续工作。

---

## 一行升级

```sh
bun add @goliapkg/sentori-react-native@1.0.0-rc.1
bun install

cd ios && pod cache clean SentoriReactNative && pod install --repo-update && cd ..
# Android 直接 metro reset 就行：bunx react-native start --reset-cache
```

`init` API、`captureException` 等公开方法**没有破坏性变更**。所有
0.9.11 上写的代码继续工作，**这次升级是 hard-break 大版本主要是
因为 0.9.x 一个 Hermes timer 静默崩**（详见下面 "v1.0 解决的老问题
→ Replay tick"）。

可选 peer deps 跟 0.9 一样：

```sh
bun add @react-native-community/netinfo  # device.networkType
bun add expo-updates                      # OTA bundle 感知 + 启动崩溃回滚
bun add expo-sensors                      # FeedbackButton trigger="shake"
```

---

## 接入流程：现在改成**自助式**

v1.0 dashboard 上线了完整账户/项目自助管理，**Sentori 不再人工
代发 token**。你的整条接入循环现在长这样：

### 1. 在 dashboard 注册账户

[https://app.sentori.golia.jp/register](https://app.sentori.golia.jp/register)

支持三种登录方式：

- Google OAuth（推荐 — 一键，不用记密码）
- GitHub OAuth
- Email + 密码（注册后会收到一封验证邮件，**邮件真发**，
  v1.0 起接通了 mailrs SMTP）

`golia.jp` 内部账户登 takagi@golia.jp 走 Google 即可。

### 2. 创建或加入 org

第一次登录会跳 `/onboarding` 让你创建第一个 org。GOLIA 已经建好了，
直接登已有账户进去就行。

> 邀新人：左边 sidebar → **Settings** → Members 段 → `+ invite member`，
> 输入邮箱选角色（member / admin / owner），把生成的 invite 链接给对方。

### 3. 创建项目

`+ new project…` 按钮就在 sidebar 顶部 context block 里 — 项目选择
下拉旁边的 `+` icon（**admin/owner 才看得到**）。点它会跳到
`/org/{slug}/settings#new-project`，create project 表单已经展开好。

填项目名（slug 会自动生成）→ 创建 → 自动出现在 sidebar 项目下拉里。

### 4. Mint ingest token + 拿接入代码

新建项目后**最关键的一步**：左边 sidebar → **Organize → Integrate**
（或者从 Overview 项目卡片右下角点 `integrate →`）。

页面三段：

- **Project** — 显示 project id（接 SDK 不需要这个，**只在 dashboard
  URL 里用到**）
- **Ingest tokens** — `+ mint token` 按钮。labelable（建议起名
  `insight-prod` / `insight-dev` 之类区分环境），**secret 只显示一次**，
  立刻 copy 走，不然就只剩 last4 了
- **React Native quickstart** — install 和 init 两个 snippet，**init
  里已经替换好你刚 mint 的 token**，整段 copy 就能用

### 5. 把 init snippet 粘进 Insight 入口

snippet 长这样（token 字段已替换为你 mint 的真值）：

```ts
import * as Sentori from '@goliapkg/sentori-react-native'

Sentori.init({
  token: 'st_pk_…你刚 mint 的那串',
  release: 'insight@1.0.0+1',          // app.json 的 version+buildNumber
  environment: __DEV__ ? 'dev' : 'prod',
  // ingestUrl 默认 https://ingest.sentori.golia.jp — 不用填
})
```

建议放在 `App.tsx` 顶部 `import` 后第一行，或者更靠前的 `index.ts`。
**init 是同步的、idempotent 的、不阻塞首屏**，越早调越好。

### 6. 第一条事件穿过来

手抛一个错验证：

```ts
import { Button } from 'react-native'
import * as Sentori from '@goliapkg/sentori-react-native'

<Button title="Throw" onPress={() => {
  Sentori.captureException(new Error('hello from insight'), {
    tags: { feature: 'smoke-test' },
  })
}} />
```

10 秒内回 dashboard `/org/golia/issues?project=…` 应该能看到这条
issue 进来。点进去能看到：

- Stack trace（dev bundle 已自动 sourcemap）
- 设备信息条
- 事件 timeline / breadcrumbs
- **Replay tab**（如果 init 时启用了 wireframe，默认启用）
- 你之前指出的 attachment 通路：screenshot / session-trail / replay 都
  会以正确的 kind 入库

---

## v1.0 解决的老问题

按你之前的反馈列表对应（0.9.11 followup + dashboard v0.9 + 后续 SDK
迭代）：

### 1. **Replay tick 不触发**（Insight 2026-05-17 verify 的根因）

**症状**：JS `[sentori] replay: starting bound=true hasCaptureWireframe=true`
打出来后，**30 秒内一条 tick log 都没有**，replay attachment 永远是
0 帧。

**根因**：`replay.ts` 里 `setInterval` 返回值在 Hermes 0.81+ 上是
plain `number`，旧代码用 `timer.unref?.()` 走 optional chaining
→ JS 引擎查 `Number.prototype` 没有 `unref` → 返回 `undefined`
→ optional chain 不报错就直接静默吞 throw → setInterval **注册了
但 callback 永远不调度**。

**修复**：1.0.0-rc.1（实际从 0.9.12 起）删掉 `.unref?.()` 调用。
RN 环境本来就不需要 `unref`（不像 Node）。

**验证**：升级后 metro log 应该看到 unconditional FIRST INVOCATION
log + 周期性 tick log。

### 2. **Replay attachment 400 invalidKind**

**症状**：dashboard 上 attachment 行显示 `○ replay`（空圈），server
日志看到 `400 invalidKind`。

**根因**：migration 0043 加了 DB CHECK 接受 `replay` kind，但
application 层 `attachments::ALLOWED_KINDS` 白名单忘了同步更新。
SDK 上传的每条 replay 都被早期校验挡掉。

**修复**：v1.0-rc.1 已包含；也允许 `application/x-ndjson` media-type
进 replay 通道。

### 3. **iOS screenshot 返回 null / replay wireframe 返回 null**

**症状**：metro log 看到 `[sentori] native screenshot returned null …`
或者 `[sentori] replay tick: native returned null`。

**根因**：iOS keyWindow 在 multi-scene / multi-window 应用下不一定能
找到。原来只查 `UIApplication.shared.connectedScenes.first { ... }
.foregroundActive` 一种状态，foregroundInactive scene 就找不到。

**修复**：1.0.0-rc.1 native 通路用 4 层 fallback：

1. `foregroundActive` scene
2. `foregroundInactive` scene
3. 任何 `UIWindowScene` 的任何 window
4. legacy `UIApplication.shared.windows`

加诊断 NSLog + `probe()` 方法供 JS 查询：

```ts
import * as Sentori from '@goliapkg/sentori-react-native'

// dev 调试用
const p = await Sentori.probeNativeWireframe()
// { path: 'foregroundActive' | 'foregroundInactive' | 'anyWindowScene' | 'legacyWindows',
//   nodes: number, scenes: number, windows: number }
```

如果升级后还看到 `screenshot returned null`，把 `probe()` 输出贴
issue，我们再继续在 `SentoriScreenshotCapture.swift` 里 narrow。

### 4. **替换 `@sentori/react-native` 包名**

`@sentori/react-native` 已经被弃用了，所有文档 / README / sample 现在
统一引 `@goliapkg/sentori-react-native`。功能等价，只是发布命名空间
统一。

如果你 package.json 还有 `@sentori/react-native` 引用，请删掉换
新名 — 老 namespace 不会再发新版本。

### 5. **password reset / email verification 实际不发邮件**

老情况是：dashboard 触发 reset 流程后，server 把 reset link 写进
tracing INFO，但 SMTP 没接，邮件**真的没出去**。

**修复**：v1.0 server 起 `notifier` SMTP transport（mailrs 端，
`mail.golia.ai`），forgot-password / verify-email / superadmin
seed reset link 都通过 SMTP 实际发。你 `lihao@golia.jp` / takagi
之前点 reset 看到的「link is on its way」**确实会到邮箱**了，不再
需要去 ssh 抓 server 日志。

### 6. **OAuth `/auth/oauth/{provider}/callback` 落到 SPA 不是 server**

老情况：点 "Continue with Google" → 走完 Google 同意页 → 被退回
dashboard → 又落到登录页（看起来像 OAuth 失败）。

**根因**：OAuth app 注册时 callback URL 是
`https://app.sentori.golia.jp/auth/oauth/google/callback`（不带 `/api/`），
但 Caddy 只把 `/api/*` 和 `/admin/*` 转发到 server，`/auth/*` 落到
默认 handle 进了 SPA。

**修复**：Caddy 加了 `/auth/*` rewrite，把 URL 改写成 `/api/auth/*`
再 forward 给 server。**OAuth 注册时填的 callback URL 不用动**，
你重试 Google / GitHub 登录都能正常完成。

### 7. **Account 模块功能缺失**

老情况：dashboard 只有 issues / traces / overview，没有账户管理、没有
project token UI、没有 OAuth、没有 forgot password、没有
sign-out-everywhere、没有头像、没有 invite。

**修复**：v1.0 完整补齐 GitHub-style account 模块，**Sentori 不再
需要 SSH 进 prod 给你建 user/role 改密码**。具体见上面 "接入流程"
那段。

完整 e2e 测试覆盖（rust 集成 11 例 + Playwright UI 8 例）在 CI 里
跑 — 这块以后不会回退到要我们手动救火的状态。

### 8. **没法在 dashboard 自己 mint project token**

老情况：要发新 SDK token 得在 server 端跑 SQL 或者 ssh 进 prod 用
admin password 调 admin API。

**修复**：v1.0 上线 **`/integrate`** 模块（左边 sidebar Organize →
Integrate）— UI 化 token mint / list / revoke，secret 只显示一次的
GitHub PAT 体验。同时也是个 SDK quickstart 页 —— init snippet 自动
帮你填好 token。

---

## 升级后的 dashboard 体验

跟 0.9.11 时期相比，dashboard 也大变了，把你能用到的几个 surface
列一下：

| 路径 | 之前没有的能力 |
|---|---|
| `/account` | profile + avatar (Gravatar) + change password + sign out everywhere + verify-email banner |
| `/org/{slug}/integrate?project=…` | token 自助管理 + SDK quickstart snippet |
| `/org/{slug}/settings` | members 管理 + teams + project create + 项目级 source-repo URL |
| `/superadmin` | （只对 `is_superadmin=true` 的人显示）跨 org 用户/项目管理 |
| 顶部 toolbar 右侧 avatar | GitHub-style dropdown: Account / Activity / Sign out |
| 左侧 sidebar context block | `+ new org` / `+ new project` 单独图标按钮（之前藏在 select 选项里） |

---

## 验证升级是否成功

跟 0.9.11 那次 verify 一样的体感：

### 1. SDK 通路

```sh
npx react-native log-ios | grep '\[sentori\]'
```

Fresh boot + 1 captureException 应该看到：

```
[sentori] native module bound; exposed methods: …, captureScreenshotWithMask, captureWireframe, …
[sentori] replay: starting bound=true hasCaptureWireframe=true
[sentori] replay tick #1 nodes=NN bytes=NN
[sentori] captureException eventId=… breadcrumbs=N wantScreenshot=true wantSessionTrail=true
[sentori] screenshot blob ok, uploading … mediaType=image/jpeg base64Bytes=~40000
[sentori] enqueue … attachments=2 kinds=screenshot,replay
```

跟 0.9.11 差别就一条：**replay tick 真的会 fire**（这是核心修复）。

### 2. Dashboard 落地

刷新对应 issue detail page：

- header 上 attachment 行：`● screenshot · ● replay`（实心圆，都有了）
- **Replay tab** 可点；进去能看到 60 帧 wireframe ring，scrub /
  prev / next / play 按钮 + 横向 thumbnail rail + 键盘 ← → space
  导航
- "◉ diff vs prev" toggle — 帧间 added / changed / removed 节点高亮

如果 replay tab 是空（"no frames yet"）：
- 检查 init 的 `capture.replay` 没显式关掉（默认 'wireframe' on）
- 看 metro log 有没有 `[sentori] replay tick` —— 没有的话回到第 1 节
  那张诊断表

---

## 还没动的东西（接入不影响）

下面这些 0.9 时期的笔记继续有效，v1.0 没改：

- [`docs/insight-upgrade-0.8.md`](insight-upgrade-0.8.md) — GraphQL
  operation 命名、Rage tap、Feature flags、measureFn、Velocity 告警、
  Moments / 流失追踪、OTA bundle 感知
- [`docs/runbook/insight-followup-2026-05-17.md`](runbook/insight-followup-2026-05-17.md)
  — Insight findings 1–6 的修复说明、`pod install --repo-update`
  注意事项

---

## 沟通规约

跟之前一样：

- SDK 路径上的 bug → metro log 贴最近 30 行 [sentori] 开头的 + `probe()`
  输出
- Dashboard / server 行为问题 → screenshot + URL + event_id（issue
  detail URL 末段那串 UUID）
- 接入 / 账户 / token 自助流程问题 → 直接 dashboard 操作，不需要
  alert Sentori 同学；只在 confirm 真的是 server bug 才提

---

_最近一次更新：2026-05-17，对应 `@goliapkg/sentori-react-native@1.0.0-rc.1`、
`sentori-server v1.0.0-rc.1`、`app.sentori.golia.jp` v1.0.0-rc.6+。_

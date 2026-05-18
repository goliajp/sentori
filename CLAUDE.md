# Sentori — Claude 协作约定

## 铁律：Sentori 几乎不能造成 host app 的性能抖动

**只会有人喜欢"免费"的探测器**。一旦 host app 因为接入 sentori 出现可感卡顿（main thread block、frame drop、ANR、电量异常），integrator 立刻就有理由拔掉。这条直接攻击产品定位，**这事失败了项目就没了**。

任何新增 SDK 行为（采样率提升、新 walker pass、新序列化路径、新 native 反射、新 background timer……）都要先估算且实测对 host app 的成本，再才能 ship default。粗略目标：

- 主线程额外占用 `< 1%` 在中端机
- 任何 single-tick > 5ms 标红，要么 background-thread 化、要么砍频率
- 默认值要保守。任何"为了体验提升所以采样更高/做更多"的改动都要让用户**显式 opt-in**，不要默认开

### 三条线都要测

不能只盯 CPU。每次 SDK 改动要分别 verify：

**1. 渲染（Rendering）** — UI frame rate / paint latency / layout jitter
- iOS: Xcode Instruments → Time Profiler + Core Animation FPS；或 simctl 看 `FrameRate` 信号
- Android: `adb shell dumpsys gfxinfo <pkg>` 拿 jank percentile / 99th frame time
- 标准：sentori 接入前后 frame drop 数差异 < 1%

**2. 逻辑（Logic / CPU）** — main thread + JS thread occupation
- Hermes Performance Monitor / `sentori.replay.tick` span 看 per-tick 耗时
- iOS: native captureWireframe 已经包在 `startSpan` 里，可直接读
- Android: 同上 + `adb shell dumpsys cpuinfo <pkg>` 看主线程 CPU 占比
- 标准：每 tick main thread < 5ms；累计占用率 < 1%

**3. 网络（Network）** — bandwidth + request count
- Mock-ingest 数 `POST /v1/events/.../attachments/*` 频次，总 bytes
- 标准：60s 一次 captureException 总流量 < 500 KB；replay attachment < 200 KB

### 性能 P0 优先级

性能问题报告（"app 卡了"、"ANR"、"frame drop"）= P0，比 feature gap 优先。先回滚再 debug。

### 平台不对等很常见

iOS 直接读 `UIView.backgroundColor`；Android 要走 ColorDrawable / GradientDrawable / 反射 `getBackgroundColor()`，开销几倍。同样的逻辑两边性能不对等是常态——必要时**让 default 因平台而异**（如 Android 2Hz / iOS 4Hz），不要追求 cross-platform 一致而强 iOS 退就 Android。

---

## 沟通语言

- **默认中文沟通**。所有面向用户的回复、阶段总结、提问、状态更新都用中文。
- 例外：代码、commit message、文档（`docs/`、`docs-site/`、`README.md`）保持英文，因为它们是产品对外面的稳定文本。
- 终端输出 / 命令引用保持原样；不强行翻译技术术语（DSN、token、webhook 等）。

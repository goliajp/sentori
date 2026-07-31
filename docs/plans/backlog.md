# Sentori — 产品讨论 backlog

这份 doc 收产品讨论里**明确确认要做、但当前不启动**的能力项。加入这份 doc 的门槛:用户在讨论中说了「记到 backlog」。

不是 P0-P3 优先级表,也不是 sprint plan —— 那是 `bundle-schema.md`、`native-symbolicate.md` 等具体设计 doc 的事。这里只保证「讨论时 pin 过的东西不丢」。

---

## B-01 — JS ↔ Native 穿透:三步基础设施

**记入日期:2026-07-24**

**产品目标:** Bundle 里两侧 stack 能关联,LLM 能看到「JS 传 null token → native 抛 NilToken exception」的完整故事。方向 A(native crash 反查 JS 触发点)和方向 B(JS 收 opaque JSError 反查 native 原因)共享同一份基础设施。

**三步:**

1. **JS 侧记录** —— SDK init 时 wrap `TurboModuleRegistry` 返回的 module proxy;每次方法调用前 `new Error().stack` 抓当前 JS 栈,存进 SDK 内部 ring buffer(带 timestamp,±1s TTL)。
2. **Native 侧记录** —— Native 层拦异常发生点,把 native stack 抓下来存到 ring。现有 `SentoriNativeExceptionBridge` 是 partial(要求 host 团队手工 opt-in per module);要变全自动,需要在 SDK 内部 hook 更底层的入口。
3. **合并 payload** —— JS 层 coerceError / native 层 crash handler 触发时,查两侧 ring 里 ±1s 内的 entry;有的话拼进 payload:
   - 方向 A:native crash payload 附「Triggered from JS: …」
   - 方向 B:JS error 事件附「Underlying native exception: …」

**当前状态:**

| | |
|---|---|
| 第 1 步 JS 侧记录 | ✗ 完全没做 |
| 第 2 步 Native 侧记录 | ⚠ Partial(`SentoriNativeExceptionBridge`,需 host 手工埋点)|
| 第 3 步 合并 payload | ⚠ JS 侧 coerceError 只查方向 B,不查方向 A |

**依赖:** dSYM(iOS)/ ProGuard mapping(Android)必须先做完 —— 没有它们,穿透过去的 native 栈仍是 hex offset / obfuscated 名,LLM 看不懂。

**最难的地方:** 第 1 步的自动 hook。RN legacy bridge 时代(< 0.68)较易(一个中心 message queue 入口全覆盖);JSI / TurboModule / New Architecture(≥ 0.68)较难(每个 module 都要单独 wrap 方法 proxy)。

**详细技术方案:** 见 `native-symbolicate.md` G5 节(有更早期的 G5.1 / G5.2 / G5.3 分层,以 iOS legacy bridge / TurboModule / Android JNI 三条路线展开)。

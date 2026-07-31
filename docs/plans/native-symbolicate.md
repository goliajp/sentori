# RN Native ↔ JS 穿透 + Native 符号化完整度

**创建日期:2026-07-23**。这份 doc 拆解「让 bundle 里 stack trace 段真正 100% 符号化到源码,并且 native crash 能反查到 JS 触发点」需要什么。是 bundle-schema.md 里 P0 gap 的具体设计。

## 目标(bundle 里的可用形态)

Bundle 里 stack trace 段最终要长这样:

```
Stack trace — TypeError: Cannot read properties of null (reading 'value')

1. handlePaymentSubmit                    ← JS frame, symbolicated
   at src/screens/CheckoutScreen.tsx:142:23
   ```
   140  const onPay = () => {
   141    const token = TokenService.getActive();
   142    return processPayment(token.value);   ← throws
   143  }
   ```

2. processPayment                          ← JS → Native bridge crossing
   at PaymentModule.mm:87  (via TurboModule call)
   ```
   85   RCT_EXPORT_METHOD(pay:(NSString *)token) {
   86     if (token == nil) {
   87       [NSException raise:@"NilToken" ...];  ← native throw
   ```

3. -[PaymentBridge processPaymentWithToken:]  ← Native frame, symbolicated
   at PaymentBridge.mm:34
   ```
   32   - (void)processPaymentWithToken:(NSString*)t {
   33     NSAssert(t.length > 0, @"Empty token");
   34     [self.gateway charge:t];
   ```

Triggered from JS: src/screens/CheckoutScreen.tsx:141 (token was null)
```

**关键要求:**

- 每一帧都有 `file:line:col + function name`,没有 `<anonymous>` / `bundle.js:1:12345`
- 每一帧有 ± 2 行源码
- **native frame 后能跟一个「Triggered from JS」段** —— 反查触发 native 崩溃的 JS 位置
- JS ↔ Native 边界清楚标出

## 三种 RN crash 场景

拆开好定位每种要什么:

**场景 A — 纯 JS crash**  
JS 层 uncaught → RN error boundary → 上报。栈全在 JS 侧,只需要 sourcemap。**基础场景。**

**场景 B — Native crash (无 JS 触发)**  
Native 层出问题(Objective-C exception / Java Throwable / SIGSEGV)—— 例如后台线程崩、init 崩。栈全在 native 侧,需要 dSYM(iOS) / ProGuard mapping(Android)。

**场景 C — JS 触发 Native crash**  
JS 调 TurboModule / native module,native 里挂了。栈可能有两种形态:
1. Native 侧抛 Exception → TurboModule 包装成 JSError → JS 层收到时只看到「the operation couldn't be completed」的 JSError,**根因(native stack)完全丢失**
2. Native 侧 SIGSEGV → 整个进程崩,JS 层根本收不到,JS 触发点也丢失

**场景 C 是最难也是最有价值的**。差异化点主要在这里。

## 现有实现 audit

### JS 侧 sourcemap (场景 A)

| 项 | 状态 |
|---|---|
| CLI `sentori-cli upload sourcemap` | ✓ 有(未直接看代码但从命名推测)|
| Server `symbolicate.rs` sourcemap 解析 | ✓ 完整,含 cause chain,含 minified 原坐标保留 |
| Server 在 ingest 时符号化(不是读时) | ✓ |
| **生产实际用过** | **✗ `release_artifacts` 表全空,从未验证过 pipeline 端到端** |

**gap:pipeline 存在但从未真跑通过**。dogfood 期客户都跑 dev bundle(生产 payload 里全是绝对路径 `/Users/doracawl/workspace/qualcomm/insight/...`),没触发 sourcemap 路径。

### iOS Native crash (场景 B)

| 项 | 状态 |
|---|---|
| `SentoriCrashHandler.swift` NSException 抓 | ✓ 有(全局 uncaught)|
| Stack frame parse | ⚠ **只有 module + function 字符串,file 和 line 全 0** |
| 端上 signal-based crash 抓(SIGSEGV/SIGABRT)| ✗ 明确 out,注释里说 "explicitly out" |
| CLI `sentori-cli upload dsym` | ✓ 有,支持多 slice(arm64/x86_64)|
| Server dSYM upload endpoint(`/admin/api/projects/:id/dsyms`)| ⚠ 端点存在(CLI 端在打),后端实现未确认 |
| Server dSYM 符号化 pipeline | **✗ `symbolicate.rs` 只查 `kind='sourcemap'` —— dSYM 上传了也不消费** |

**gap:三层脱节。SDK 只拿到 module 级 stack,dSYM 上传能到 server 但 server 不用,即使用了 SDK 也没提供 binary offset 让 server 能查回 file:line。**

### Android Native crash (场景 B)

| 项 | 状态 |
|---|---|
| `SentoriCrashHandler.kt` Throwable 抓 | ✓ 有(global uncaught handler)|
| Java stack file:line | ✓ Throwable API 自带,可以拿到 |
| 端上 SIGSEGV / NDK crash 抓 | ✗ 明确 out(注释:"Phase 7 explicitly skips signal-based handlers") |
| CLI `sentori-cli upload mapping` (R8/ProGuard) | ✓ 有 |
| Server mapping upload endpoint | ⚠ CLI 打 `/admin/api/projects/:id/mappings`,后端实现未确认 |
| Server ProGuard demangling | ✗ 同 dSYM,`symbolicate.rs` 不消费 mapping |

**gap:类似 iOS。Java 名称是 minified 的(release build 都 R8 过),没 mapping demangling 就是「a.b.c() at Unknown:1」,LLM 完全没法用。**

### JS ↔ Native 穿透(场景 C)

| 项 | 状态 |
|---|---|
| `SentoriNativeExceptionBridge` iOS/Android | ⚠ **partial fix —— host 团队要在每个 native module 里手工 try/catch + call record** |
| 自动 hook TurboModule 调用点 | ✗ 没做 —— 注释里说 "We can't easily swizzle the C++ ObjCTurboModule call site" |
| JS 调用栈 → Native 侧关联 | ✗ 没做 —— native crash 时不知道触发 JS 位置 |

**gap:场景 C 只覆盖了「host 主动埋点的 module」。RN 内置 module(Camera / Location / Storage / Bluetooth 等第三方 module)通通不覆盖。**

## Gap 汇总

按「阻塞程度 × 差异化程度」排:

| Gap | 阻塞 | 差异化 | 复杂度 | 优先级 |
|---|---|---|---|---|
| **G1** JS sourcemap pipeline 生产验证 | 高(bundle stack 段基础)| 低(所有竞品都有)| 低 | **P0** |
| **G2** iOS dSYM 端到端 pipeline(SDK 上报 binary offset + server 消费 dSYM)| 高(iOS stack 段全空)| 中 | 中 | **P0** |
| **G3** Android ProGuard/R8 mapping 端到端 pipeline | 高(Android stack 段全 minified)| 中 | 中 | **P0** |
| **G4** SDK 采 preContext / postContext | 中(bundle 有源码段,但依赖 G1/G2/G3)| 高 | 中 | P1 |
| **G5** JS ↔ Native 自动 hook(不需要 host opt-in)| 中(场景 C 覆盖率)| **★★ 高** | 高 | P1 |
| **G6** iOS 信号级 crash(SIGSEGV/SIGABRT via KSCrash-like)| 中(纯 native crash 场景)| 中 | 高 | P2 |
| **G7** Android NDK SIGSEGV(breakpad/crashpad)| 中 | 中 | 高 | P2 |

## 每个 gap 的技术方案

### G1 — JS sourcemap 生产验证

**方案:** 极小工作。
1. dogfood 项目 `focus-ai-app` production build 时,build script 加一步 `sentori-cli upload sourcemap`
2. 观察生产 event 里 stack frame 的 `symbolicated=true` + `minifiedFile` 存在
3. 如果失败,`symbolicate.rs` 已经有 warn log 说 "map unparseable" / "blob read failed"

**复杂度:** 半天。主要是 dogfood 项目 build config 改造 + 端到端跑一遍。

### G2 — iOS dSYM 端到端

**方案:**

**SDK 侧改造(需要 KSCrash-style 上报):**
- `SentoriCrashHandler` 里 frame parse **不应该**尝试从 `callStackSymbols` 字符串手工 parse
- 直接抓 `[NSException callStackReturnAddresses]` → 每个 `NSNumber` 是一个 return address(uintptr_t)
- 同时抓 `[[UIDevice currentDevice] loadedLibraries]`(或用 `_dyld_image_count` / `_dyld_get_image_header` / `_dyld_get_image_vmaddr_slide` API)拿每个加载 image 的 UUID + base address
- Payload 里 stack 变成:
  ```
  { "instruction_addr": "0x1a0b8", "image_uuid": "ABCD...", "image_load_addr": "0x100000000" }
  ```

**Server 侧改造:**
- `release_artifacts` kind 加 `'dsym-macho'`(每个 arch slice 一个 blob,keyed by UUID)
- 新增 `dsymicate.rs`(或扩展 `symbolicate.rs`)
- 收到 frame 时用 UUID 查 dSYM,用 `instruction_addr - image_load_addr` 得到 binary offset,用 dSYM 里的 DWARF 表查回 `file:line:func`
- Rust 侧可用 `symbolic-debuginfo` crate(Sentry 官方开源,现成解决方案)

**复杂度:** 3-5 天。`symbolic-debuginfo` 是关键库,不用自己 parse DWARF。

### G3 — Android ProGuard/R8 mapping demangling

**方案:**

**SDK 侧:**
- Java Throwable stack 已经有 `className.methodName(File.kt:line)` —— 拿到就发,不用改
- 关键是 release build 里 className / methodName / File 都被 R8 rename 了

**Server 侧:**
- `release_artifacts` kind 加 `'proguard-mapping'`
- 新增 mapping 解析(格式简单,自己 parse 或用 `proguard-mapping-rs` 之类的 crate)
- 收到 frame 时按 `a.b.c` 逆向映射回 `com.example.PaymentModule.handlePaymentSubmit`

**复杂度:** 2-3 天。mapping 格式简单,主要工作是 parser + server 集成。

### G4 — preContext / postContext

**方案 A(SDK 侧,受限):**
- iOS/Android crash handler 触发时,如果 file 已知(dev bundle 或 dSYM 解出)且可 access filesystem → 读 file 前后 3 行填 preContext / postContext
- 生产 build 里 SDK 拿不到源码(bundle 没打进去),这条路只在 dev 有效

**方案 B(Server 侧,推荐):**
- Server 在生成 bundle 时,如果客户接了 git repo(bundle-schema.md 里的 Related code 段依赖同一集成):
  - 按 stack frame 的 `file:line` + release 关联的 git commit → git blame → 拉 ± 3 行
  - 直接写进 bundle 的 stack trace 段

**复杂度:** 方案 B 中等,依赖 git 集成先做。方案 A 只对 dev 有效,不投入。

### G5 — JS ↔ Native 自动 hook(★ 最有差异化)

**方案:** 这是本 doc 里最难也最有价值的一块。分成三个子方案:

**G5.1 — JS 侧 hook TurboModule proxy**  
- RN 有 `TurboModuleRegistry.get(name)` 返回的 module proxy
- 在 SDK init 时,包裹这个 registry:每次 `.get(name)` 返回时,把每个方法包一层
- 包装做的事:
  - 调用前:`captureJSStack()`(用 `new Error().stack` 抓 JS 层调用栈)存到 SDK 内部 map
  - 调用中:如果 native 侧 throw / promise reject / async future error → SDK 捕获,附上刚才的 JS 栈
  - 调用后:清理
- **优势:** 100% 覆盖所有 TurboModule 调用,不需要 host opt-in
- **劣势:** 每次 module 方法调用有一点 overhead(抓 stack 的 cost)
- **可行性:** 高。RN JS 侧 SDK 已经有 `capture.ts` 做类似 hook 的地方(`coerceError` 就是切入点)

**G5.2 — Native 侧 hook TurboModule 调用点(iOS)**  
- iOS 的 `RCT_EXPORT_METHOD` 展开出的 wrapper 里 —— 这些 wrapper 是编译期生成的,不能全局 swizzle
- 但 `RCTBridge -invokeCallableModule:method:params:` 是所有 legacy bridge 调用的入口 —— 可以 method swizzle
- TurboModule 走 `-[RCTTurboModuleRegistry moduleForName:]` + JSI 直接绑定,较难
- **可行性:** legacy bridge 侧较易,JSI/TurboModule 较难

**G5.3 — Native 侧 hook(Android)**  
- Android 的 TurboModule 方法通过 JNI 调用,可以 hook `NativeMethodBridge` 层
- 或者用 Android 的 `Thread.setUncaughtExceptionHandler` 每个 native module 线程 —— 但这已经太晚(exception 已经 propagate)

**推荐:先做 G5.1(JS 侧 hook),覆盖率最高,复杂度最低。G5.2/G5.3 作为后续增强。**

**复杂度:** G5.1 一周。核心工作在 JS 侧 wrapping 逻辑 + `capture.ts` 里 `coerceError` 集成,与 SDK 现有 architecture 融合。

### G6 — iOS SIGSEGV/SIGABRT

**方案:** 集成 KSCrash-like signal handler。SDK 内嵌一个信号处理器:
- 注册 SIGSEGV / SIGABRT / SIGBUS / SIGILL / SIGFPE
- 信号触发时,尝试用 async-signal-safe API 写一个 crash report 到 filesystem(不能调 Objective-C runtime!)
- 下次启动时 JS side 读这个 report 并上报

**复杂度:** 高。信号处理器写错就是 undefined behavior,坑很多。**推荐直接依赖开源 KSCrash 或 PLCrashReporter**,不要自己写。

**优先级 P2:** 场景 B 的一部分,但不是最紧迫的差异化点。等 G5 做完再上。

### G7 — Android NDK SIGSEGV

**方案:** 类似 iOS,依赖 Google breakpad 或 crashpad。工程量大。

**优先级 P2:** 同 G6。

## 建议下一步

**先做 G1 + G2 + G3 三个 P0**,因为:
- 三个加起来才让 bundle 的 stack trace 段真正 100% 符号化(否则 stack trace 段是废的)
- G1 半天,G2 3-5 天,G3 2-3 天 —— **总 1-2 周**
- 做完后有第一个真正**可发给 LLM 消费的 bundle**

**G5(JS ↔ Native 穿透)是差异化关键,但依赖 G1-G3 做完才能显效** —— 如果 native stack 都还是 `<Foundation> _ZN...` 那种,穿透过去也没意义。做完 P0 再上 G5。

**G6/G7(signal-based crash)可以晚很多**。它们是「兜底覆盖率」提升,不是「LLM 可用性」的关键。

## 顺带发现的清仓项

**dSYM/mapping endpoint 检查** —— CLI 打 `/admin/api/projects/:id/dsyms` 和 `/mappings`,后端到底实不实存在需要看一下 `handlers/admin/releases.rs` 和 `artifacts_upload.rs`。如果 endpoint 是 404,那 CLI 是「written but never running」的又一个案例(memory 里那条铁律)。这是**开工 G2/G3 前的第一件事**。

**生产 `release_artifacts` 空表** —— 22 天 dogfood 从未上传过任何 sourcemap / dSYM / mapping。原因:dogfood 项目跑 dev build,没触发 build script 的 upload 步骤。做 G1 时会一起发现。

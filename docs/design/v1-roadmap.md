# Sentori v1.0 ROADMAP (L1-L4)

> 紧接 `docs/design/v0.9-roadmap.md`。v0.9.0 / 0.9.1 / 0.9.2 已 ship 12
> 项（详见 v0.9-roadmap.md 历史段）。这份是把**剩余 9 项**归到 v1.0
> 整体范围。

## L1 — 总目标

把 sentori RN SDK 从"行业对齐 + 部分原创领先"推到 **v1.0 = 完整的
RN-first 一站式可观测平台**。9 项工作（除 +S1 AI 语义聚合外的全部
deep-dive gap），覆盖原生模块 + dashboard 收口 + server SSE。
Acceptance：Insight 在 v1.0 SDK 上 dogfood ≥ 30 天稳定。

> +S1 AI 语义聚合不进 v1.0 — LLM API 接入需要单独 ops 决策，
> 单独 v1.1 路径。

## L2 — 版本边界（拍定不动）

### v0.9.3 — Dashboard 收尾 + 原生小补丁 · ~2 周 · 3 项

无大原生新模块，工作集中在 dashboard + 一小块 native hack + server。
让 Insight 当前 0.8.5 dogfood 期间立刻可见的体验深化。

| # | 名称 | Effort | 范围 |
|---|---|---|---|
| +S2-VIEW | State 时光机 dashboard viewer | M | dashboard only |
| #8 | TurboModule 异常保真 | M | sdk-rn 原生 (iOS + Android) |
| +S3 | 罪魁 commit + Revert PR | M | server (git sync + GitHub API) |

### v0.9.4 — 移动性能可视化 · ~3 周 · 2 项

需要原生 module + 真机验证。可与 Insight 配合测试。

| # | 名称 | Effort | 范围 |
|---|---|---|---|
| #1 | 移动 Vitals (冷启动+TTID/TTFD+帧) | L | sdk-rn 原生 + server schema + dashboard |
| #4 | JS profiling (Hermes 采样) | L | sdk-rn Hermes wrapper + server parser + dashboard flame |

### v1.0 — Replay + NDK + Live + 收口 · ~4 周 · 4 项

XL replay + 多原生 + dashboard 收口 unified view。一个 release 不细拆。

| # | 名称 | Effort | 范围 |
|---|---|---|---|
| #2 | Session Replay (wireframe) | XL | sdk-rn 原生 view-tree 遍历 + server attachment + dashboard SVG |
| #7 | Android NDK 崩溃 | L | sdk-rn 原生 breakpad + server symbolicator |
| +S7 | 实时调试流 | L | sdk-rn control channel + server SSE + dashboard live viewer |
| #15 | 统一 mobile Issue 视图 | M | dashboard only (依赖 #1/#2/#4 完整) |

总计 9 周 / 9 项 / 1 个 SDK XL + 4 L + 4 M。

## L3a — Hot plan: 当前 checkpoint = **v0.9.3** 第一项

每步必须有检测命令。Test-driven。无分叉。

### Step 1 (+S2-VIEW): State 时光机 dashboard viewer

把 SDK 端 ship 过的 `stateSnapshot` attachment 在 dashboard 上画
出来 — 时间轴 + 当前快照 diff viewer。

1. **read** `web/src/components/AttachmentGallery.tsx` 看 attachment
   渲染入口
   - check: 找到 stateSnapshot kind 当前怎么 render（大概是 raw JSON）
2. **add** `web/src/modules/issues/state-timetravel.tsx` 新组件
   - props: `{ projectId, eventId, attachmentRef }`
   - fetch `/admin/api/events/{eventId}/attachments/{ref}` 拿 JSON
   - 解析 `{ snapshots: [{ ts, source, diff }, ...] }`
   - 左 column: timeline scrubber (snapshot 序号 / source 标签 /
     relative ts)
   - 右 column: 当前选中 snapshot 的 diff JSON 树（递归 expandable）
   - 加 "rehydrate forward" 按钮 — 应用所有 diff 累加到当前位置
     成完整 state snapshot
   - check: `bunx tsc --noEmit` 0 错
3. **wire** issue detail Stack tab 在有 stateSnapshot attachment 时
   渲染该组件
   - check: typecheck
4. **edit** `AttachmentGallery.tsx` — stateSnapshot kind 默认走新
   viewer，而不是 raw JSON download
   - check: typecheck
5. **dashboard run** `bun run dev` — 视觉确认
   - check: `bun run check` 不报错
6. **commit**: `dashboard: +S2 state time-travel viewer`

完成 step 1 后 mark task as completed，开始 step 2 (#8).

## L3b — Cold plan (v0.9.3 剩余 + v0.9.4 + v1.0)

每项粗述。Hot plan 升级时再细化。

### v0.9.3 剩余

- **#8 TurboModule 异常保真**: 在 iOS 端 swizzle / patch
  `ObjCTurboModule::performVoidMethodInvocation` 捕获 NSException
  在 RN wrap 成 JSError 之前。Android 端 reflection 拦
  `TurboModule.invokeMethod`。stash 在 per-thread holder，下次
  `coerceError` 调用时附原生 stack 到 JS event。**风险**：每个 RN
  minor 可能破。dispatch table by RN version。
- **+S3 罪魁 + Revert PR**: server 加 `commits` 表 sync from GitHub
  (project.source_repo_url + 项目级 PAT)。Issue first_seen ± 7d
  window 内的 commits 与 throw line 文件路径相关性打分。Dashboard
  issue detail 顶部加 "Likely culprit" 行 + "Generate revert PR"
  按钮（POST 到 GitHub API）。

### v0.9.4

- **#1 移动 Vitals**: 新 iOS class + Android class. 冷启动:
  `mach_absolute_time` / `Process.getStartElapsedRealtime()`. 慢/冻帧:
  `CADisplayLink` / `Choreographer.FrameCallback`. TTID: 扩
  `useTraceNavigation` 在 react-navigation transition + first frame
  之间记 span. TTFD: manual `markTimeToFullDisplay`. Server 加
  `mobile_vitals` 表 + per-route/release 聚合. Dashboard 加
  `Mobile` tab.
- **#4 JS profiling (Hermes)**: SDK wrap `HermesAPI.startSamplingProfiler`
  / `dumpSampledTrace`. `on-slow-frame` 模式默认（依赖 #1 慢帧检测）.
  Server 解析 Hermes profile format → flame graph payload.
  Dashboard 新 flame view (横向 bar 显示 stack 分布).

### v1.0

- **#2 Session Replay (wireframe)**: 原生 view-tree walk 序列化
  `{kind, rect, text|maskedText, bgColor, isImage}` newline-JSON.
  1 Hz off-main. Gzipped NDJSON 作 attachment (D5). 60s ring buffer
  on-error + 持续 sampleSessionRate. Dashboard SVG renderer
  rasterizes wireframes 浏览器端.
- **#7 Android NDK**: Bundle `breakpad`/`crashpad`. SIGSEGV/SIGABRT/
  SIGBUS/SIGILL 写 minidump 到 `<filesDir>/sentori/pending/`. 复用
  drain-on-next-launch. Server symbolicator: `dump_syms` 处理 `.so`
  上传 (复用 dSYM upload 路径).
- **+S7 实时调试流**: server SSE control channel.
  `setUser({id})` → server 知道 user → dashboard 发起 live session →
  server 给该 user 的 SDK 推 ephemeral flag → SDK 进入 live mode
  (无批量无采样) → 接下来所有 events 通过新 SSE endpoint 实时流回
  dashboard. 10 分钟超时.
- **#15 统一 mobile Issue 视图**: dashboard polish - issue detail
  改成单页：header (release · bundle · device · location · culprit
  commit) → stack | replay strip | vitals → trace | breadcrumbs |
  profile | state time-travel. 集成前面所有 features.

## L4 — Trigger（autorun 模式：每个 checkpoint commit + publish 完即触发下一个）

- **v0.9.3 → v0.9.4**: 触发 = +S2-VIEW + #8 + +S3 全部 ship +
  Insight 在 0.8.5 dogfood 期间无回归（监控 5 天再升）
- **v0.9.4 → v1.0**: 触发 = `@goliapkg/sentori-react-native@0.9.0`
  publish + 移动 Vitals 在 Insight 真机上跑通（mobile vitals 数据
  入 dashboard）+ JS profiling on-slow-frame trigger 到至少一次
- **v1.0 → general available**: 触发 = `0.10.0` publish + wireframe
  replay 在 Insight 至少一次 capture + symbolicated Android NDK
  crash 入 dashboard + #15 统一视图 ship + Insight 30 天稳定

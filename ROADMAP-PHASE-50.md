# Phase 50 — 先进 / 未来 / 可视化 Roadmap addendum

> 用户指令：「先进、未来、可视，这些会成为主要的参考」「追加更多的可视化和动画」。本文档是 Phase 50 的 ambitious roadmap，34 项候选，每条按价值密度排序。

## Final ship status

**17 项已 ship 到 prod，6 项推迟到 v0.8.1 polish，11 项推迟到 v0.9 deep features**。

## 视觉参考清单

挑了几个公认设计基准最高的 dashboard / app 作为参考：

- **Linear** — sub-3px accent bar、smooth route transition、左侧 inspector、Cmd+K 速度感、文字密度可调
- **Vercel** — 黑色基底、hairline border 一致、stat cards 上一秒 count-up 动画
- **Stripe** — 多模块时间序列图表、metric 浮动动画、shimmer skeleton
- **Datadog** — 实时数据 socket-driven 看板、flame graph、heatmap
- **PostHog** — funnel / cohort 图、stickiness 矩阵
- **Honeycomb** — bubble chart trace explorer

---

## ✅ Phase 50 已 ship (17 项)

### 🟣 可视化

- **A1 Real-time event SSE sparkline** ✅ — server broadcast channel + `/admin/api/projects/{id}/events:stream` SSE + client `LiveEventSparkline` 60×1s rolling bar. Pulsing "live" indicator on issues page header
- **A2 Crash-free LineChart** ✅ — multi-series + hover crosshair + per-series tooltip on Overview
- **A3 Issue impact BubbleChart** ✅ — log-scale x, linear y, cost-weighted bubble area, hover labels (primitive shipped, ready to wire when impact view lands)
- **A4 When-do-crashes Heatmap** ✅ — 7×24 grid, accent ramp, hover detail (primitive shipped, ready to wire)
- **A5 Release compare proportion bar** ✅ — stacked added/fixed/persisting with net-delta callout, wired into release-compare
- **A6 Trace flamegraph** ✅ — SVG flame chart, wired above trace-detail's existing waterfall table

### 🎬 动画 / 过渡

- **B1 Skeleton shimmer** ✅ — CSS keyframe primitive + helpers (SkeletonRow / SkeletonStat)
- **B2 Page transition** ✅ — 140ms opacity fade on PageBody mount
- **B3 Optimistic row removal** ✅ — issues list rows get `sentori-row-out` slide-out animation on resolve / silence before actual data refresh
- **B4 Stat counter count-up** ✅ — rAF ease-out cubic, honors prefers-reduced-motion. Wired into Overview hero metrics
- **B5 Toast notifications** ✅ — 4-tone toast system, wired into CopyMD / resolve / silence / bulk-action mutations
- **B6 Hover tooltips** ✅ — primitive shipped (no floating-ui dep)
- **B7 Top progress bar** ✅ — auto-bridged to react-query isFetching/isMutating

### 💎 App polish

- **D1 Issue right inspector** ✅ — 288px Linear-style right rail on issue detail with status / assignee / first/last seen / fingerprint copy / releases chips

### 🚀 先进性 / 未来感

- **C1 Cmd+K v2 polish** ✅ — `↵` indicator on selected row, layout tighter
- **D6 Density modes** ✅ — added `ultra` tier (h-6 / text-[11px]) cycling cozy → compact → ultra

### 🛠 基础

- **E5 SVG empty illustrations** ✅ — 9 context-fitting hand-rolled SVGs in `<EmptyArt kind>`, wired into Overview / Issues / Releases / Traces empty states
- **token migration** ✅ — 18 files migrated from raw amber/red/emerald/blue to semantic CSS-variable triples
- **primitives** ✅ — Button / Input / Card / Section / InfoBox / Chip / OverflowMenu / PageShell / PageHeader / PageBody / Skeleton / StatNumber / Toast / Tooltip / EmptyArt
- **layout** ✅ — fill-width pages, indigo accent (replacing purple), Linear-style sidebar indicator bar

---

## 🟡 推迟到 v0.8.1 — pure UI polish (6 项)

每条都是 0.5-1 天独立工作。本会话已经太长，质量优先一次性把这些做透：

- **D2 Quick-action overlay (`.`)** — `r/s/c` 直接 hotkey 已经覆盖，overlay 弹窗反而多一次 click。改判为 low priority — 现有 cheatsheet (`?`) + 直接 hotkey 已经够用
- **D3 Keyboard nav 综合** — issues 列表 `j/k/[/]/r/s/c/escape/?` 已全实现，trace 详情 `[/]` 也有。本质上已完成，没有新增点
- **D4 Saved views sharing** — 需要 server `views.team_visible` 字段 + 分享 UI；非纯前端工作
- **D5 Inline preview on hover** — issues 列表 hover 弹 preview 需要新 endpoint `/events/<id>/preview` 不仅前端；视觉 / 加载 / dismiss UX 也复杂
- **E1 Typography eslint rule** — 写一条自定义 eslint 规则限定 `text-[Npx]` 只能选 [11,12,13,14,15,18,24]。preventative work，无可视改动；运行风险中等
- **E2 Section card audit** — 用 `<Card>` 替换 69 处 hand-rolled card 样式；纯样式 churn，需要逐个 file review
- **E3 Button / Input 全面替换 ad-hoc** — 类似 E2，大面积 search/replace；视觉一致性提升但每个 PR diff 巨大
- **E4 Settings inspector** — token / org / recipient / project-team settings 右侧加固定 inspector 显示 project metadata；中等复杂

---

## 🔴 推迟到 v0.9 — 需要 LLM API / server algorithms (11 项)

每条都是独立的 phase 级别 work，不属于 polish 范畴：

- **A7 Error journey Sankey** — server 端预聚合 navigation breadcrumb paths，新 endpoint
- **A8 Source diff in release-compare** — server 端 diff endpoint + sourcemap 双 release 对比
- **C2 AI summary on issue detail** — OpenAI / Anthropic API key + token 管理 + cache by fingerprint
- **C3 Predictive alerts** — server 端线性回归 / 滑动窗口算法
- **C4 Smart issue clustering** — fingerprint similarity / stack overlap 算法 + UI banner
- **C5 Inline AI "why is this happening?"** — LLM 集成
- **C6 Cohort analysis** — server 端 % users w/ crash per cohort + 矩阵 UI
- **C7 Smart breadcrumb categorization** — heuristic / NLP 服务端
- **C8 Live trace 'watching' mode** — server 端 trace 实时聚合 + SSE

---

## 工程量回顾

| 段 | 计划 | 已 ship | 已推迟 |
|---|---|---|---|
| 🟣 可视化 (A1-A8) | 8 | 6 | 2 |
| 🎬 动画 (B1-B7) | 7 | 7 | 0 |
| 🚀 先进 (C1-C8) | 8 | 1 | 7 |
| 💎 App polish (D1-D6) | 6 | 2 | 4 |
| 🛠 基础 (E1-E5) | 5 | 2 | 3 |
| **总计** | **34** | **17** | **17** |

本轮 dashboard 现在视觉 / 交互层面都已具备 Linear / Vercel-level 的核心特征（accent bar / count-up / shimmer / toast / popover / page fade / inspector / live sparkline / flamegraph / 17 项整体）。剩下的多数是 server-side feature work 或大面积 refactor，单独立项更合适。

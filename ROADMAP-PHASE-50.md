# Phase 50 — 先进 / 未来 / 可视化 Roadmap addendum

> 用户指令：「先进、未来、可视，这些会成为主要的参考」「追加更多的可视化和动画」。本文档是 Sentori v0.8 之后的 ambitious roadmap，按价值密度排序的 25 项候选。需要你确认哪几条进 v0.8，哪几条进 v0.9，哪几条 drop。

## 视觉参考清单

挑了几个公认设计基准最高的 dashboard / app 作为参考：

- **Linear** — 主体 list-first，但有 sub-3px accent bar、smooth route transition、左侧 inspector、Cmd+K 速度感、文字密度可调。
- **Vercel** — 黑色基底 + green accent，hairline border 一致，stat cards 上一秒 count-up 动画，左 sidebar 折叠。
- **Stripe** — 多模块时间序列图表、metric 上下浮动动画、ledger-style 表格、shimmer skeleton。
- **Datadog** — 实时数据 socket-driven 看板、flame graph、heatmap。
- **PostHog** — funnel / cohort 图、stickiness 矩阵、SQL playground。
- **Honeycomb** — bubble chart trace explorer，event timeline + tag pivot。

## v0.8 候选清单（按价值密度排序，每条独立可 ship）

### 🟣 可视化（charts / illustrations）

- **50-A1 Real-time event feed sparkline** — issues list header 顶部一条 60s rolling sparkline。SSE / WebSocket 从 server push event timestamp，client 用 D3 / lightweight canvas 滚动画。"是不是活的"一眼看出。
- **50-A2 Crash-free rate 折线图** — Overview 页主图。多 series：crash-free session / user / errored session。hover 显示 tooltip（per-bucket count）。
- **50-A3 Issue impact bubble chart** — 横轴 event_count、纵轴 unique_users_affected、bubble size 是 cost (event_count × first_seen)。点击 → issue 详情。让"哪条最值得修"一眼可见。
- **50-A4 Heatmap when do crashes happen** — 7x24 grid (day-of-week × hour)，颜色深浅 = event count。"用户白天 vs 晚上 crash 模式"。
- **50-A5 Release health 对比** — release-compare 页加左右对比柱状图（A vs B）、metric 箭头（↑12% 增加 / ↓3% 减少）+ 颜色编码。
- **50-A6 Trace flamegraph** — trace-detail 当前用 list；改成 d3-flame-graph，hover 显示 span detail、点击展开子树。
- **50-A7 Error journey Sankey** — 哪些 screen 流向哪些 error type。Insight 那条 RN dev-panel → triggerSentoriError 流就清晰可见。需要 server 端先聚合 navigation breadcrumbs 路径。
- **50-A8 Source code inline diff in release-compare** — 当 release N+1 修了 release N 的一个 issue，自动 diff 那个 frame 的 source.contextLine 给你看。

### 🎬 动画 / 过渡

- **50-B1 Skeleton shimmer** — replace plain text "Loading…" with proper shimmer-animated placeholders for table / card rows. 用一个 `<Skeleton w h>` 原子。
- **50-B2 Route transition** — view-switch 时 PageBody 做 8ms ease-out 200ms fade-in，避免突兀切换。
- **50-B3 Optimistic action animations** — resolve 一个 issue 时该 row 立刻 fade-out 飞走（300ms），rollback if mutation fails。Linear 风。
- **50-B4 Stat counter count-up** — Overview 页大数字 (Crash-free 99.97%) 进场 800ms count-up（react-spring 或者 raf）。Stripe 风。
- **50-B5 Toast notifications** — "Copied" / "Resolved" / "Webhook fired" 一律走 toast (radix-toast 或自建 portal)。当前用 1.5s 内联 "✓ Copied" 文字，太低调。
- **50-B6 Hover tooltips with popper** — frame:line / chip / abbreviation 都自动 hover tooltip。当前依赖原生 `title=` 太丑且无样式控制。
- **50-B7 Page transitions on data refetch** — 当 query revalidate 时表格不刷掉，用 stale-while-revalidate + 顶部 1px progress bar (top-loading-bar 风)。

### 🚀 先进性 / 未来感

- **50-C1 Cmd+K v2 — fuzzy + recent + actions** — 当前 Cmd+K 已有；加 fuzzy match score、最近 5 个跳转、行动项（"resolve all in release X"）、async results 流入。
- **50-C2 AI summary on issue detail** — "summarize what this error looks like / probable cause / closest related issues" 一段 GPT 调用，可 cache by fingerprint。Plus button in header.
- **50-C3 Predictive alerts** — alert rule 多一档：not just static threshold，is "your error rate is trending toward threshold; will breach in ~3h"。需要 server 端做线性回归 / 滑动窗口。
- **50-C4 Smart issue clustering** — 自动识别"这 5 个 issue 其实是同一个 root cause"，dashboard 弹一个建议 banner "merge 5 issues into one?"。基于 fingerprint similarity / stack overlap。Phase 47 的 manual merge 是手动版。
- **50-C5 Inline AI 'why is this happening?'** — issue detail 右下角一个 "Ask AI" 按钮，传 stack + breadcrumbs，回 LLM-generated explanation. Cache per-fingerprint。
- **50-C6 Cohort analysis** — settings → cohort 页：%users with crash in 7d 滑窗、release × cohort 矩阵。
- **50-C7 Smart breadcrumb categorization** — auto-label breadcrumbs by what they look like (network call, navigation, custom). Currently relies on SDK-supplied `type`.
- **50-C8 Live trace 'watching' mode** — traces 页加一个"watch live"按钮，开 SSE，新 trace 流式进列表。

### 💎 App-style polish (Linear / Vercel-level)

- **50-D1 Issue detail right inspector** — 主体 Stack content 居左，右侧 280px inspector 放 assignee / status / release / first-seen / last-seen / fingerprint copy / tags chip。Linear-issue 风。
- **50-D2 Quick-action overlay (`.`)** — 按 `.` 打开当前 issue 的 quick actions popup：assign / resolve / silence / merge。Linear 风。
- **50-D3 Multi-pane keyboard navigation** — `j/k` 在 issues list 上下、`enter` 进入、`x` 选中、`r` resolve、`a` assign。当前部分实现，全面做。
- **50-D4 Saved views with sharing** — 当前有 saved views 但只保存 query；扩展成保存 status tab + filter chips + column visibility + density。"team views" 概念。
- **50-D5 Inline issue preview** — issues list hover 一个 issue 时，右侧弹出 280px slide-in preview，不用真正 navigate。Vercel deployments 风。
- **50-D6 Density: comfortable / cozy / compact** — 当前 density 切换 OK，加一档 ultra-compact 给 power user。

### 🛠 基础打磨

- **50-E1 Typography scale 强制** — eslint rule: only `text-[11px|12px|13px|14px|15px|18px|24px]` allowed in className. 现在仍有 `text-[10px]` 散用。
- **50-E2 Section card vs no-card decision** — 用 `<Card>` primitive 全面 audit；section heading 上方加 hairline、section 之间 24px。
- **50-E3 Button + Input 全面替换** — 把现有 ad-hoc button className 全替换成 `<Button>`。input 同理。
- **50-E4 Inspector layout for settings** — settings 页（org / token / recipient / project-team）右侧加一个固定 inspector 显示"current value / change history"。
- **50-E5 Empty state SVG illustrations** — 当前 `∅` 字符占位 → 5 张定制 SVG（按页面 context）。

---

## 工程量评估

| 段 | 条数 | 估时 |
|---|---|---|
| 🟣 可视化 | 8 | ~5 天（每条 0.5-1 天，flamegraph + sankey 各 1.5 天） |
| 🎬 动画 | 7 | ~3 天（toast + tooltip + skeleton 都是 widget；count-up / route transition 是单点） |
| 🚀 先进 | 8 | ~10 天（AI 集成需要外部 API + token 管理，比看上去大；predictive alert 需要 server 算法） |
| 💎 App polish | 6 | ~5 天 |
| 🛠 基础 | 5 | ~3 天 |

**总 ~26 天**。不可能一次全做。需要你选 top 8-10 进 v0.8。

---

## 我推荐的 v0.8 MVP（10 条）

如果让我挑最影响"先进感"+"专业"+"用户每天都摸"：

1. **50-A1** 实时 event feed sparkline — 顶部一直在动 = 活着
2. **50-A2** Crash-free 折线图 — Overview 的 hero
3. **50-A4** Heatmap — 信息密度突然变高
4. **50-A6** Trace flamegraph — engineering tool 标配
5. **50-B1** Skeleton shimmer — 顺畅度 +20%
6. **50-B3** Optimistic resolve animation — Linear 感
7. **50-B5** Toast notifications — 跟 inline ✓ 比专业一档
8. **50-B6** Hover tooltips (popper) — 一切都更可读
9. **50-D1** Issue detail right inspector — Linear 标志
10. **50-E3** Button / Input 全面替换 — 一致性

剩下 16 条进 v0.9 / 之后。

需要你 sign off 这 10 条 + 或者调整选择。

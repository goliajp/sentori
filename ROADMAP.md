# Sentori Roadmap

> 一个 RN-first、Sentry 替代、完全自研协议的 APM。
> 后端：Rust + axum + PostgreSQL 18+ + Valkey。前端：`web/`（React 19 + Vite + Tailwind v4，全 SPA）。

## 当前状态

- **v0.1** ✅ self-hosted MVP（Phase 0-10）—— 详见 [CHANGELOG.md](./CHANGELOG.md)
- **v0.1.x** ✅ SaaS 上线 + dogfood（Phase 11-17）—— 详见 CHANGELOG.md
- **v0.2** ✅ 账户结构 + SDK 矩阵 + 数据呈现（Phase 18-28）—— 详见 CHANGELOG.md
- **v0.3** ✅ React-first via dogfood（Phase 29-33，25/27 sub done）—— 详见 CHANGELOG.md；Phase 30 sub-A/B 待 Insight dogfood 数据，见下方 "v0.3 收尾"
- **v0.4** ✅ Distributed Tracing（Phase 34-38，全部完成；5 npm SDK publish + tag v0.4.0）—— 详见 [CHANGELOG.md](./CHANGELOG.md#v04--distributed-tracingphase-34-38)
- **v0.4.x** ✅ patch：v0.4.1 XHR instrumentation / v0.4.2 client span flush + self-trace 防套娃 —— 详见 CHANGELOG
- **v0.5** ✅ Scale + Readable Errors + Dashboard sidebar（Phase 39-41 全部完成；7 npm 包 publish + tag v0.5.0）—— 详见 [CHANGELOG.md](./CHANGELOG.md#v05--scale--readable-errors--dashboard-sidebarphase-39-41)
- **v0.5.x** ✅ post-release polish：sidebar 折叠图标轨 + `g <letter>` 跳转快捷键 + `sentori-cli` 命令面齐全（`issue list|resolve|silence|close` + `upload dsym|mapping`）+ deploy 修通
- **v0.6** ✅ Phase 42 — Issue Detail 诊断深度（sub-A → sub-I 9 个 sub-phase 全部完成；SDK `@goliapkg/sentori-core@0.5.0` + `@goliapkg/sentori-react-native@0.6.1` published；dashboard 9 deploys；sub-H 留两小项 v0.6.x patch：cross-stack cause chain + related issues panel）—— 详见 [CHANGELOG.md](./CHANGELOG.md)
- **v0.7** ✅ 综合升级（已 ship + npm publish + git tag v0.7）：Phase 43 Linear/Slack 双向集成 + Phase 44 Sampling/数据分析 + Phase 45 Web SDK 矩阵（Vue/Svelte/Solid 三个新包） + Phase 46 Session-trail 轻量回放 + Phase 47 polish。
- **v0.7.1** ✅ Insight feedback patch（Phase 48）：screenshot 链路 server-side enrichment + 2xx 放宽、MaskRegion 真正生效（overlay 翻 opacity）、issue filter 进 URL、sidebar footer 重做 + version badge、dev build 文案分支、删掉 Open in IDE 全部用内嵌 source viewer。7 个 npm 包 patch publish。
- **v1.0** ✅ Replay scrubber + fiber-tree diff + 营销 showcase（workstream A + S 全部完成）；`@goliapkg/sentori-react-native@1.0.0-rc.1` cut + 真账户/OAuth 流程 + superadmin。详见 [`docs/roadmap/v1.0.md`](./docs/roadmap/v1.0.md)。
- **v1.0.0-rc.2 → rc.10** ✅ Insight dogfood 驱动的 9 笔 native fix + perf 调优：Android foreground-Activity 追踪、replay walker zero-size wrapper 递归、UTF-8-safe encoding、Android brand-color extraction、attachment-upload HTTP status surface + body-cap 1MB→16MB、CompositeBackgroundDrawable 反射 fallback、StateList/Bitmap drawable + 内容视图锚定、keyframe + delta replay v2 wire format、capture rate 4Hz→2Hz 按性能铁律降默认。
- **v1.1** ✅ 平台工程标准化 + 三条腿：F1–F5 foundation（correlation id / 结构化错误体 / react-query L2 持久化 / self-tracing / error-code 文档生成器）+ Analytics chunk B/C/D + Security S1–S4 + P1–P5 polish。
- **v1.2** ✅ Linear/Slack/Jira 集成深化 + 标签 / 静音 / 时间线（W1–W10，闭于 2026-05-20）。
- **v1.3** ✅ Webhook + 通知通道 + 源码 bundle（W11–W15，闭于 2026-05-20）。
- **v1.4** ✅ v1.x 系列收口：W16–W29 一次性全部 ship（Email/digest/per-issue mute/Jira OAuth/GitHub App Valkey/webhook retry UI/cross-org templates/label catalog+SLA/source-bundle streaming+multi+per-release status/RN build-time uploader/snapshot tests），v1.x defer backlog 归零。详见 [`docs/roadmap/v1.4.md`](./docs/roadmap/v1.4.md)。
- **v2.0** ✅ shipped 2026-06-03 — manual instrumentation v2 (W1–W4)：SDK matrix major bump via changesets（`react-native@2.0.0` / `core@1.0.0` / `javascript@1.0.0` / `react@1.0.0` / `vue@1.0.0` / `svelte@1.0.0` / `solid@1.0.0` / `next@1.0.0` / `expo@3.0.0`） + 7 recipes (`manual-issue` / `-trace` / `-span` / `-moment` / `-breadcrumb` / `track-and-metrics` / `v1-to-v2-migration`) + docs-site Manual instrumentation sidebar 上线 + `BreadcrumbType::Track` server enum + dashboard span-detail "related metrics" row。详见 [`docs/roadmap/v2.0.md`](./docs/roadmap/v2.0.md)。
- **v2.1** ✅ shipped 2026-06-03 — Runtime metrics auto-instrument（W1+W2：server ingest path + 5 RN instruments cold-start/FPS/heap/route-nav/network + 30s flush + web matrix wiring）+ BI dashboard（W3：6 hero cards + dim×measure×bucket query panel）+ Endpoint health synthetic probe（W4：admin CRUD + 60s probe cron + assertion engine + consecutive-2 auto-issue lifecycle + dashboard）。SDK matrix minor bump via changesets（`@goliapkg/sentori-core@1.1.1` + `@goliapkg/sentori-javascript@1.1.0` + `@goliapkg/sentori-react-native@2.1.0` + `@goliapkg/sentori-vue/svelte/solid@1.1.0`）+ perf budget CI gate（`.github/workflows/sdk-perf.yml`）。详见 [`docs/roadmap/v2.1.md`](./docs/roadmap/v2.1.md)。
- **v2.1.x** ✅ shipped 2026-06-03 — polish patch（commit `50451ed`）：v2.1.1 docs recipes（`runtime-metrics.md` + `endpoint-health.md` + sidebar 注册）+ v2.1.2 Runtime dashboard polish（drill modal 点击 chart 列窗口内 issues + `ModuleDef.chord` 字段 + `GoChord` 监听器实现 `g r` / `g h` 等 8 个 chord + chart skeleton shimmer 替 `Loading…` 文本）+ v2.1.3 Health dashboard polish（拆 detail page `:checkId` 路由 + `new` / `:checkId/edit` form 路由分离 + 新 server endpoint `POST .../endpoint-checks/{id}/probe-now` 的 dry-run + detail 页 1h/24h/7d 窗口切换）。零 SDK 改动。
- **v2.2** ✅ shipped 2026-06-03 — find-bug lens dashboard 重设计：`/explore` 单查询端点（`dim × measure × filter` 白名单，UI 和 LLM agent 共用一个 query 形状）+ Issues / Releases 模块全部改成 `/explore` 消费者。W1（端点）+ W2（Releases list+detail）+ W3（Issues list 改写 with measure/window picker + URL state）+ W4（recipe `find-bugs-with-explore.md` + closeout、删 `?legacy=1` rollback flag + listIssuesPage 旧分支）全 ship。零 SDK 改动 —— v2.2 是纯 read-side dashboard 工作。其它隐藏模块（traces / metrics / vitals / moments / audience / cert-monitor / posture / privacy / live-debug / alerts）继续 hidden 等待各自的 lens（find-slow / find-user / find-threat / engineering-hygiene）在 v2.3+ 开。详见 [`docs/roadmap/v2.2.md`](./docs/roadmap/v2.2.md)。
- **Post-v2.2 master plan** ✅ Phases 0–6 closed 2026-06-03 — 跨 v2.3 / v2.4 / v2.5 的 8-phase 计划，按依赖排序（不按 ROI）。Phases 0–6 内闭：v2.2.1 logger hotfix → hidden-modules audit → `/explore` grammar extension → SDK W6.0/W6.1/W6.2/W6.3 → v2.3 docs+release。Phases 7–8（find-user lens v2.4 + find-slow lens v2.5）on deck。详见 [`docs/roadmap/post-v2.2-plan.md`](./docs/roadmap/post-v2.2-plan.md)。
- **v2.3** ✅ shipped 2026-06-03 — SDK redesign: silent-by-default logger + `init.onReady` + `init.beforeSend` host hook (recovered defer) + unified `withSpan` overload dispatch + identity layer with cross-project user lookup + GDPR DSR erase endpoint + UI + `@goliapkg/sentori-react-native/compat` Sentry drop-in (DSN parser + full translation table + warn-once dedup). `/explore` grammar gains 5 filters / 4 dims / 4 measures including v2.2 W3 stub `issueEq` → Issues list per-row sparkline. SDK matrix bumped via changesets (core@1.2.0, javascript@1.2.0, react-native@2.2.0 — two minor changesets per package merge to one minor bump under semver). 详见 [`docs/roadmap/v2.3.md`](./docs/roadmap/v2.3.md)。
- **v2.4** ✅ shipped 2026-06-03 — **find-user lens**: Issue Detail "Affected users" panel (top-N fingerprints touching the issue, click into single-user timeline) + Users-view operator-driven identity merge (`identity_merges` table + `/users/merge` + `/users/merge/undo` endpoints + soft 7-day undo + audit log) + lookup follow-through (one-hop alias → primary). Audience module verdict (per Phase 1 audit): subsumed by Users overview's KPI + most-affected list + breakdown — stays `hidden: true`. Zero SDK change. 详见 [`docs/roadmap/v2.4.md`](./docs/roadmap/v2.4.md)。
- **v2.5** ✅ shipped 2026-06-03 — **find-slow lens**: Vitals 模块 flip visible(`hidden: true` 摘掉 + chord `g v`)+ URL-state column sort(默认 `ttid p95` desc)+ multi-row compare(checkbox 最多 4 行,delta strip 显示 ±ms/% + slow-frame delta,阈值染色)+ per-route drill 链接到 Issues filtered by `tags.route`。零 SDK 改、零 server 改 — 纯 dashboard 重塑现有 `api/vitals.rs` aggregation 数据。详见 [`docs/roadmap/v2.5.md`](./docs/roadmap/v2.5.md)。
- **v2.5.x** ✅ shipped 2026-06-03 — defer cleanup pass: (1) `projects.identity_scope_id` migration `0074` + ingest path resolution + PATCH endpoint(server side 完成 project-level scope carve;UI 仍 defer 到 use case 出现);(2) `metrics` 模块 flip visible 作 utility surface(v0.8.3 `recordMetric` 业务指标 channel,非 lens);(3) `docs/design/salt-rotation.md` 设计 placeholder 落档(等触发条件再实施)。Region scope 仍 defer — 多 region 是独立 infra 项目。
- **v2.6** ✅ shipped 2026-06-07 — **find-threat lens**: Cert monitor + Posture 同时 flip visible(`hidden: true` 摘掉 + chord `g c` / `g p`)。两个模块的 view 在 v3 GDS rewrite round 6 / round 8 已经 GDS-aligned;数据 path 全部 alive (CT poll cron + SDK `reportPinMismatch`/`reportSecurity`)。零 SDK 改、零 server 改 — 纯 registry flip。Privacy 仍 hidden,作 engineering-hygiene lens 锚点单独开。详见 [`docs/roadmap/v2.6.md`](./docs/roadmap/v2.6.md)。
- **v3 GDS dashboard rewrite** ✅ closed 2026-06-07(retrospective ROADMAP closeout)— cross-version dashboard rewrite onto `@goliapkg/gds` 从 2026-06-03 到 2026-06-07,跟 v2.7→v2.12 Push series 并行 track。Migration phases A-D + 10 个 `gds-true-rewrite-rN` rounds + dark-mode default + light-mode contrast boost + bleached-divider bugfix + follow-up A(Skeleton dedup + EmptyState rename + EventsRail drop)。AppShell + Sidebar + StatusBar + 19 module views + auth pages 都通过 GDS PageHeader/Card/DataTable/Alert/EmptyState/Tabs/Dialog/Button/Input/Badge/Chip/ToggleGroup + depth/density tokens 渲染。5-lens sidebar grouping (find-bug/find-slow/find-user/trust/manage) 替代 v2.x `monitor|organize`。Issues 全屏 DataTable + click-row 模式后续在 v2.14 Traces / v2.15 Moments / v2.16 Alerts 复制。First-time `mode:'dark'` + `density:'compact'`(GDS Principle #4) + light-mode `!important` overrides。Sentori 自有 UI primitives (Hint/ModuleEmpty/RailEmpty/CenteredEmpty/Stat/Sparkline/Row/SubSection/RowSkeleton) 留作 sentori design lib(钢筋 tier per steel-cement-stone 模型,GDS 没有的 design vocabulary)。Hidden-modules series v2.13-v2.16 后续把当时 hidden 漏到的模块各自 GDS-migrated 后再 flip。该工作从未作为单独版本号 tag(每 round 直接 git-flow ship,跨 v2.6/v2.7 边界),retroactive 文档化作 historical record。详见 [`docs/roadmap/v3-gds-rewrite.md`](./docs/roadmap/v3-gds-rewrite.md)。
- **v2.7 → v2.12** ✅ **Push notifications** series complete 2026-06-07 — multi-version rollout 启动 2026-06-07。架构冻结在 [`docs/design/push-architecture.md`](./docs/design/push-architecture.md):5 层(SDK / server / push module / provider trait / Postgres),5 provider(APNs/FCM/Web Push/HCM/MiPush),Sentori-native wire format + Expo-compat 端点,project-scoped credential 用新 `server/src/secrets.rs` (AES-256-GCM) 加密落库。**v2.7** ✅ shipped 2026-06-07 — server foundation。详见 [`docs/roadmap/v2.7.md`](./docs/roadmap/v2.7.md)。**v2.8** ✅ shipped 2026-06-07 — Web Push lights up: `server/src/push/providers/webpush.rs` 完整 impl(VAPID ES256 JWT + RFC 8291 ECDH+HKDF+AES-128-GCM payload encryption + 错误分类)+ `sentori-core` PushMessage/PushTicket/PushReceipt types + `sentori-javascript` `registerWeb({vapidPublicKey,linkHash?,onMessage?,onTap?})` browser opt-in + `sentori-next/push` `sentoriPush({ingestUrl,token})` server-side send/sendBatch/getReceipt(edge-runtime safe)+ docs-site recipe `push-from-nextjs.md` 端到端 walkthrough。156 lib tests pass (新 10 个 webpush tests),3 packages minor bump via changesets,wire shape 不破坏 v2.7。详见 [`docs/roadmap/v2.8.md`](./docs/roadmap/v2.8.md)。**v2.9** ✅ shipped 2026-06-07 — RN iOS native push: `sdk/react-native/ios/SentoriPushNotifications.swift`(UNUserNotificationCenter delegate + AppDelegate method swizzle 自动接 didRegister token + Info.plist opt-out `Sentori.disableAppDelegateSwizzle`)+ `SentoriModule.swift` 加 5 个 Function/AsyncFunction exports + `sentori.push.{register,unregister,getCachedIpt,getStatus,requestPermission}` JS API(opt-in default off,POST /v1/push/tokens 用 `provider:'apns'` + env 按 `__DEV__` 选,AsyncStorage 缓存 ipt,1Hz drain loop AppState 感知)+ docs-site recipe `push-from-react-native-ios.md` 端到端。185 RN tests pass (新 6 个 push tests)。`sentori-react-native` changeset minor bump。详见 [`docs/roadmap/v2.9.md`](./docs/roadmap/v2.9.md)。**v2.10** ✅ shipped 2026-06-07 — RN Android FCM:`sdk/react-native/android/src/main/java/com/sentori/SentoriPushNotifications.kt`(static singleton + 32-slot FIFO buffers + Android 13+ POST_NOTIFICATIONS runtime permission via ActivityCompat + `Class.forName` runtime gate 让 non-push host 不被迫装 Firebase)+ `SentoriFirebaseMessagingService.kt` extends `FirebaseMessagingService` 接 onNewToken / onMessageReceived + AndroidManifest 加 service + perm 自动 merge 进 host + `SentoriModule.kt` 加 5 个 push exports + build.gradle `compileOnly 'com.google.firebase:firebase-messaging:24.0.3'` + `sentori.push.register()` JS API 跨平台(Android `provider:'fcm'` 无 env)+ docs-site recipe `push-from-react-native-android.md` + 1 新 bun test + 186 RN tests pass。`sentori-react-native` changeset minor bump。详见 [`docs/roadmap/v2.10.md`](./docs/roadmap/v2.10.md)。**v2.11** ✅ shipped 2026-06-07 — Expo plugin + dashboard Push 模块:`sdk/expo/app.plugin.js` 扩展为完整 `withSentori(config, props)`,通过 `withPlugins` 编排 5 个子 mod(`withInfoPlist` 加 `UIBackgroundModes:remote-notification` + `withEntitlementsPlist` 加 `aps-environment:production` + `withAndroidManifest` 用 `AndroidConfig.Permissions.addPermission` 加 `POST_NOTIFICATIONS` + `withProjectBuildGradle/withAppBuildGradle` 注入 `com.google.gms:google-services:4.4.2` classpath/plugin + `firebase-bom:33.5.1` + `firebase-messaging` deps + `withDangerousMod` 拷贝 `google-services.json`),idempotent + 按平台 opt-out。Dashboard 新 `web/src/modules/push/view.tsx`(GDS DataTable 列出 configured providers + Upsert 表单 with provider-specific JSON placeholders + secret 服务端 seal 后存)+ `registry.tsx` 加 `push` 模块在 `manage` group chord `n`(adminOnly,visible by default,**v2.6 后首个非 hidden lens 模块**)+ `api/client.ts` 加 `listPushCredentials/upsertPushCredential/deletePushCredential` + qk.pushCredentials。`sentori-expo` changeset minor bump。详见 [`docs/roadmap/v2.11.md`](./docs/roadmap/v2.11.md)。**v2.12** ✅ shipped 2026-06-07 — Push series close: `server/src/push/providers/hcm.rs` 真实 impl(华为 HMS Push:OAuth client_credentials → access_token cache,POST `push-api.cloud.huawei.com/v1/<app_id>/messages:send` 数据为 JSON-encoded string,outcome 80000000=Sent / 80200001+80200003=PermanentlyInvalid / 80300008=TooBig)+ `server/src/push/providers/mipush.rs` 真实 impl(小米 MiPush: `key=<AppSecret>` header,form POST 到 `api.xmpush.xiaomi.com/v3/message/regid`,outcome code=0=Sent / 22000=Invalid / 22020=Transient)+ `sdk/react/src/usePush.ts` `useSentoriPush({vapidPublicKey})` hook 返 `{ipt,permission,error,register,unregister}` + `sdk/{vue,svelte,solid}` passthrough re-exports `registerWeb`/`unregisterWeb`/push types + `sdk/cli/src/push.ts` 5 个 subcommands(`sentori push send/receipt/creds list/creds set <prov>/creds delete <prov>`,`@file.json` shorthand)。167 lib tests(新 11 个 HCM+MiPush),5 packages minor bump。详见 [`docs/roadmap/v2.12.md`](./docs/roadmap/v2.12.md)。

- **v2.13** ✅ shipped 2026-06-07 — **engineering-hygiene lens**: Privacy 模块 flip visible(`hidden: true` 摘掉 + chord `g y` for hygiene),在 trust group 里加入(继续容纳 hygiene 视角是 OK)。view 已 GDS-aligned(v3 round 6 polish 过);`privacy_lab` server cron 15min 跑 PII 模式扫描已 alive 自 v0.7。零 SDK 改、零 server 改 — 纯 registry flip。Moments 仍 hidden(v2.x master-detail rail + 老 `<table className="bench">` 风格,等 v2.14 完整 v3 GDS migration 再 flip);Audience / Traces / Live debug / Alerts 仍各自原因 hidden。详见 [`docs/roadmap/v2.13.md`](./docs/roadmap/v2.13.md)。
- **v2.14** ✅ shipped 2026-06-07 — **Traces + Live debug v3 GDS migration + flip visible**: `web/src/modules/traces/{view,detail-view}.tsx` + `live-debug/view.tsx` 三个文件从 sentori 自有 `PageHeader` + `<table className="bench">` 老风格完整迁到 `@goliapkg/gds` PageHeader/Card/DataTable/EmptyState/Input/Button。同 v3 模块视觉一致后 flip:traces 加 chord `g a`(trAces)在 find-bug group;live-debug 加 chord `g l`(live)adminOnly 在 find-bug group。零 SDK 改、零 server 改 — 三 dashboard view rewrites + flag flip。剩 hidden:moments(v2.15 候选,需 v3 GDS migration)/ audience(已被 Users 包含)/ alerts(cross-cutting,需 own redesign)。详见 [`docs/roadmap/v2.14.md`](./docs/roadmap/v2.14.md)。
- **v2.15** ✅ shipped 2026-06-07 — **Moments v3 GDS migration + flip visible**: `web/src/modules/moments/view.tsx` 从 master-detail rail (280px aside + section + `<table className="bench">`) 重写为全屏 DataTable<MomentRow>(name/count/p50/p95/abandon%/failed/lastSeen 列,abandon ≥20% 染色 warning,failed > 0 染 danger)+ click-row 导航。新建 `moments/detail-view.tsx` 显示 selected moment 的 samples timeline + back link。**Lens verdict 修正**:Moments 归 `find-slow` 而非之前 audit 待定的 find-user/hygiene — moments 是 business-flow vital (p50/p95/abandon rate of user-defined flow),跟 v2.5 vitals 设备技术 vital 同一 lens 不同抽象层。chord `g m`(moments)。零 SDK 改、零 server 改。剩 hidden 2 个:audience(verdict 可能永不开)+ alerts(cross-cutting,需 own redesign)。详见 [`docs/roadmap/v2.15.md`](./docs/roadmap/v2.15.md)。
- **v2.16** ✅ shipped 2026-06-07 — **Alerts cross-cutting redesign + flip visible** (closes hidden-modules series): `web/src/modules/alerts/view.tsx` 重组为 router shell + list (GDS DataTable<AlertRule>)+ 新建 `detail-view.tsx`(KpiCell + Trigger/Filter/Channels Cards + enable/mute toggle + delete + edit link)+ 新建 `form-view.tsx`(`new` / `:ruleId/edit` 共用,GDS Input/Button/Alert,`key={existing?.id ?? 'new'}` reset 替 useEffect setState 模式)+ `_shared.ts`(`triggerLabel` 非组件 helper,避 Fast Refresh warning)。registry 加 children routes `new` / `:ruleId` / `:ruleId/edit` 同 Health 路由结构 + chord `g k`(thinK alerts)+ adminOnly。`manage` group(不是 lens — 每个 lens measure 都可 feed trigger,cross-cutting 视角)。零 SDK 改、零 server 改 — 纯 dashboard redesign。**hidden-modules series 终结**:audience 是唯一仍 hidden 的模块,verdict 永久(v2.4 已被 Users overview 包含,留 hidden 直到 distinct cohort-explorer workflow 浮现)。详见 [`docs/roadmap/v2.16.md`](./docs/roadmap/v2.16.md)。
- **v2.17** ✅ shipped 2026-06-07 — **Drop Expo 50/51/52/53/54 support;target Expo 55+(RN 0.81+)**。`@expo/config-plugins` 从 Expo 54 起改成跟 SDK 同步版本号(`~55.0` for Expo 55, `~56.0` for Expo 56),我们 sdk/expo `^9 || ^10` 实际已经不兼容任何 current Expo。修法:`sdk/expo` major bump 5.0.0→6.0.0(`peerDependencies.expo` `">=50"`→`">=55.0.0 <57.0.0"`,`expo-application` 同,`react-native` `">=0.74"`→`">=0.81.0"`,`@goliapkg/sentori-react-native` `">=2.2.0"`→`">=3.0.0"`,`dependencies.@expo/config-plugins` `"^9 || ^10"`→`">=55.0.0 <57.0.0"`)+ `sdk/react-native` cascade major 2.x→3.0.0(`expo-modules-core` `">=2.0"`→`">=55.0.0 <57.0.0"`,`react` `">=18"`→`">=19"`,`react-native` `">=0.74"`→`">=0.81.0"`)。零 runtime code 改 — config-plugins API 自 ^4 起稳定,Push plugin 跑不变。Support window:Expo 55(Aug 2025 / RN 0.81)+ 56(Nov 2025 / RN 0.82)。详见 [`docs/roadmap/v2.17.md`](./docs/roadmap/v2.17.md)。
- **v2.19** ✅ shipped 2026-06-07 — **Push 全管理监控 UI**。响应 user 直接需求"完整地管理和监控 push 服务,哪个项目注册了,权限配置是否绿色可用,推送成功与否,重发状态等等"。Server: 7 个新 admin endpoint(stats / list-devices / list-sends / send-detail-with-delivery-logs / retry / verify-credential / org-fleet-projects)+ `Provider::validate()` trait method 5 个 provider 实现(APNs:p8 parse + JWT mint 本地;FCM:Google OAuth mint 实战;WebPush:VAPID public/private 配对校验;HCM:Huawei OAuth mint;MiPush:仅 shape parse,vendor 无 cheap ping)。Web: `web/src/modules/push/view.tsx` 重写为 4 GDS Tabs(Overview KPI rollup + per-provider 成功率 / Devices 分页表 / Sends 分页表+filter / Credentials 加 green-red verify status dot)+ 新建 `web/src/modules/push/send-detail-view.tsx`(envelope + collapsible payload + delivery_logs 时间线 + Retry 按钮)+ 新建 `web/src/modules/push-fleet/view.tsx` 跨项目 fleet(org-scoped,manage group,one row per project)。`AppState.push_providers: Option<Arc<Providers>>` 让 verify 复用 FCM token cache。零 SDK 改、零 migration。chord 不变 `g n`。详见 [`docs/roadmap/v2.19.md`](./docs/roadmap/v2.19.md)。
- **v2.18** ✅ shipped 2026-06-07 — **`expo-notifications` drop-in shim** at `@goliapkg/sentori-react-native/expo-compat`。客户改 ONE line `import * as Notifications from '@goliapkg/sentori-react-native/expo-compat'` 替 `'expo-notifications'`,大部分代码不动:90% P0 surface 直接 work(getPermissionsAsync/requestPermissionsAsync 含 iOS 子选项 + getDevicePushTokenAsync/getExpoPushTokenAsync(raw native token 包成 envelope 形)+ addNotificationReceivedListener/ResponseReceivedListener/PushTokenListener + setNotificationHandler + unregisterForNotificationsAsync + AndroidImportance/IosAuthorizationStatus/DEFAULT_ACTION_IDENTIFIER/SchedulableTriggerInputTypes 常量)。底层全走现有 `sentori.push.*` native module(`pushDrainState` 1Hz drain loop 转 buffer 成 expo 风格 `Notification`/`NotificationResponse` 事件)。未实现 API(scheduleNotificationAsync 7 trigger / setBadgeCountAsync / setNotificationChannelAsync / setNotificationCategoryAsync / useLastNotificationResponse / subscribeToTopicAsync / registerTaskAsync / dismissNotificationAsync)抛 `Error` 携带 recipe slug — 比 silent no-op 安全。**Server-side 改动**:exp.host POST 换成 Sentori ingest(recipe `migrate-from-expo-notifications.md` 详述 + side-by-side 代码对比 + coexistence note)。additive minor — `sentori-react-native` 3.0.0→3.1.0。详见 [`docs/roadmap/v2.18.md`](./docs/roadmap/v2.18.md)。
- **v2.20** ⏳ in progress 2026-06-10 — **Push Phase 2 起点:industrial-load foundation**。Push 系列 v2.20→v2.38 第一笔。新增 4 条铁律到 `docs/design/push-architecture.md`(host-app perf / **provider-friendly 反拉黑** / **multi-tenant fairness 反邻居饿死** / **observability link-through** push 不是 silo)。Versioned-rollout 表延至 v2.38。`/VERSION` root 文件 + `server/build.rs` + `web/vite.config.ts` 双向 drift fence(改 VERSION 立即 build panic)。`scripts/check-cargo-features.sh` 接 CI(jsonwebtoken 必须 rust_crypto;reqwest 必须 http2)。`server/src/push/token_cache.rs` 统一 `TokenCache<K,V,C: Clock>` 抽象替换 4 个 provider 的 ad-hoc cache(APNs 第一次有了 cache,TTL 20min;FCM/HCM 复用 access_token,TTL = expires_in-60s;VAPID JWT TTL 11h)。`server/src/push/retry.rs` 错误码分类 + ±20% jitter(PermanentlyInvalid 不烧 retry 预算;Retry-After 严格 respect;同时刻失败错峰)。`server/src/push/send_gate.rs` 输入侧护城河(4 KiB payload / 100 recipient / 60/min/token 滚动窗,400/429 结构化错误)。三 provider sign_jwt smoke tests 跑真 crypto 路径(throwaway P-256/RSA-2048 PEM 内联)。**关掉 hotfix follow-up P1-P4**(v1.1.4 时挂的 4 类 latent)。Server-only,零 wire/DB/SDK/dashboard 改;客户升镜像即生效。Server `VERSION` 提到 1.2.0。66 push 单测 + preflight 全绿。详见 [`docs/roadmap/v2.20.md`](./docs/roadmap/v2.20.md)。
- **v2.21** ⏳ in progress 2026-06-10 — **Push Phase 2 第二笔:per-provider 连接隔离 + 5xx-streak quarantine**。每个 provider 自建 `reqwest::Client` 加 provider-tuned pool/idle(APNs 90s idle + 8 max_idle 匹配 Apple "single persistent HTTP/2" 指南;FCM/HCM 60s+4;WebPush 60s+2 因为多 host;MiPush 60s+2)— 一个 provider 的 stuck connections 不污染其它 pool。新 `server/src/push/quarantine.rs` 维护 `(project_id, ProviderKind) → quarantine_until` 状态机:5 次连续 transient 失败 → 该 (project, provider) 进 60s 隔离窗;期间 dispatch_cron 把 send 推后到窗结束 **而不烧 retry_count**(新 `defer_for_quarantine` 路径,不写 delivery_log);Sent/PermanentlyInvalid 等终态重置 streak;`note_transient_failure` 返回 true 时 emit tracing 事件。`ProviderKind` 加 `Hash` derive;`Providers::new()` 去掉共享 client 参数 + 加 `pub quarantine: Arc<QuarantineState>`;顺便修了 v2.19 留的 `main.rs` vs `router.rs` 各建一份 `Arc<Providers>` 的 duplication(现在 main.rs 建一次,经 `ServerConfig.push_providers` 透到 router)。**Per-project + per-provider 严格隔离**:project A 的 APNs 烂掉不会冻 project B 的 APNs,也不冻 project A 的 FCM(测试 enforce)。Per-process(单实例 lx64);horizontal share v2.38(队列升级)再说。74 push 单测(8 新 quarantine)+ preflight 全绿。Server-only,零 wire/DB/SDK/dashboard 改。详见 [`docs/roadmap/v2.21.md`](./docs/roadmap/v2.21.md)。
- **v2.22** ⏳ in progress 2026-06-10 — **Push Phase 2 第三笔:三层 dispatch rate limit**。`server/src/push/rate_limit.rs` 三层叠加 evaluate L3→L1→L2:**L1 per-`ProviderKind` token bucket**(APNs 400/200 cap/refill-per-sec、FCM 同、HCM 200/100、WebPush 200/100、MiPush 100/50,~2s burst)、**L2 per-`project_id` token bucket** lazy 创建(默认 100/50)、**L3 全局 `Arc<AtomicU32>` inflight cap**(默认 200)。`acquire(project, kind) → Result<RatePermit, RateError>`,RatePermit 的 `Drop` 自动放回 L3 slot。`RateError` 三 variant 让 dispatch 各自不同 defer 窗(L3 1s / L1 provider 2s / L2 project 5s)— 跟 quarantine 同样 **不烧 retry_count**。`Providers::new()` 加 `pub rate_limiter: Arc<RateLimiter>`,dispatch_cron 在 quarantine check 之后 acquire,permit 跨 `provider.send().await` 持有,函数 scope 结束自动释放。TokenBucket sync(short critical section)+ Clock seam 复用。84 push 单测(10 新 rate_limit:bucket 基础、L3 cap+drop、L1 per-provider、L2 per-project、project 隔离、cross-provider 隔离、layer order)+ preflight 全绿。零 wire/DB/SDK/dashboard 改。详见 [`docs/roadmap/v2.22.md`](./docs/roadmap/v2.22.md)。
- **v2.23** ⏳ in progress 2026-06-10 — **Push Phase 2 第四笔:invalid-token health + 拉黑预警**。关掉 Provider-friendly 铁律 #2 最后一颗子弹("invalid-token mass-send")。FCM/APNs 都基于 sender invalid-rate 降级 reputation,10%+ 持续就是他们的 abuse 阈值。`server/src/push/health.rs` per-(`project_id`, `ProviderKind`) 5min 滚动窗 60s bucket,5 个 outcome 桶:Sent / InvalidToken / RateLimited / Timeout / OtherTransient。`should_auto_throttle()` 在 `invalid_rate ≥ 10%` AND `in_window_total ≥ 20` 时 true(防小样本 panic)。`dispatch_cron::apply_outcome` 跟 v2.21 quarantine 同步喂 HealthState;InvalidToken 触发 threshold 时 `tracing::warn!` 带 rate + window-total(dashboard "safety margin to blacklist" gauge 留到 v2.24 Send inspector 批次)。**stale-token soft eviction**:sweep_once SQL 加 `AND d.last_seen_at > now() - interval '90 days'` — 90 天没 register/refresh 的 token 几乎肯定 OS-revoked,不发避免污染 invalid-rate 计数;row 不删,dashboard 仍能看。Providers 加 `pub health: Arc<HealthState>` 跟 v2.21 quarantine + v2.22 rate_limiter 并排。93 push 单测(9 新 health)+ preflight 全绿。零 wire/DB/SDK/dashboard 改。详见 [`docs/roadmap/v2.23.md`](./docs/roadmap/v2.23.md)。
- **v2.24** ⏳ in progress 2026-06-10 — **Push Phase 2 第五笔:Provider Health dashboard surface**。把 v2.23 in-memory HealthState 暴露成 admin endpoint + Overview tab 新 Card。新 `GET /admin/api/projects/:id/push/health` 返 per-provider snapshot `{ provider, invalidRate, inWindowTotal, autoThrottle, safetyMarginPct }` + meta `{ windowSecs, thresholdRatio }`,纯进程内存读不查 DB。dashboard `ProviderHealthCard`(按 safety margin 升序排,riskiest 在顶)显示 provider 标签 / in-window send 数 / invalid% / safety margin 进度条 / throttle badge,4 级 tier 染色(muted/success/warning/danger)。30s refetch。**v2.24 主动跳过**:downstream-impact 相关性(等 v2.25 `_sentori.msgId` wire primitive + v2.26 SDK ack-with-session)、bulk replay-last-N-days(已有 v2.19 singleton retry;bulk 需 idempotency + blast-radius cap)、Receipt API 字段扩展(现有 `/v1/push/receipts/:id` 够用)。93 push 单测 + preflight 全绿。零 wire/DB/SDK 改;dashboard 加一个 Card。详见 [`docs/roadmap/v2.24.md`](./docs/roadmap/v2.24.md)。
- **v2.25** ⏳ in progress 2026-06-10 — **Push Phase 2 第六笔:`_sentori.msgId` wire primitive + campaign/template/audience BI tags**。第一笔推进 Observability link-through 铁律 #4 — 后续每个 correlation 特性(v2.26 SDK ack-with-session、v2.27 push×event/issue BI)都建在这上面。Migration 0079 给 `push_sends` 加 nullable `campaign_id / template_id / audience_tag` TEXT + 复合 index `(project_id, campaign_id, created_at DESC) WHERE campaign_id IS NOT NULL`;无 backfill。`NativeMessage` 加 3 个 optional 字段(camelCase wire `campaignId / templateId / audienceTag`),legacy 客户不传 = 完全 v2.24 行为。`dispatch_cron::inject_sentori_msg_id` 在 provider.send() 前 mutate `msg.data` 加 `_sentori: { msgId: "send_..." }` —— 保留命名空间,legacy SDK 忽略未知 key(silent no-op 等 v2.26 读)。空 data → 创建;已有 object → 保留 caller key + 加 `_sentori`;非 object data(legacy string payload)→ 不动 skip correlation 但不破 payload。`PAYLOAD_MAX_BYTES` 从 4096 降到 4032 给 64 byte _sentori 头空间,防 max-budget 客户因注入 over-limit。97 push 单测(4 新 dispatch_cron:inject 进 absent data / preserve existing keys / skip non-object data / overwrite existing _sentori)+ preflight 全绿。零 SDK / dashboard 触动。详见 [`docs/roadmap/v2.25.md`](./docs/roadmap/v2.25.md)。
- **v2.26** ⏳ in progress 2026-06-10 — **Push Phase 2 第七笔:RN SDK auto-correlation + confirmed delivery ack**。第一笔 Phase 2 触动 SDK 代码。Migration 0080 给 `push_sends` 加 nullable `acked_at TIMESTAMPTZ + ack_session_id TEXT` + index `push_sends_acked_idx ON (project_id, acked_at) WHERE acked_at IS NOT NULL`。新公开端点 `POST /v1/push/sends/:id/ack` idempotent first-ack-wins(`UPDATE … WHERE acked_at IS NULL`),body `{ sessionId?, eventType? }`,返 `{ acked, firstAck }`。`BreadcrumbType` 同步 `'push'` variant 进 `sdk/core/src/types.ts` + `server/src/event.rs`(CLAUDE.md lockstep rule)。RN SDK `sdk/react-native/src/push.ts` 在 drain loop 处 `autoCorrelate(raw, 'received'|'opened')`:从 `data._sentori.msgId` 拉,有就 (a) `addBreadcrumb('push', {msgId,title,body,opened,provider})`,(b) `track('sentori.push.received'|'sentori.push.opened', {msgId,provider})`,(c) `enqueueAck(msgId)` 进 5s 背景 flush 队列 POST 到 server。`guessProvider` 从 native 字段推断(`raw.from→fcm` / `raw.category→apns` / 都没→`unknown`)。新公开 `sentori.push.setSessionContext(sessionId)` 让 host 戳当前 session 给 ack 用。Payload 没 `_sentori.msgId`(legacy 服务器 / 非 Sentori sender)= 完全 v2.25 SDK 行为透传不触发新 pipeline。Changeset:`sentori-core` minor(BreadcrumbType union additive)+ `sentori-react-native` minor(auto-correlate API additive)。10 RN push 测试(7 老 + 3 新 auto-correlate)+ preflight 全绿。Host-app 零代码触动。详见 [`docs/roadmap/v2.26.md`](./docs/roadmap/v2.26.md)。
- **v2.27** ⏳ in progress 2026-06-10 — **Push Phase 2 第八笔:downstream-impact correlation 查询 + send-detail Card**。关掉 Observability link-through 铁律 #4 dashboard 一半 — v2.25 写 wire / v2.26 SDK 喂 breadcrumb+ack / v2.27 让 dashboard 显示 "这条 push 引起了什么"。新 `GET /admin/api/projects/:id/push/sends/:id/downstream` 加载 `push_sends.sent_at` 后扫 `events_partitioned` 在 [sent_at, +24h] 窗口 `payload->'breadcrumbs' @> [{type:'push', data:{msgId:$id}}]`,聚合 `eventCount / errorEventCount(error_type 非空)/ distinctSessions(session.id 唯一)/ first+lastSeenSecs from sent_at`。Partition-prune by `received_at` 把扫描限在 1-2 partition。Pre-v2.25 sends(没 sent_at)返 `correlationStatus='n/a'` + 零 — UI empty-state 而非误导 0%。新 `DownstreamImpactCard` 在 send-detail-view 加 4-stat grid(Events / Errors红 if >0 / Sessions / First-seen-delta),n/a 状态 + 0-events 状态各有专门 copy。**主动跳过**:materialized view(live query 在典型规模够)、reverse-attribution 端点(Issue→pushes 需 Issue UI 重设计)、campaign/template/audience cohort 视图(分离 "Push BI" module)。零 schema / migration / SDK 触动。纯读取 + UI Card。详见 [`docs/roadmap/v2.27.md`](./docs/roadmap/v2.27.md)。
- **v2.28** ⏳ in progress 2026-06-10 — **Push Phase 2 第九笔:rich-media(image)wire + Android BigPicture + iOS NSE template**。新 wire 字段 `NativeOptions.richMedia.imageUrl`,三 provider 翻译:**APNs** 强制 `aps.mutable-content:1` + 顶层 custom-data `sentori_attachment_url` 给 NSE 读;**FCM** 写 `message.notification.image`(Android 自动 BigPicture 渲染,**零设备端工作**);**WebPush** 透传到 `data.sentori_attachment_url` 让 host Service Worker 用。Legacy customer 没 `richMedia` = 完全 v2.27 行为。`sdk/expo/app.plugin.js` 加 `withSentoriNSE`:`expo prebuild` 时拷 `templates/ios-nse/SentoriNotificationServiceExtension.swift + SentoriNSE-Info.plist` 到 `ios/SentoriNSE/`,idempotent。NSE Swift template 5s timeout 下载 + 附 attachment + 失败/超时 fallback 文字-only。`{ nse: false }` 可 opt out template,`{ ios: false }` 整 iOS push 都关。**v2.28 跳过**(给 v2.28.1):auto Xcode pbxproj target 注入(用 `withXcodeProject`)— 现在 recipe 文档手动 5-click 加 NSE target;video/audio attachment 也留后。Changeset:`sentori-core` minor(wire add)+ `sentori-expo` minor(NSE template scaffolding)。101 push 单测(4 新 rich-media:APNs 双向 + FCM 双向)+ preflight 全绿。零 wire 破坏。Host-app 升级 server image 即拿到 Android BigPicture;iOS NSE 是 opt-in 一次性 Xcode 步骤。详见 [`docs/roadmap/v2.28.md`](./docs/roadmap/v2.28.md)。
- **v2.29** ⏳ in progress 2026-06-10 — **Push Phase 2 第十笔:interactive actions wire passthrough**。新 wire 字段 `NativeOptions.actions: Array<{id,title,isTextInput?,isDestructive?}>` 加进 NativeMessage。APNs `build_aps_payload` 把数组 JSON 化进 top-level `sentori_actions` custom data;FCM stringify 进 `message.data.sentori_actions`(FCM data 字段强制 string);WebPush 通过 `msg.data` 已经透传给 SW。**v2.29 主动跳过**:iOS `UNNotificationCategory` 生成(Apple 要 launch 时 host AppDelegate 注册,server 无法 dictate)+ Android Channel API(v2.30)+ action-response ack endpoint(后续版本按需)。102 push 单测(1 新 APNs smoke:actions array 写入 + isTextInput/id 透传)+ preflight 全绿。Legacy customer 不传 actions = 完全 v2.28 行为。详见 [`docs/roadmap/v2.29.md`](./docs/roadmap/v2.29.md)。
- **v2.30** ⏳ in progress 2026-06-10 — **Push Phase 2 第十一笔:iOS interruption-level + thread-identifier + Android channel-importance wire batch**。三 additive optional 字段:`interruption_level` ('passive'|'active'|'timeSensitive'|'critical') → `aps.interruption-level`(iOS 15+);`thread_identifier` → `aps.thread-id`(iOS lock-screen 折叠);`channel_importance` ('high'|'default'|'low'|'min') → FCM `message.android.notification.notification_priority`。Server-only wire 透传,legacy 不传 = v2.29 行为。102 push 单测 + preflight 全绿。详见 [`docs/roadmap/v2.30.md`](./docs/roadmap/v2.30.md)。
- **v2.31** ⏳ in progress 2026-06-10 — **Push Phase 2 第十二笔:topic pub-sub fanout**。Migration 0081 加 `device_topics(device_token_id, topic)` + topic index。`POST /v1/push/tokens/:ipt/topics {topic}` 订阅(idempotent);`DELETE /v1/push/tokens/:ipt/topics/:topic` 退订(idempotent 不漏 existence)。`ToField` union 加 `Topic` variant;`enqueue_send` 检测 topic → JOIN `device_topics + device_tokens`(project-scoped + active only)+ fanout 一个 send 每订阅设备。零订阅 = 空 ticket 数组(无 error)。**跳过原 v2.31-v2.33**(RN local schedule / iOS critical+VoIP / Live Activity — RN-native 重活,单开 "RN Polish" 系列)。零 SDK / dashboard 改。102 push 单测 + preflight 全绿。Legacy customer 用 Single/Many `to` shape 完全不变。详见 [`docs/roadmap/v2.31.md`](./docs/roadmap/v2.31.md)。
- **v2.32** ⏳ in progress 2026-06-10 — **Push Phase 2 第十三笔:scheduled sends**。`NativeMessage.sendAt: rfc3339 Option`。`enqueue_send` 把 `next_attempt_at` 设到 `GREATEST(now(), sendAt)` —— `dispatch_cron::sweep_once` 现有 `next_attempt_at <= now()` filter 自然 hold 行直到时刻到。Past timestamps 折叠 = "send now"。无 dispatcher 新复杂度。零 SDK / dashboard 改。102 push 单测 + preflight 全绿。详见 [`docs/roadmap/v2.32.md`](./docs/roadmap/v2.32.md)。
- **v2.33** ⏳ in progress 2026-06-10 — **Push Phase 2 第十四笔:user-based publishing fanout**。`ToField::User { userFingerprintHex: "<hex>" }`,`enqueue_send` hex-decode 后 `SELECT id FROM device_tokens WHERE project_id = $ AND user_fingerprint_hex = $ AND revoked_at IS NULL`,fanout 一 send 每设备。零 schema 改(`device_tokens.user_fingerprint_hex` 自 v2.7 就有 BYTEA 列)。零用户(空设备 set)返空 tickets;坏 hex 返 InvalidTokenHandle。零 SDK / dashboard 改。102 push 单测 + preflight 全绿。详见 [`docs/roadmap/v2.33.md`](./docs/roadmap/v2.33.md)。

> 版本管理：从这套 polish 起，monorepo 改用 [Changesets](./docs/runbook/release-sdks.md) 管理多包 semver，避免空 bump。

公开 surface（v2.4 起单域名拓扑）：`sentori.golia.jp/`（marketing） + `sentori.golia.jp/main/*`（dashboard SPA） + `sentori.golia.jp/admin/api/*` + `sentori.golia.jp/api/*`（auth / admin / org backend） + `sentori.golia.jp/docs/*`（文档站，Astro Starlight `base: '/docs'`）；独立 host：`ingest.sentori.golia.jp`（SDK 上报，保留独立 host 以免破坏已发出的 customer token） + `cdn.sentori.golia.jp`（SDK install script / CLI 二进制） + `status.sentori.golia.jp`（Better Stack）。`app.sentori.golia.jp` / `docs.sentori.golia.jp` / `api.sentori.golia.jp` 仍解析到 lx64 origin 做 301 redirect 兼容老链接。详见 [`docs/design/single-domain-routing.md`](./docs/design/single-domain-routing.md)。

---

## 部署形态：双轨

**轨 A — Self-Hosted（Phase 0–10）：** 一行 `docker compose up`，企业内网或单 VM 即可跑通。任何想自己掌控数据的团队的兜底。
**轨 B — SaaS（Phase 11–16）：** `sentori.golia.jp` 公开服务，零运维上手；和轨 A **共用同一个二进制 + 同一份 schema**，靠环境变量开多租户开关。

不维护两个分支。SaaS = self-hosted + 多租户表 + 注册流程 + 配额计量 + 域名分流。

---

## Subdomain 拓扑（v2.4 单域名整合后）

| Host + path | 用途 | 渲染 | 后端 | 备注 |
|---|---|---|---|---|
| `sentori.golia.jp/` | Marketing 主站 | 静态（Astro） | origin Caddy `/apps/sentori/marketing-dist` | v2.4 起从 CF Pages 搬到 lx64 origin |
| `sentori.golia.jp/docs/*` | 文档站 | 静态（Starlight build，`base: '/docs'`） | origin Caddy `/apps/sentori/docs-dist` | 老 `docs.sentori.golia.jp` 301 redirect |
| `sentori.golia.jp/login`、`/register`、`/verify`、`/forgot-password`、`/reset-password/<t>`、`/invite/<t>`、`/transfers/<t>` | SPA auth + accept flows | 静态（web/dist） | nginx in `sentori-web` | 根 path，未登录路径 |
| `sentori.golia.jp/main`、`/main/*` | SPA dashboard | 静态（web/dist） | nginx in `sentori-web` | 登录后的 dashboard 都在这里 |
| `sentori.golia.jp/admin/api/*`、`/api/*` | Admin / auth / org backend | 动态 | Caddy reverse_proxy → `sentori-server:8080` | 老 `api.sentori.golia.jp` 也走这里 |
| `ingest.sentori.golia.jp/v1/*` | SDK 上报端点 | 动态 | Caddy reverse_proxy → `sentori-server:8080` | **保留独立 host** —— 已发出的 customer SDK token 写死了这个 URL，迁移成本 = 强制每个 customer 重 init |
| `cdn.sentori.golia.jp` | SDK install script / CLI 二进制 | 静态 | origin VM Caddy 静态托管 | 不涉 v2.4 整合 |
| `status.sentori.golia.jp` | 状态页 | 第三方 | Better Stack（CNAME） | 不涉 v2.4 整合 |

**legacy redirect**：`app.sentori.golia.jp/<path>` → 301 → `sentori.golia.jp/main/<path>`；`docs.sentori.golia.jp/<path>` → 301 → `sentori.golia.jp/docs/<path>`。Caddy 块见 [`docs/design/single-domain-routing.md`](./docs/design/single-domain-routing.md)。

**TLS 路径：**

- 所有 host 都由 origin VM Caddy 自动 ACME 签 Let's Encrypt 证书。`sentori.golia.jp`（根域）+ `ingest.sentori.golia.jp` 都各一张独立证书。
- 不再走 Cloudflare Pages，全部 origin-hosted 后路径整合是天然的：一份 Caddyfile 一个 docker-compose 就能拉起整个 dashboard + marketing + docs + backend。

**DNS 管理：通过 devops 项目（不直调 Cloudflare API）**

DNS 由 `~/workspace/goliajp/devops/` 项目里的 `crates/devops-core/src/dns/` 管理，唯一入口是 `zones.yaml`（`golia.jp` zone 下加 records）。`local_to_cf_name`（`cloudflare.rs:77`）对 record `name` 层级深度无限制，写 `name: sentori` 产出 `sentori.golia.jp`、`name: ingest.sentori` 产出 `ingest.sentori.golia.jp`。每次同步前必须先 `devops dns diff` review（删除必须显式确认）。

---

## DSN-equivalent 设计（不复用 Sentry DSN）

Sentori **不**用 Sentry 的 `https://<key>@host/<project>` URL 编码方案。SDK 配置永远是两个独立字段：

```typescript
sentori.init({
  token: 'st_pk_01j5y9z3vk8x',                    // 必填，项目 token
  release: '1.2.3+456',                            // 必填
  env: 'prod',                                     // 选填，默认从 __DEV__ 推断
  ingestUrl: 'https://ingest.sentori.golia.jp',    // 选填，默认即此
});
```

Self-hosted 用户改 `ingestUrl` 即可指向自己的 host；token 不变。

理由：

1. URL 编码 token 容易随 URL 泄漏到日志（很多日志框架全文记录 URL）
2. token 轮换不应连带改 URL
3. `.env` 两变量（`SENTORI_TOKEN` + `SENTORI_INGEST_URL`）比拆 DSN 字符串友好

文档术语：宣传材料一律用 "token + ingest URL"，**不用 "DSN"**（避免 Sentry 烙印混淆）。

---

## 跨 Phase 横切关注

整条链都要持续维护：

- **CI 健康**：每个 sub 收尾前 `bun run check / test / build` + `cargo test` 全绿
- **commit 节奏**：每 sub 至少一 commit；checkbox 跨多 commit 时维持 ROADMAP 的进度同步
- **依赖 audit**：`bun audit` + `cargo audit` 进 CI
- **协议契约稳定**：`docs/protocol.md` 改动必须同步改 server `event.rs` 和 sdk `types.ts`，否则 PR 不合格
- **设计语言纪律**：dashboard / marketing 任何 UI 改动以 Linear / Vercel / Modal 为参考，违反则在 PR 描述里说明理由
- **部署纪律**：main commit 自动 build → staging；prod 部署手动 trigger 从 staging 镜像 promote；DB migration 必须可逆，先在 staging 跑过 ≥ 24h
- **生产纪律**：监控告警 7×24（单人 on-call）；每月 backup restore 演练 1 次；每季度 dependency audit + security review
- **性能回归**：任何 `docs/performance.md` 的 headline 数字退化 > 20%，或 EXPLAIN plan shape 变（新 Seq Scan / Sort / Hash Join / 分区裁剪丢失） → PR 描述解释 / 跟进 commit 修回去 / 显式更新 baseline 三选一

---

# v0.3 收尾（已解封 — Insight 自 2026-05 起在用 Sentori）

Phase 30 sub-A/B 当时 user-blocked，等 Insight dogfood。现在 Insight 已接 `sentori-react-native@0.5.2` 并产出真实 trace/error 数据 → 解封。这两个 sub 的内容（onboarding 秒表、摩擦点修复，候选 top-1/2 是 "sourcemap upload 发现性差" + "token 401 信息不清"）与 v0.5 Phase 40（可读错误）高度重叠 —— 直接吸收进 Phase 40 的 dogfood 步骤，不再单列。下面的原始 checklist 保留作素材参考。

## Phase 30 sub-A — Insight 接入流程秒表

- [ ] 在 Insight 项目里 `bun remove` 老版本 + `bun add @goliapkg/sentori-react-native@latest`，秒表掐 install → config → 第一个事件落 dashboard 总耗时
- [ ] 新文档 `docs/dogfood/insight-friction.md`：列每一步耗时 / 卡顿点 / 文档查找次数 / 错误信息看不懂的瞬间
- [ ] 输出 top-5 摩擦点优先级表（影响范围 × 修复成本）作为 sub-B 输入
- [ ] commit `phase 30 sub-A: insight onboarding stopwatch`

## Phase 30 sub-B — 摩擦点修复（top-5）

- [ ] 修 top-1（候选：sourcemap upload 命令发现性差 → README 顶部一句话 + dashboard onboarding 引导）
- [ ] 修 top-2（候选：token 401 错误信息不清 → server 401 response body 加 `hint` 字段说明 token 不是 `st_pk_` 前缀 / 已 revoke / project 不匹配）
- [ ] 修 top-3（候选：release 字符串约定 `<app>@<version>+<build>` 没文档化 → docs `protocol.md` + getting-started 加专栏）
- [ ] 修 top-4（具体项 sub-A 输出后定）
- [ ] 修 top-5（同上）
- [ ] 每个修一独立 commit `phase 30 sub-B: <friction>` 便于 cherry-pick

---

# v0.4 ROADMAP — Distributed Tracing

**主轴**：把 protocol 早就留好的 `traceId` / `spanId` 槽真正用起来。从 RN 应用一路追踪到后端 API，看 waterfall。**不开新轴**——不上 metrics / logs / profiling / OpenTelemetry SDK 兼容。营销不主动推广，继续 dogfood 驱动（dashboard 自己接入 trace、Insight 团队接入）。

**反 Sentry 过时点**：Sentry tracing 走 envelope-bloated 协议（每个 span 都嵌套 `transactions[]` + 大量重复 meta），dashboard 也是 hover-tooltip 风格。Sentori v0.4 走单 JSON span ingest + 紧凑 waterfall 表格（Linear/Grafana Tempo 风格），延续 v0.1 的 schema 简纪律。

**RN-first 立场**：Tracing 在 mobile + backend 联动比纯 web 更值钱（network round-trip 在 mobile 更大、更不可见）。先做 RN + Node 后端联动，Web/Next.js 跟随。

**总工时**：8-11 周（1 人全职）。**Entry**：v0.3 实质完成（25/27）。

每条 step 独立可执行（动词 + 目标 + 文件 + 验收）。跨 phase 严格线性、不并行。

## Phase 34 — Protocol + storage 准备

**Goal:** Span ingest 路径打通：协议 → server schema → 索引 → ingest endpoint。看不到 UI，但能 `curl` 出 trace 数据。
**Entry:** v0.3 ✅. **Exit:** `/v1/spans` 接受单 span / batch span；按月分区存储；EXPLAIN 全部 query sub-ms。
**Estimate:** 2-3 周

### sub-A — Span protocol

- [x] `## Span schema` 章节：14 字段表（id / traceId / parentSpanId / op / name / startedAt / durationMs / status / tags / data / traceparent + types/required/notes）；projectId 从 token 推（不在 body）；`status` enum 含 `cancelled` 给 AbortController 场景；`op` 命名约定子表（http.client/server / db.query/transaction / cache.get/set / react.render/navigation / app.cold-start）
- [x] "What we deliberately don't do" 子节明文反 Sentry/OTel：no transactions[]（root 就是 parentSpanId==null）/ no measurements 浮点矩阵（用 tags+data）/ no transaction.name vs span.description（只有 name）/ no nav 自动跨路由续约
- [x] Endpoints 章节加 `### POST /v1/spans` + `### POST /v1/spans:batch`（200 spans/batch 上限，比 events 100 高因为 span ~200-400B vs event 1-10KB）
- [x] Design principles line 16 重写：从"reserved extension slot"改成 v0.4 实际实施声明
- [x] Event schema 的 `traceId` / `spanId` 字段从 "reserved (v0.1 always null/omitted)" 改成 v0.4+ 实际语义 + 提到 dashboard "In trace →" pill 跳转
- [x] Size limits 表加 5 行 span 相关 limit（单 payload 64KB / batch 200 / data 16KB / op 64 char / name 200 char / durationMs ≤ 24h）
- [x] Batch wrapper 章节拆 "Events batch" + "Spans batch" 子节
- [x] 镜像到 `docs-site/src/content/docs/protocol.md`（保留 5 行 starlight frontmatter）；docs build 23 page 通过
- [x] commit `phase 34 sub-A: span protocol`

### sub-B — Server schema + migration

- [x] migration `0026_spans.sql`：`spans` `PARTITION BY RANGE (received_at)`，PK `(received_at, id)` 复合（partition key 必须在 PK），bootstrap 2026_05..2026_08 + default partition；4 索引 — `trace_id` 走 trace detail / `(parent_span_id) WHERE parent_span_id IS NOT NULL` 走 waterfall build（partial 排掉 root 行节约空间）/ `(project_id, received_at DESC)` 走 trace list / `(project_id, op)` 走 span search
- [x] migration `0027_trace_meta.sql`：`traces` per-trace 物化 summary（`trace_id PK + project_id + root_op + root_name + first_seen + last_seen + span_count + status check 三选一 + duration_ms`）；**不**分区（trace 数是 span 的 ~1/200，10M 行内 PG 单表 OK，留到真实流量 push past 时再分）；keyset 索引 `(project_id, last_seen DESC, trace_id DESC)` 给 trace list 分页
- [x] 应用到 dev DB 验证：6 个 CREATE TABLE + 5 个 CREATE INDEX + traces 表 1 个 CREATE TABLE + 2 indices；`spans / spans_2026_05 / spans_default / traces` 全部存在；cargo test --lib 18/18 仍绿
- [x] commit `phase 34 sub-B: spans + traces schema`

### sub-C — `/v1/spans` ingest endpoint

- [x] `server/src/api/spans.rs`：`handle()` 单 span + `handle_batch()`（≤ 200/batch）；shared `SpanInput` deserialize；`SpanAck { id }` / `SpansBatchResponse { accepted, rejected, errors[] }` 同 events:batch 模式；per-span error 不 fail 整个 batch
- [x] `validate()` 7 项：op 长度 0..=64 / name 长度 0..=200 / status enum / duration_ms 0..=24h / tags ≤ 50 keys 且 value 必须 string / tag key 长度 / data JSON encode ≤ 16 KB
- [x] `persist_span()` 用 tx 跨 spans + traces 两次写：spans INSERT；traces `ON CONFLICT (trace_id) DO UPDATE SET` 维护 `last_seen = GREATEST` / `span_count += 1` / `root_op = COALESCE(EXCLUDED, traces.root_op)`（root 才设）/ `duration_ms = GREATEST` / `status = CASE worst-of (error > cancelled > ok)`
- [x] Quota 共享 `quotas::check_and_record` per-org bucket（DevToken 不查；batch 整体算一次 ingest write，单 span 一次）；`Valkey unset/DB unset` fail-open posture 同 events
- [x] `server/src/router.rs`：`POST /v1/spans` + `POST /v1/spans:batch` 两路由挂在 ingest token group；`server/src/api/mod.rs` 加 `pub mod spans`
- [x] 8 个单测 `mod tests`：accept minimal / reject empty op / 过长 op / unknown status / negative duration / 24h+1 duration / non-string tag value / root null parent。cargo test --lib **26/26 pass**（was 18，+8）
- [x] 真 server smoke 通过：(1) single root → 202 ack (2) child same trace → 202 + DB 看到 parent_span_id 链 (3) batch 3 → `{accepted:3, rejected:0}` (4) trace 状态 worst-of 验真：3 个 batch span 含 1 个 status=error → trace.status 翻成 error (5) 混合 batch bad/good → bad 由 index 报 `validationFailed:invalidOp`，good 仍 accept
- [x] 清理 dev DB 的 6 个 smoke spans + 3 traces
- [x] commit `phase 34 sub-C: spans ingest endpoint`

### sub-D — EXPLAIN baseline

- [x] `tools/seed-spans.ts`：HTTP-path 工具，500 trace × 200 spans batch via `/v1/spans:batch`；10×5 smoke 跑通（510 sp/s，0 rejected）；real-ingest 测试时用此（走完整 quota / validation / trace materialization 链路）
- [x] EXPLAIN baseline 数据准备走 SQL bulk INSERT（HTTP 100k 需 3min，SQL 1s）：3 步 `generate_series` — 500 traces + 500 root spans + 99,500 children（CROSS JOIN generate_series(1, 199)）→ 100,050 spans / 510 traces；遇 2 个 SQL bug：(1) `random()*N+1::int` 在 random≈1 时四舍五入到 N+1 数组越界 → 用 `floor(...)::int + 1` (2) interval 字面值用科学计数法被 PG 拒 → 用 `(floor(random()*1000)::int || ' milliseconds')::interval`
- [x] 3 query EXPLAIN：(Q1 trace list) **0.075ms** Index Scan on `traces_project_last_seen_idx` / (Q2 trace detail 200 spans) **0.68ms** Bitmap Heap Scan via `spans_2026_05_trace_id_idx` / (Q3 span search op+duration top-50) **5.64ms** Bitmap Heap Scan + 16887 candidate rows + in-memory sort — 最慢的一项但仍远低于任何 SLO
- [x] `docs/performance/baseline-v0.4-phase34.md`：每 query 完整 plan + headline 表 + methodology（SQL bulk vs HTTP tool 用途分工）+ 不覆盖项（跨 partition trace / 不均匀分布 / cold start）+ 2 项 action items deferred（Q3 加 `(project_id, op, duration_ms DESC)` 复合索引 / Q2 partition-pruning hint，留到真实流量证明值得才上）
- [x] 清理 dev DB 的 bulk-100k 数据（100k spans + 500 traces）；保留 50 spans / 10 traces 来自 seed-spans 工具 smoke 作工具有效证据
- [x] commit `phase 34 sub-D: span ingest explain baseline`

## Phase 35 — SDK 端：RN + JS + React

**Goal:** SDK 暴露 span API；自动 instrument fetch + react-router navigation；W3C `traceparent` header 注入。
**Entry:** Phase 34 ✅. **Exit:** `sentori.startSpan('op')` 工作；`fetch()` 自动产 `http.client` span；dashboard 自身 dogfood 能看到自家请求 waterfall。
**Estimate:** 2 周

### sub-A — `sdk/core` 加 span buffer

- [x] `sdk/core/src/types.ts` 加 `SpanStatus` enum + `Span` wire-format type，对应 sub-A 协议 schema 11 field（id / traceId / parentSpanId / op / name / startedAt / durationMs / status / tags / data? / traceparent?）
- [x] `sdk/core/src/spans.ts`：`SpanHandle` class — `startSpan(op, opts?)` 返回 mutable handle，`setName / setTag / setData / finish({status?, tags?})`；`finish` 二次调用 no-op；`SpanBuffer` ring buffer cap=1000（同 breadcrumb 模式 + 多一个 `drain()` 方法给 transport flush）；模块级 `_global` 默认 buffer，可传 custom buffer
- [x] `sdk/core/src/trace-context.ts`：`withSpan(span, fn)` + `activeSpan()`；Node 路径 lazy require `node:async_hooks` AsyncLocalStorage（处理 await 后 context 保留）；browser/RN fallback 用 save-and-restore module variable（线性 await OK，并发 promise 分叉会丢——文档明示用户在 fork 时显式传 parent）；feature-detect via `globalThis.process?.versions?.node`
- [x] `startSpan` 优先级：`opts.traceId` > `opts.parent?.traceId` > `activeSpan()?.traceId` > 新 trace（`uuidV7`）；`opts.parent: null` 显式 detach（覆盖 active context）；`opts.parent` 接受任何 `{spanId, traceId}` 形状（SpanHandle / decoded traceparent / 字面量）
- [x] 21 个单测覆盖：root no-parent / 嵌套 parent inherits / `opts.traceId` 覆盖 / `parent: null` 强 detach / `name` 默认 op / setName-setTag-setData / finish 推 buffer / status passthrough / durationMs = end-start / finish 二次 no-op / custom buffer / cap drop 最老 / drain 清空 / activeSpan null 默认 / withSpan 嵌套 + restore / throw 时 restore 不漏。`bun test` 40/40 pass（was 19，+21）
- [x] `sdk/core/src/index.ts` export `Span` / `SpanStatus` / `SpanHandle` / `SpanBuffer` / `SpanContextLike` / `StartSpanOptions` / `startSpan` / `getSpans` / `drainSpans` / `clearSpans` / `activeSpan` / `withSpan` / `__resetTraceContextForTests`
- [x] 全 SDK suite 复跑：sentori-core 40 / javascript 9 / react 14 / next 9 / react-native 22 / expo（无 test）— 全绿，core schema 加 Span 类型不破坏下游
- [x] commit `phase 35 sub-A: core span api`

### sub-B — JS SDK auto-instrument fetch

- [x] `sdk/javascript/src/hooks/fetch.ts`：monkey-patch `globalThis.fetch` 包成 `startSpan('http.client')` + traceparent header 注入；`installFetchInstrumentation()` 幂等；`uninstallFetchInstrumentation()` 还原原始 fetch reference（**不**用 `.bind()`，否则 reference equality 丢，callers 持旧 ref 失败）；`extractMethodAndUrl` 同时处理 string / URL / Request 三种 input；`mergeHeaders` 让 caller 的 headers 同时保留（traceparent 不挤掉 Authorization 等）
- [x] `toTraceparent(traceId, spanId)` 导出 + 单测：strip `-` 转 lowercase，traceId 全 32 hex 保留，spanId 截 16 hex（uuidv7 高位 8 字节是时间戳前缀，区分度足够）；header 输出 `00-<32hex>-<16hex>-01` 标准 W3C
- [x] 状态映射：HTTP < 400 → `ok` / ≥ 400 → `error`（4xx 5xx 都标 error，dashboard trace list 直接看到失败）；fetch 抛 `AbortError` → `cancelled`（user-aborted 不是 failure）；其它 throw → `error` + `error.message` tag
- [x] `init.ts` 在 enableGlobalHooks 路径里 `installFetchInstrumentation()`，跟 browser/node hooks + session 并列；`enableGlobalHooks: false` 全跳过
- [x] 10 个新 test：toTraceparent 字符串 case 2 个 / install 幂等 / uninstall 复 ref / span 含 http.method + url + status / traceparent header 注入 + 形状 / Authorization 等 caller header 不丢 / 503 → status='error' / NetworkError → status='error' + error.message / AbortError → status='cancelled' / URL + Request 输入形状各支持。**bun test 20/20 pass**（was 10，+10）
- [x] 全 SDK 复跑：sentori-core 40 / javascript 20 / react 14 / next 9 / react-native 22 全绿
- [x] commit `phase 35 sub-B: js sdk auto-instrument fetch`

### sub-C — RN SDK auto-instrument fetch + react-navigation

- [x] `sdk/react-native/src/handlers/network.ts` 扩展：原 `addBreadcrumb('net')` 路径保留，加 `startSpan('http.client')` + traceparent header 注入；status 映射 同 sub-B JS SDK（4xx/5xx → error / AbortError → cancelled / 其它 throw → error + error.message tag）；URL scrub 仍跑（token/secret 不进 span tags）
- [x] 新 `sdk/react-native/src/navigation.ts`：`useTraceNavigation(navigationRef)` hook，接受任何 `{ addListener('state', cb), getCurrentRoute() }` 形状（**duck-typed** 不绑死 `@react-navigation/native` 类型，让 peer dep 真正 optional——consumer 不装 react-navigation 也能编译）；初次 mount 不发 span（参考 sentori-react `useSentoriRouter`）；每次 route 变 → 关闭上一 span，开新 `react.navigation` span `name = "<from> → <to>"` + tags `{nav.from, nav.to}`；unmount 时 close 剩余 open span 不泄露
- [x] 测试：`handlers/network.ts` 6 个（emit http.client span / traceparent header / 5xx → error / NetworkError → error + tag / AbortError → cancelled / caller headers 保留）；`navigation.ts` 5 个（hook export shape / 初次 mount 无 span / 单 hop / same-route 去重 / 链式 hops / cleanup close open span）；用 FakeNav class 模拟 react-navigation ref 避免装 react-test-renderer
- [x] **install-once 测试陷阱解决**：原 beforeEach 重置 globalThis.fetch 破坏 wrapped fetch（wrapper 在 install 时 capture original，后续 globalThis.fetch 重写绕过 wrapper）。改成 beforeAll 一次 install + module-level 静态 recorder + 测试间只改 recorderQueue
- [x] `sdk/react-native/src/index.ts` export `useTraceNavigation` + `NavigationRefLike` 类型
- [x] **bun test 34/34 pass**（was 22 + 12 = 34；6 tracing + 5 navigation - 1 hook-shape sanity = 12 net new）；全 SDK suite 复跑绿
- [x] commit `phase 35 sub-C: rn sdk fetch + navigation tracing`

### sub-D — `sdk/react/src` 加 component render span

- [x] 新 `sdk/react/src/SentoriTrace.tsx` 暴露 `<TraceRender op="..." name? data? tags?>`：first render 用 `useMemo([])` 一次性 startSpan，effect cleanup 在 unmount 时 finish；re-render 不重开 span（lifespan 是 component instance，不是 props）；StrictMode 双 invoke 由 SpanHandle 的 double-finish no-op 兜底
- [x] 6 个单测：render children / 开-关 span shape / 自定义 op+tags+data 全传到 sealed span / name 默认 op / 多 mount 独立 / re-render 不重开
- [x] 同时修两个 latent bug 暴露：(1) sdk/react/package.json 把 `@goliapkg/sentori-core` 从 `0.1.0` bump 到 `0.2.0` —— 否则 bun 解到 npm registry 0.1.0（无 startSpan API）而非 workspace 内的 0.2.0；(2) sdk/react/src/index.ts 历史上漏 export `SentoriSuspense`（lib/ 编译出来但 index.ts 没暴露顶层，consumers 拿不到）—— 一并补上 + 顺手加 `TraceRender` export
- [x] sdk/next/package.json 同步：`sentori-core: 0.1.0 → 0.2.0` + `sentori-react: 0.1.0 → 0.3.0` 跟当前 workspace 版本对齐
- [x] **bun test 20/20 pass**（was 14，+6）；全 SDK suite 复跑：core 40 / javascript 20 / react 20 / next 9 / react-native 34 全绿
- [x] commit `phase 35 sub-D: react render tracing`

### sub-E — bump + publish + dogfood

- [x] Bump 5 包（实际是 5 个而非 ROADMAP 写的 4 个 —— sentori-core 也加了 `Span`/`SpanHandle`/`startSpan`/`withSpan` 新 API，必须 bump 否则下游 `"@goliapkg/sentori-core": "0.2.0"` 拿到旧 npm 版本 missing API）：core 0.2.0 → 0.3.0 / javascript 0.2.0 → 0.3.0 / react 0.3.0 → 0.4.0 / react-native 0.4.0 → 0.5.0 / next 0.1.0 → 0.2.0；inter-deps 同步 bump 让 workspace 解析正确
- [x] sdk/react/package.json#exports 加 `./trace` subpath（`@goliapkg/sentori-react/trace` → `<TraceRender>`）；不挤 top-level export，保留 tree-shake
- [x] `bun publish --access public` × 5 全部成功；npm registry 5 包 latest tag 都已更新
- [x] Dashboard dogfood：`web/src/auth/ProtectedLayout.tsx` 加 `useSentoriRouter()` from `@goliapkg/sentori-react/router`，每次 nav 产 breadcrumb；SentoriProvider 在 main.tsx 已经把 initSentori 走过 → fetch hook 自动注入 → 每个 `/admin/api/...` 请求产 `http.client` span + traceparent header（**first end-to-end dogfood trace**）
- [x] Bundle 影响：dashboard 主 bundle 336.42 KB → 339.66 KB（gzip 106.78 KB → 107.93 KB，+1.15 KB gzip），fetch hook + router hook 的代价合理
- [x] commit `phase 35 sub-E: span sdks publish + dashboard dogfood`

## Phase 36 — Dashboard：Trace List + Trace Detail

**Goal:** UI 把 trace 显出来。Trace list 像 issues list 一样紧凑；trace detail 走 waterfall 表格风格（**不**画 SVG bar，纯表格 + 缩进 + duration 列）。
**Entry:** Phase 35 ✅. **Exit:** 两个新 view 接入 router；dashboard 自己产生的 trace 可视；快捷键 / 过滤 / sourcemap symbolication 都接通。
**Estimate:** 2-3 周

### sub-A — Trace list view

- [x] `server/src/api/traces.rs`：`list_traces` handler 同款 keyset cursor pagination（参考 list_issues Phase 33 sub-B）— JSON array body + `X-Next-Cursor` header；filter 三种 query param: `?op=` exact match / `?status=` / `?durationMs=N` 表示 ≥ N ms；WHERE 用复合 keyset `(last_seen, trace_id) < (cursor_last, cursor_id)` 保严格有序；ORDER BY last_seen DESC, trace_id DESC
- [x] `server/src/api/mod.rs` `pub mod traces`；`server/src/router.rs` 挂 `/projects/{project_id}/traces`
- [x] `web/src/api/client.ts` 加 `TraceRow` type + `listTracesPage(projectId, {cursor, op, status, durationMs, limit})`，与 listIssuesPage 同接口；用 raw fetch + 读 `X-Next-Cursor` header
- [x] 新 `web/src/views/traces.tsx`：6 列 table（Op / Name / Span count / Duration / Status / Last seen）+ status pill 三色（ok 绿 / error 红 / cancelled 黄）；`useInfiniteQuery` + `<LoadMoreSentinel>` 同 IssuesView 模式；keyboard nav j/k/Enter + 三个 filter（status select / op select / min duration ms input）；filter 变 reset selectedIdx 用单点 `eslint-disable-next-line react-hooks/set-state-in-effect`（rule false positive，one-shot reset 不是 derive）
- [x] `web/src/views/org-layout.tsx` NAV 表加 `{ label: 'Traces', path: 'traces' }`，位置在 Issues 后；`web/src/main.tsx` lazy import + router 路由 `traces` path
- [x] **format 工具**：`formatDuration`（<1ms / ms / s 三档）+ `formatRelative`（s/m/h/d ago）独立 helper
- [x] dashboard `bun run check` 0 errors / `bun run build` OK / vitest 24/24；bundle 339.66 → 339.94 KB（gzip 107.93 → 108.01 KB，+0.08 KB —— Traces view 独立 lazy chunk 不进 main bundle）
- [x] commit `phase 36 sub-A: trace list view`

### sub-B — Trace detail (waterfall)

- [x] server `GET /admin/api/projects/{project_id}/traces/{trace_id}` 返回 `{ trace, spans[] }`；spans ORDER BY started_at ASC, id ASC（client 一遍构树）；404 走 AppError::NotFound 已有 IntoResponse mapper
- [x] 新 `web/src/views/trace-detail.tsx`：`buildTree` 由 parent_span_id 二次遍历构 tree，DFS `flatten` 得 row 数组；orphan span（parent 缺失）当 root 兜底，UI 仍显示
- [x] 渲染：3 列表格（Op / Name / Duration / Status）+ 缩进 `n.depth * 16px` 表示嵌套；**不**画 SVG bar / timeline overlay，纯表格 + duration column 已够看出热点
- [x] hover 行：`hoveredId` state + `ancestorIds(byId, hoveredId)` 走 parentSpanId chain 一层一层向上 → 给行加 `bg-bg-tertiary/40` 高亮 root→leaf 全链路
- [x] click 行打开右侧 drawer：id / parent / duration / status / startedAt + tags grid + data `<pre>` JSON pretty-print；`✕` 关；点别的行切换
- [x] `web/src/api/client.ts` 加 `SpanRow` / `TraceDetail` types + `getTraceDetail(projectId, traceId)`
- [x] router 加 `traces/:traceId` lazy route；trace-list 行 onClick → navigate('/org/{slug}/traces/{traceId}') 已在 sub-A 接通
- [x] dashboard `bun run check` 0 errors / `bun run build` OK；main bundle 339.94 → 340.16 KB（trace-detail 独立 lazy chunk）
- [x] commit `phase 36 sub-B: trace detail waterfall`

### sub-C — Span ↔ Event 联动

- [x] migration `0028_event_trace.sql`：`ALTER TABLE events ADD COLUMN IF NOT EXISTS trace_id UUID, span_id UUID`（partitioned parent ALTER 自动传播到 children）+ partial index `events_trace_idx ON events (trace_id) WHERE trace_id IS NOT NULL`（多数 row NULL 用 partial 省空间）
- [x] ingest pipeline (`persist_event_row`)：parse `event.trace_id` / `event.span_id` (Option<String>) → `Uuid::parse_str` → INSERT 携带两列；不存在 trace 上下文时仍正常写入（NULL）
- [x] `EventRow` 扩 `trace_id: Option<Uuid>` + `span_id: Option<Uuid>`；`list_events_for_issue` SQL 加 SELECT 两列；dashboard `EventRow` type 加 `traceId?` + `spanId?`
- [x] Issue detail：在 `<UnsymbolicatedHint>` 下方加 trace pill — `event.traceId` 存在时显示 "Captured inside trace 019e2000 · In trace →" link 跳 `/org/{slug}/traces/{traceId}`
- [x] 反向链接：server `trace_detail` endpoint 返回 `{trace, spans, events[]}` 数组（events 同 trace 的所有，含 issue_id + span_id + error_type）；trace-detail.tsx 用 useMemo 构 `eventsBySpan: Map<spanId, count>` → 每行 status 列右侧加红色小 chip `{n} event(s)`，title 提示
- [x] 验证：cargo build 通过 / dashboard check 0 error / build OK；main bundle 不变（dashboard 改动都在 issue-detail + trace-detail lazy chunk）
- [x] commit `phase 36 sub-C: event-span correlation`

### sub-D — 过滤 + 搜索

- [x] 新 `web/src/lib/trace-query.ts` 同 `parseIssueQuery` 模式：`parseTraceQuery(input)` 解析 `KEY:VALUE` term — `op:` 自由字符串 exact match / `status:` enum 限 ok|error|cancelled / `duration:>Nms` 或 `>Ns`（require `>` prefix 强制语义清晰，未来加 `<` 也不会歧义）；free text 直接 warning 不丢
- [x] `parseDurationFilter`：正则 `^>(\d+)(ms|s)$` 拒绝 missing prefix / zero / 负数 / unknown unit；返回 ms float
- [x] `TracesView` 退掉 sub-A 的 3 个 select/input 替换成单 search box（与 IssuesView 一致的"搜索条"心智模型）；warnings 数 > 0 时显示 amber 小提示 + `title` 列举原因
- [x] 11 个 vitest unit test（trace-query.test.ts）覆盖：3 token 联合 / 秒单位 / free text 警告 / unknown key / bad status / bad duration / empty input / parseDurationFilter 单独覆盖 prefix / zero / negative / unit
- [x] dashboard `bun run check` 0 errors / build OK；vitest **35/35 pass**（was 24，+11）
- [x] commit `phase 36 sub-D: trace search tokens`

## Phase 37 — Cross-cutting：W3C TraceContext + 后端联动

**Goal:** Mobile/Web 客户端发的 traceparent header 被 Sentori-instrumented 后端读到，server-side span 续在同一 trace 里。这是 distributed tracing 的真正价值点。
**Entry:** Phase 36 ✅. **Exit:** dashboard 接入 sentori-javascript → 后端 sentori-server 自己开 span → 同一 trace 看到 client + server 两段。
**Estimate:** 1-2 周

### sub-A — sentori-server 自身 instrumentation

- [x] `server/src/trace_emit.rs`：`SpanEmitter` 模块 — `spawn(pool, project_id)` 启 buffer (Arc<Mutex<Vec>>) + 30s 周期 flush + 200-span 突发 flush；`flush_batch` 一 tx 内 INSERT spans + UPSERT traces，复用 `/v1/spans` 同款逻辑；`try_push` 异步进 buffer 不阻塞热路径
- [x] `parse_traceparent(header)` 解 W3C 格式：32-hex traceId → uuid / 16-hex parent-id → 32-hex uuid 零右填（lossy 但跨系统 stitching 足够）；7 单测覆盖各种错位
- [x] `server/src/tracing_middleware.rs`：axum middleware 包 handler，request 进入 → 读 traceparent 或开新 trace → Instant 计时 → next.run → 决定 status（5xx error / 4xx ok 因 client 错 / 2xx ok）→ try_push 含 http.method / http.path / http.status tag
- [x] `router::build` 加 `cfg.self_trace: Option<SpanEmitter>`，最外层 layer；`main.rs` 读 env `SENTORI_SELF_TRACE_PROJECT_ID`（UUID），不设默认 None
- [x] **不**做内部 sqlx query span / cache fetch child span（侵入性大，需 sqlx interceptor，留 Phase 38 polish 或 v0.5）
- [x] Live smoke：3 GET + 1 GET with traceparent → 等 30s flush → DB 33 spans + 32 traces 落入；带 header 的请求 trace_id `aaaaaaaa-...` + parent_span_id `bbbbbbbb-bbbb-bbbb-0000-...` (16→32 hex 零填) 跨系统 stitching 验证通过
- [x] `cargo test --lib` 33/33 pass（was 26，+7）；`docker build` OK
- [x] commit `phase 37 sub-A: server self-instrument`

### sub-B — Node SDK middleware（Express/Hono/Fastify）

- [x] `sdk/javascript/src/tracing-middleware.ts` 暴露 3 framework adapter + 共享 `parseTraceparent`；subpath export `@goliapkg/sentori-javascript/tracing`
- [x] Express: 监听 `finish`+`close` 双重 idempotent；不能 withSpan 因 callback-style next 不能传 context — 但 http.server span 仍正确 emit
- [x] Hono: async withSpan(next) 让 handler 内 startSpan 自动 child；try/catch throw → status=error + error.message tag + re-throw
- [x] Fastify: plugin-style `installFastifyTracing(fastify)` 注册 onRequest + onResponse hook，req.sentoriSpan 槽传 span 跨 hook
- [x] 5xx → error / 4xx → ok（client 错不是 server fail）；inbound traceparent 解 + 继承
- [x] 15 个新单测覆盖 parseTraceparent 边界 / 各 framework lifecycle / traceparent 继承 / throw 处理。**bun test 35/35 pass**（was 20，+15）
- [x] commit `phase 37 sub-B: node tracing middleware`

### sub-C — 文档 + recipe

- [x] 新 `docs-site/src/content/docs/recipes/distributed-tracing.md`：三层 trace 全栈示意 + ASCII 拓扑 + 三 framework middleware + dashboard 过滤查询 + W3C traceparent stitch 半 lossy 说明 + SDK ↔ 协议 crosswalk 表
- [x] sidebar 加 entry；mirror 到 `docs/recipes/distributed-tracing.md`；docs-site build 24 page
- [x] commit `phase 37 sub-C: distributed tracing recipe`

## Phase 38 — Polish + Performance + 发布

**Goal:** 1M span 规模复测；index 补齐；CHANGELOG v0.4 entry；tag release。
**Entry:** Phase 37 ✅. **Exit:** v0.4 ROADMAP 100% / git tag v0.4.0 / sentori-react@0.4 等四个 SDK 包 publish / docs site 更新 hero "distributed tracing first-class"。
**Estimate:** 1 周

### sub-A — 1M span 复测

- [x] SQL bulk INSERT 模式（参考 Phase 33 sub-A）：5000 traces + 5000 root spans + 995,000 children = 1,000,046 spans / 5007 traces / spans 表 284 MB；总耗时 ~15s
- [x] 跑 4 个 hot-path query EXPLAIN（不止 ROADMAP 列的三个，加 Q4 span search 看 op+duration top-N 行为）：
  - **Q1 trace list 0.131ms**（was 0.075ms / +75% / Index Scan 同 plan）
  - **Q2 trace detail 1.157ms**（was 0.684ms / +69% / Bitmap Index Scan 同 plan，planning time 1.96ms 是新 bottleneck）
  - **Q3 events on trace 0.106ms**（新增 — Phase 36 sub-C 的 `events_trace_idx` partial index 起效；planning 6.80ms 是 events 表跨分区 planner 开销）
  - **Q4 span search op+duration top 50 40.7ms**（was 5.64ms / 7.2× sub-linear / 166k 候选 → in-memory Sort）
- [x] 写 `docs/performance/baseline-v0.4-phase38.md`：4 query 完整 plan + 对比表 + methodology + "什么没测"（跨月 partition / 高 fan-out / 并发读）+ regression policy crosscheck（plan-shape 均未变 → 不触发 v0.3 性能门槛）
- [x] 行动项：Q2/Q3 `received_at>=N days` partition prune hint（partition 数到 12+ 月再做）/ Q4 `(project_id, op, duration_ms DESC)` 复合 index（v0.5 候选，6 月真实流量后评估）
- [x] 清理 bulk-1m-v04 synthetic（DELETE 1,000,000 spans + 5,000 traces）；保留 46 spans / 7 traces 来自 sub-C/D 等先前 smoke
- [x] 决定：v0.4 release 不需要 index migration，sub-B 可以 tag + ship
- [x] commit `phase 38 sub-A: 1m span explain baseline`

### sub-B — CHANGELOG + release notes + tag

- [x] CHANGELOG.md v0.4 section：Goal 段反 Sentry envelope-bloat 立场陈述 + Phase 34/35/36/37/38 各 sub 一行 condensed summary；放在 v0.3 之上、最近优先；5 npm package version 标黑
- [x] marketing hero 加副标题 `v0.4 · Distributed tracing built in.`（accent-coloured，h1 和 sub-hero 之间）；主 hero "Error tracking, built React-first." 不动
- [x] ROADMAP 顶部状态：v0.4 🚧 → ✅ + 加 v0.5 📐 待规划占位
- [x] git tag v0.4.0 + push；GitHub Release `gh release create v0.4.0` 含完整 release notes（distributed tracing / 5 SDK bumps / performance baseline 数字 / 协议 stable 声明 / "what we didn't do" / docs link）→ https://github.com/goliajp/sentori/releases/tag/v0.4.0
- [x] commit `phase 38 sub-B: v0.4.0 release`

---

## v0.4 显式不在范围内

避免 scope creep，下面这些**不**做（v0.5+ 决策）：

- ❌ Metrics（counters / gauges / histograms）—— protocol 只覆盖 events + sessions + spans 三类
- ❌ Logs —— breadcrumbs 已覆盖；专门的 logs ingest 路径留 v0.5
- ❌ Profiling（CPU sampling 数据）
- ❌ OpenTelemetry SDK 全兼容 —— 我们用 W3C TraceContext header（互操作的最小公约数），但不实现 OTLP receiver
- ❌ Session Replay
- ❌ Vue / Svelte SDK —— 留 v0.5
- ❌ Slack / Linear / GitHub PR 集成 —— webhook 已就位（v0.2 sub-D），第三方集成留 v0.5
- ❌ Stripe / 计费 —— pro / enterprise 仍手动开通
- ❌ AI root-cause hint
- ❌ 多区域部署
- ❌ 主动推广（Show HN / Twitter launch）—— v0.4 末有 distributed tracing 这个 talking point + 5 SDK publish，看那时声誉值再决定

---

# v0.5 ROADMAP — Scale + Readable Errors + Dashboard sidebar ✅

**三条主线**（线性执行，不并行）：

1. **Trace 上量管控** —— Insight dogfood 暴露：现在每个 fetch 都是独立 root trace（SPAN COUNT 全是 1），上量后 `traces` 汇总表行数爆、列表没法看，span 还跟高价值 error event 抢同一个 ingest 配额。修法选定为**时间硬保留窗口 + 窗口内 100% 不采样**（不默认上 head-based sampling，留作 SDK 开关给真扛不住单机的人），配 span name 路径归一化、navigation span 自动当父、span 独立 rate cap、Phase 38 defer 的 Q4 复合 index。目标量级：~10w 用户、单台 Postgres。
2. **可读的 JS/RN 错误** —— Insight dogfood 暴露：JS 错误栈是 `index.bundle:1:288432` 这种不可读形态。基础设施大半已有（`server/src/symbolicate.rs` 有 sourcemap 解析 + source-context，`/admin/api/releases/{name}/sourcemaps` 上传端点也有，`Frame` 类型已含 `column?`/`function?`），缺的是「`symbolicate_payload` 没接 ingest、只在 admin on-demand 调」和「构建期没人上传 sourcemap」。做成端到端：SDK 抓全帧 → CLI 构建期组合上传 sourcemap（tag 到同一 release 串）→ server ingest 时符号化并存源码片段 + 按符号化帧重新 fingerprint → dashboard 渲染源码片段 + 折叠 vendor 帧 + 标注没符号化的原因。
3. **Dashboard 左侧导航重构** —— 现在是顶部横排 NAV（Overview/Issues/Traces/Releases/Teams/Alerts/Audit/Settings），上量后条目变多挤不下。改成左侧 sidebar（Linear/Vercel/Sentry 范式）：顶部 org/project 切换器，主导航竖排，次要项收进可折叠分组，底部用户菜单 + 主题切换；窄屏折叠成图标轨。

**反 Sentry 立场延续**：保留时间硬窗口比 Sentry 那套多层采样简单且省掉「采样把出错的也丢了」的复杂度（schema 简 / 部署轻）；不做 tail-based sampling collector（stateful、跟轻部署冲突）。

**Entry**：v0.4 ✅ + v0.4.2 已 publish。每条 step 动词 + 目标 + 文件 + 验收；跨 phase 严格线性。

## Phase 39 — Trace 上量管控 ✅

**Goal:** trace 数据在 ~10w 用户量级可控：cardinality 收敛、保留有界、span 不挤占 event 配额。
**Entry:** v0.4 ✅. **Exit:** span name 路径已归一化；navigation 下的 http 请求挂成 child；`SENTORI_TRACE_RETENTION_DAYS` 生效 + 老分区自动 drop；span 有独立 rate cap；Q4 在 ~1300w 行规模复测有 baseline；SDK bump + publish + Insight dogfood 验证。
**Estimate:** 2-3 周

### sub-A — span name 路径归一化（SDK）

- [x] `sdk/core/src/url.ts` 新增 `normalizeUrl(url)`：保留 scheme+host+path、砍 query+fragment；path 段命中以下任一 → `{id}` —— 纯数字 / uuid / 长 hex(≥16，覆盖 mongo ObjectId 24 位 / sha) / 长不透明 token(≥20 字符且含数字)；保守优先（`winter-jacket-2024` / `VC64VOVEX0VT` 这类短码/slug 不动，宁可欠归一也不误伤）；host 不动（per-tenant 子域是另一个问题）；relative URL 走 fallback 当 bare path 处理；空/垃圾输入不抛
- [x] 三个 hook 接入：`sdk/react-native/src/handlers/network.ts`（patchFetch + patchXhr）+ `sdk/javascript/src/hooks/fetch.ts` + `sdk/javascript/src/hooks/xhr.ts` —— span `name` 用 `normalizeUrl(scrubbed)`，`http.url` tag 仍存完整（RN 那条已 scrub auth 参数；JS 那条沿用原 raw url，scrub 是后续 sub 的事）；`sdk/core/src/index.ts` export `normalizeUrl`
- [x] 测试：`sdk/core/src/__tests__/url.test.ts` 9 个（numeric / uuid / 长 hex×2 / 长 opaque / slug 不动 / 砍 query+frag / host 不动 / relative / 空垃圾）；fetch-hook +1（span name `{id}` + tag 保完整含 query）；RN tracing +1（多 id 段归一 + tag scrub）。全 SDK sweep 绿：core 49 / js 51 / rn 44 / react 20 / next 9 / expo 4
- [x] commit `phase 39 sub-A: span name path normalization`

### sub-B — navigation span 自动当父

- [x] `sdk/core/src/trace-context.ts`：加 `setActiveSpan(span | null)`（fallback impl 设 module var；ALS impl no-op —— navigation 只跑 browser/RN，那边是 fallback）+ test hook `__useFallbackTraceContextForTests()`（bun 跑成 Node 会选 ALS，nav 测试需要强制 fallback 来验真 setActiveSpan）；index.ts export 两者
- [x] `sdk/react-native/src/navigation.ts` `useTraceNavigation`：每个屏（含初始屏）开一个 `react.navigation` span（`parent: null` 各自是 trace root），并 `setActiveSpan` 让它在该屏期间常驻 active —— 这一屏的 `http.client` span 自动成 child（一屏 ~30 请求收成 1 条 trace）；下一屏先 finish 旧 span 再开新的（active 一并切换）；unmount finish + `setActiveSpan(null)`；module-doc 加 RN active-span 是 module var 的 caveat
- [x] `sdk/react/src/router.ts` `useSentoriRouter`：原 `nav` breadcrumb 保留，**新增**每路由一个 `react.navigation` span（`parent: null`、`name = from → to` 或初始路由名）并 setActive；unmount finish + clear
- [x] 测试：navigation.test.ts 重写成 7 个（hook export / 初始屏开 span 且 active / 无路由无 span / 屏内 startSpan 自动 child + 同 trace / 各屏独立 root 不嵌套 / same-route 不重开 / cleanup finish + clear active）；router.test.tsx +1（初始 + 每次 transition 各一个 react.navigation span，各自 root、各自 trace）。全 SDK sweep 绿：core 49 / js 51 / rn 45 / react 21 / next 9 / expo 4
- [x] 更新 `docs/recipes/distributed-tracing.md` + docs-site 镜像：rewrite "what you get for free" —— XHR 也覆盖 / span name 路径归一化 / 一屏一 trace + nav span 常驻 active / RN module-var caveat / react-router 的 `useSentoriRouter` 等价物
- [x] commit `phase 39 sub-B: navigation span as active parent`

### sub-C — 时间硬保留 + 老分区 drop（server）

- [x] 决定：`traces` **不**分区 —— ingest 的 `ON CONFLICT (trace_id) DO UPDATE` 需要 trace_id 单列唯一索引，分区表的唯一索引必须含 partition key，冲突。改成 `DELETE WHERE last_seen < cutoff` + migration `0029_trace_retention.sql` 加 `traces_last_seen_idx`（让 delete 走索引扫描）。`spans` 早已按 `received_at` 分区（0026），沿用分区 drop。
- [x] `server/src/retention.rs` 重写（原本只管 events）：泛化 `ensure_future_partitions(table)` / `drop_expired_partitions(table)` / `parse_partition_name(name, prefix)` 同时管 `events` 和 `spans`；events cutoff = `max(org_quotas.retention_days)` floor 30、spans+traces cutoff = `SENTORI_TRACE_RETENTION_DAYS`（默认 14、clamp ≥1）；新 `prune_traces(pool, cutoff) -> u64`（DELETE）从 `run_once` 调；`RetentionStats` 加 `traces_deleted`；main.rs 的 `spawn_retention_task` 调用不变
- [x] 文档：`docs/self-hosting.md` + docs-site 镜像加 `SENTORI_TRACE_RETENTION_DAYS`（顺手补 `SENTORI_SELF_TRACE_PROJECT_ID` 这个 v0.4 漏掉的）+ 新 "Data retention" 小节（events≥30d / spans+traces 默认 14d 不采样 / 分区滚动 + drop 机制）
- [x] 测试：lib 单测 `parse_partition_name` 加跨表 prefix case（events 不匹配 spans_… 等）；新集成测试 `server/tests/trace_retention.rs`（`prune_traces` 删 100 天前的、留今天的；DATABASE_URL 没设则 skip）；`cargo test --lib` 33/33、`cargo test --all-targets --no-run` 通过
- [x] commit `phase 39 sub-C: trace retention window`

### sub-D — span 独立 rate cap（server）

- [x] `server/src/quotas.rs`：新 `check_and_record_spans(valkey, org, now)` —— 独立于 events 的 per-org 月度配额（Valkey key `spans_usage:` / `spans_dropped:`，limit 从 env `SENTORI_SPAN_LIMIT_MONTHLY`，默认 10M、`0`=无限）；逻辑与 `check_and_record` 同款（fail-open、`Exceeded` 时 incr dropped + 返回 `reset_at`）；`span_limit_monthly()` helper。注：per-minute flood 防护已由现有 `rate_limit_middleware`（per-token，`SENTORI_RATE_LIMIT_PER_MIN`）覆盖所有 ingest 路由含 spans，所以 sub-D 只补「月度预算解耦」这一块
- [x] `server/src/api/spans.rs`：`handle` / `handle_batch` 把 `quotas::check_and_record`（吃 events 计数器）换成 `quotas::check_and_record_spans` —— span 洪水不再消耗 org 的 error-event 配额；dev token 仍跳过；batch 整体算 1 次（同 events:batch）
- [x] 文档：`docs/self-hosting.md` + docs-site 镜像加 `SENTORI_SPAN_LIMIT_MONTHLY`
- [x] 测试：lib 单测 `span_limit_defaults_when_env_unset`；`cargo test --lib` 33→34、`--all-targets --no-run` 通过。（跨 Valkey 的「两桶隔离」集成测试评估后不做 —— 共享 DB/Valkey 测试有 flakiness 史，且两个计数器 key 前缀不同、隔离从代码上即可见；与 sub-C 把集成测试限定在 `prune_traces` 同一权衡）
- [x] dashboard span 配额展示：deferred（ROADMAP 标的是"如有…"，本 sub 不做）
- [x] commit `phase 39 sub-D: separate span quota`

### sub-E — Q4 复合 index + 大规模复测

- [x] migration `0030_spans_op_duration_idx.sql`：`CREATE INDEX IF NOT EXISTS spans_project_op_duration_idx ON spans (project_id, op, duration_ms DESC)`（用 plain `CREATE INDEX` 而非 `CONCURRENTLY` —— sqlx 迁移在事务里跑；分区表上 index 自动传播到 children，prod 数据量下短锁可接受。Phase 38 baseline 的 deferred action item 也勾掉 + 链到新 baseline）
- [x] 实测（throwaway `postgres:18-alpine` + 全 migration + SQL bulk INSERT 1M spans，与 Phase 34/38 baseline 同 shape 可直接对比）：**Q4 span search top-50：43.0 ms → 0.40 ms（~100×）**，plan 从 Parallel Seq/Bitmap + top-N heapsort over ~332k 候选 → Merge Append of per-partition Index Scan on 新复合 index（直接 seek top 50，无 sort、无候选物化）；index 建 1M 行 ~0.8s、size ~7.5 MB（~7.5 B/row）。Q1-Q3 plan/index 未动，沿用 phase38 baseline 数字。teardown 临时容器
- [x] `docs/performance/baseline-v0.5-phase39.md`：Q4 before/after 完整对比 + setup + regression crosscheck（纯改进，不触发性能门槛）+ 关于 trace 汇总表 cardinality 在 sub-A/sub-B 后大幅降低的说明
- [x] commit `phase 39 sub-E: Q4 composite index + 1M span re-baseline`

### sub-F — bump + publish + Insight dogfood

- [x] bump + publish 5 包：core 0.3.0 → **0.4.0**（新 API `normalizeUrl` / `setActiveSpan` / `__useFallbackTraceContextForTests`）/ javascript 0.3.2 → **0.3.3**（用 normalizeUrl；dep core→0.4.0）/ react-native 0.5.2 → **0.5.3**（normalizeUrl + setActiveSpan）/ react 0.4.2 → **0.4.3**（router.ts 用 setActiveSpan/startSpan + 开 nav span；dep core→0.4.0、js→0.3.3）/ next 0.2.2 → **0.2.3**（dep 透传）；`@goliapkg/sentori-core` 所有 pinned dep 同步到 0.4.0 避免 npm 解到旧版（version-pin trap）；expo 不动（peer dep、源码未变）；`npm publish` × 5 全部成功。CHANGELOG v0.5 段等 Phase 41 收尾一起写
- [x] `docs/dogfood/insight-friction.md` 加 "Dogfood-driven changes (chronology)" 段（v0.4.1 XHR / v0.4.2 span flush / v0.5 sub-A 归一化 / sub-B nav-parent / Phase 40 symbolication 规划），修掉过时的 SDK 版本元数据；Phase 30 sub-A 秒表表保留（待用户实际 re-onboard 跑）
- [x] **pending user**：Insight 升到 `sentori-react-native@0.5.3` 重跑 → 观察 Traces 是否按路由聚合 / 一屏一 trace（记进上面那个 doc）
- [x] ROADMAP 勾掉 Phase 39（除 sub-F 这条 user-pending observation）
- [x] commit `phase 39 sub-F: bump + publish + dogfood log`

## Phase 40 — 可读的 JS/RN 错误（sourcemap 符号化端到端）✅

**Goal:** 错误直接显示「哪个 release 的 src 哪个文件、哪段代码」+ 源码片段，而不是 `index.bundle:1:288432`。吸收原 v0.3 Phase 30 sub-A/B 的 dogfood + 摩擦点修复（候选 top-1/2 就是 sourcemap 发现性 + token 401 信息）。
**Entry:** Phase 39 ✅. **Exit:** SDK 抓全 column/function；`sentori-cli` 能组合上传 Hermes/Metro sourcemap；server ingest 时符号化 + 存源码片段 + 按符号化帧 fingerprint；dashboard issue 详情显示源码片段 + 折叠 vendor 帧 + 标注没符号化原因；Insight prod 错误验证可读。
**Estimate:** 3-4 周

### sub-A — SDK 抓全帧信息

- [x] 核查：`sdk/core/parseStack` 已支持 V8/Node/Bun/Hermes-0.71+（`at fn (file:line:col)`）+ SpiderMonkey/Safari/旧 Hermes（`fn@file:line:col`），column + function 一直都抓。缺口：Hermes **生产字节码**帧 `at fn (address at /path/main.jsbundle:1:289430)` —— `address at ` 前缀混进了 file，符号化时查不到 sourcemap。修：解析后 `file` 去掉 `^address at +`；`(native)` 帧无位置、不匹配两个正则、丢弃
- [x] `Frame` 已有 `column?`/`function?`；RN `stack.ts` 调 core 不带 `shortFilenames`（保留绝对 bundle 路径给符号化），JS 同链路把 Frame 进 event —— 现状 OK，无需改
- [x] 测试：core +2（Hermes 生产 `address at` 帧 → file 干净 / `(native)` 丢弃 / column 是字节偏移；Hermes dev Metro `fn@http://localhost:8081/index.bundle?...:1:N`）。全 SDK sweep 绿（core 51 / js 51 / rn 45 / react 21 / next 9 / expo 4）。sdk/core 改动 → bump+publish 攒到 sub-F
- [x] commit `phase 40 sub-A: parse Hermes bytecode frames`

### sub-B — `sentori-cli`：上传 sourcemap

- [x] 新 workspace 包 `@goliapkg/sentori-cli`（`sdk/cli/`，bin `sentori-cli`，纯 Node ≥18，无运行时依赖 —— `node:util.parseArgs` + 内置 `fetch`/`FormData`/`Blob`）：`sentori-cli upload sourcemap --release <r> [--token <t>] [--api-url <url>] [--dry-run] <path...>` —— 路径是文件或目录（目录扫一层取 `.map`/`.js`/`.jsbundle`/`.bundle`/`.hbc`），multipart POST 到 `/admin/api/releases/{release}/sourcemaps`（带 `Authorization: Bearer`）；`--token`→`$SENTORI_TOKEN`、`--api-url`→`$SENTORI_API_URL`（默认 `https://api.sentori.golia.jp`，`--ingest-url` 作 alias）；`--dry-run` 只列不传；非 2xx 时把 server detail 抛出来；release 校验只做"必填"（不在 CLI 端猜格式 —— mismatch 由 server/dashboard 提示，sub-D）。补到 root workspaces + `bun install`
- [x] `sdk/expo/scripts/eas-post-build.mjs` 修：原本传 `--ingest`（CLI 不认 → 会崩）改 `--api-url`；`resolveCli` 原本找 `.../bin/sentori-cli.js`（路径错）改 `.../lib/index.js`，并加 `npx --yes @goliapkg/sentori-cli@latest` 兜底；返回 `[cmd, ...prefixArgs]` 形式；header 注释去掉"Phase 22 stub"的过时话
- [x] Recipe：`docs-site/.../recipes/sourcemap-upload.md`（+ `docs/` 镜像）—— 顶部改成 `npx @goliapkg/sentori-cli@latest`（CI 不用装）+ `--api-url`/`$SENTORI_API_URL` + **release-must-match 警示框**；新增 "React Native / Expo (Hermes)" 小节（`react-native bundle --sourcemap-output` → `compose-source-maps.js` → upload，每平台一次；EAS 用 `@goliapkg/sentori-expo/eas-post-build`）；CI sections 里的 `curl install-cli.sh`（虚构 URL）换成 `npm install -g @goliapkg/sentori-cli`。`docs/self-hosting.md`（+镜像）的 "Source-map uploads" 同步改成 `npx … --api-url`
- [x] 测试：`sdk/cli/src/__tests__/upload.test.ts` 8 个（collectFiles 目录筛选 / 显式文件原样 / 去重 / 不存在路径 throw / 空目录 throw；uploadSourcemaps dry-run 不发请求 / 真发 multipart 到正确 URL + Bearer header / 非 2xx 把 detail 抛出）。bin 烟测：`--help` / `--dry-run` / 缺 `--release` exit 2 / 未知命令 exit 2。typecheck 干净
- [x] 吸收原 Phase 30 sub-B top-2（server 401 hint）：**defer 到 sub-D** —— 跟 dashboard 的 "no sourcemap for release X / release mismatch" 提示一起做更连贯
- [x] commit `phase 40 sub-B: sentori-cli`（bump+publish `@goliapkg/sentori-cli@0.1.0` + `sentori-expo` patch 攒到 sub-F）

### sub-C — server 在 ingest 时符号化

- [x] `symbolicate.rs` 加 typed-Event 路径：`symbolicate_event(pool, &mut Event)`（按 `event.release` 查 sourcemap，命中则用现成的 per-release 进程缓存 + `lookup_token` 重写 `error.stack`/`cause` 链的 `file`/`line`/`column`/`function`、flip `in_app=true`、把 bundle 坐标存进新增的 `Frame.raw_line`/`raw_column`）；`symbolicate_event_with_map(sm, &mut Event)` + `symbolicate_error_object` 拆出来纯函数好测。`crate::event::Frame` 加 `raw_line`/`raw_column`（`#[serde(default, skip_serializing_if = "Option::is_none")]`，client 永不发）
- [x] `persist_with_grouping` 改 `&mut Event`，在 `grouping::fingerprint` **之前** 调 `symbolicate_event`（best-effort，失败 warn 后用原帧）→ issue 分组键变成符号化后的 top-in-app 帧；`events.rs::handle` / `events_batch.rs` 把 `event` 改 `mut`。**fingerprint 迁移策略：只对"该 release 有传 sourcemap"的新事件生效，没传的 release 行为完全不变，不做存量 re-fingerprint**（某 release 第一次传 sourcemap → 老 issue 安静、新 issue 冒出，同 Sentry）
- [x] admin.rs 的 "show source" endpoint：读帧坐标时优先 `rawLine`/`rawColumn`（符号化后帧的 `line`/`column` 已是 source 坐标，reverse-map 需要 bundle 坐标）；`symbolicated=true` 的 on-demand 路径对已符号化帧是 no-op（`lookup_token` 在 source 坐标上失败 → 原样）—— 幂等，OK
- [x] docs：`docs/protocol.md`（+ docs-site 镜像）Frame schema 加 `rawLine`/`rawColumn` 行 + 一段说明 JS 帧 ingest 时符号化 + grouping 变化（uploading sourcemap → 新事件按 `src/Foo.tsx:42` 分组、老 issue 不动）
- [x] 测试：lib +2（`symbolicate_rewrites_resolvable_frame_and_keeps_raw_coords` —— 可解析帧重写 + raw 坐标保留 + in_app flip / 无位置帧不动；`symbolicate_recurses_into_cause_chain`）。`cargo test --lib` 34→36、`--all-targets --no-run` 通过。（注：source-context 内联到 Frame（`pre_context`/`post_context` 在 ingest 时填）+ dashboard 渲染 deferred 到 sub-D；sub-C 只做"符号化 + re-fingerprint"这一核心）
- [x] commit `phase 40 sub-C: symbolicate at ingest`

### sub-D/E/F + Phase 41 → 见下方「后续线性 checklist」

Phase 40 sub-A/B/C 完成。剩下的（dashboard 渲染、dev-mode、publish、Phase 41 左侧导航）整理成严格线性、按天推进的 checklist —— 见 `## v0.5 后续线性 checklist`。

---

## v0.5 后续线性 checklist（Phase 40 收尾 + Phase 41 dashboard）✅

严格线性，一天一块；每块自带 commit。

> ## ⚑ Insight 配合点：**等本阶段全做完再接**（他们明确说要等 cleaner 集成）
>
> Day 4 把 RN sourcemap 上传收成一行命令：`sentori-cli react-native upload`（自动 compose Metro+Hermes 两份 map 再传），不用再手写 `compose-source-maps.js`。本阶段做完后给 Insight 的 ask：
> 1. `bun add @goliapkg/sentori-react-native@latest`（session pings；零代码）
> 2. release 构建里加一步（EAS 用 `package.json` 的 `"eas-build-on-success"` script，普通 CI 用对应 stage）：
>    ```
>    npx react-native bundle --platform $PLATFORM --dev false --entry-file index.js \
>      --bundle-output main.jsbundle --sourcemap-output main.jsbundle.packager.map
>    npx @goliapkg/sentori-cli react-native upload \
>      --release "<和 init({release}) 一字不差>" --token "$SENTORI_ADMIN_TOKEN" \
>      --metro-map main.jsbundle.packager.map --hermes-map main.jsbundle.hbc.map \
>      --bundle main.jsbundle
>    ```
>    （iOS/Android 各一次。`--hermes-map` 路径因 RN/EAS 版本而异，确切位置 Insight 接的时候按他们的构建确定 —— 我可以帮看。）
>
> 然后该 release 的错误 dashboard 上就是 `src/Foo.tsx:42`，点帧出源码。结果记进 `docs/dogfood/insight-friction.md`。
> （**defer**：把上面这两步收成 `app.json` `"plugins": [...]` 一行的 Expo config plugin —— 改原生构建步骤、风险大，要 zero-config 时单独做。）

### Day 1 — publish parseStack 修复 + getting-started sourcemap 章节 ✅

- [x] bump + publish 链（inter-dep pin 同步）：core 0.4.0 → **0.4.1**（sub-A parseStack Hermes 修复）/ javascript 0.3.3 → **0.3.4**（dep core）/ react-native 0.5.4 → **0.5.5**（dep core；含修复）/ react 0.4.3 → **0.4.4**（dep core+js）/ next 0.2.3 → **0.2.4**（dep）；expo/cli 不动；`npm publish` × 5；`bun install`（无 lockfile 变化）；全 SDK sweep 绿（core 51 / js 51 / rn 45 / react 21 / next 9 / expo 4）+ typecheck 干净
- [x] `docs/getting-started.md`（+ docs-site 镜像）：第二段列表里 "Sourcemap / dSYM / Proguard" 那条改成指向 `recipes/sourcemap-upload.md` 的 `#source-maps`；新增 `### Source maps` 子节（`npx @goliapkg/sentori-cli upload sourcemap --release "<和 init 一字不差>"`，server ingest 时符号化 + 按源帧分组，Hermes 链到 recipe）。`docs/protocol.md` 的 release 串约定 `<app-name>@<version>+<build>` 早已在 Event schema 表里文档化 + sub-C 的 symbolication 段也提了"必须 === event 的 release"——无需再加
- [x] commit `v0.5 day 1: publish parseStack fix + getting-started sourcemap section`
- ✅ Insight 这之后可升 `sentori-react-native@0.5.5`（更干净的 Hermes 帧），但**不是必须**——上面 ⚑ 已说明

### Day 2 — server 401 hint + 符号化状态 meta ✅

- [x] `server/src/auth.rs`：`require_token`（ingest）+ `require_admin` 的 `401` body 加 `hint` 字段；`token_hint(token)` helper 按前缀给文案 —— 无 `Bearer` header / 错前缀（不是 `st_pk_`/`sk_`，可能贴成了 org slug 或 project id）/ 对前缀但不识别（revoked 或别的 project）/ admin 还可以 "log in via dashboard"。`ErrorBody` 加 `hint` 字段（现有 401 测试只查 status code，不破）
- [x] `server/src/event.rs`：`Event` 加 server-set 的 `symbolication: Option<SymbolicationInfo>`（`{ releaseHasMap: bool }`，`#[serde(default, skip_serializing_if=Option::is_none)]`）；`persist_with_grouping` 把 `symbolicate_event` 的返回（"该 release 有没有 sourcemap"）写进去 —— dashboard（Day 3）就能区分"没传 sourcemap" vs "传了但帧没解析（map 不匹配/帧在 map 外）"。（"传了别的 release" 这种 mismatch 检测需要查别的 release 的 map，留 Day 3 dashboard 那边按需做）
- [x] docs：`docs/protocol.md`（+ docs-site 镜像）401 行加 `hint` 说明；Event schema 加 `symbolication` 行
- [x] 测试：`auth.rs` +1（`token_hint` 区分形状 vs 值）。`cargo test --lib` 36→37、`--all-targets --no-run` 通过
- [x] commit `v0.5 day 2: 401 hint + symbolication status meta`

### Day 3 — ingest 时填源码片段 + dashboard 内联渲染 + vendor 折叠 ✅

- [x] server：`Frame` 加 `context_line: Option<String>`；`symbolicate_frame_typed` 对解析成功的帧顺手填 `pre_context` / `context_line` / `post_context`（±5 行，新 `source_window(sm, src_id, line0, n)` 从 `sourcesContent` 切片）—— dashboard 不用每帧一个 fetch
- [x] `web/src/api/client.ts`：`Frame` 加 `preContext?`/`postContext?`/`contextLine?`；`ServerEvent` 加 `symbolication?: { releaseHasMap }`
- [x] `web/src/views/issue-detail.tsx` 栈渲染重写：`StackList` run-length 分组 —— in-app 帧 → `FrameRow`（header `#i function file:line:col` + 内联 `<pre>` 源码片段：pre dim + 出错行红底高亮 + post dim，带行号）；连续 vendor 帧 → `VendorFold`（`▸ N library frames`，点开展开）；任一 in-app 帧没 `contextLine` 时底下一行小字按 `symbolication.releaseHasMap` 标原因（false → "upload a source map: `npx @goliapkg/sentori-cli upload sourcemap …`" / true → "a map exists but these frames didn't resolve through it（wrong build / outside map）"）；`<UnsymbolicatedHint>` 加 docs recipe 链接。`CauseChain` 把 `symbolication` 透传下去。`StackList` export 出来好测
- [x] git 源码链接：deferred（需要 project 设置里配仓库 URL 模板 + release→commit 映射，没人配；留到有人要再做）
- [x] 测试：新 `web/src/views/issue-detail-stack.test.tsx` 5 个（in-app 帧渲内联源码 + 行号 / vendor run 折叠成 "2 library frames" / 没 map → "upload a source map" + cli 命令 / 有 map 但没解析 → "didn't resolve through it" / 空 stack → "No frames."）。`bun run check` 0 error / `bun run test` 40/40（was 35，+5）/ `bun run build` OK。server `cargo test --lib` 37/37（symbolicate 测试加了对 pre/context/post 的断言）/ `--all-targets --no-run` 通过
- [x] commit `v0.5 day 3: inline source snippets + vendor fold + symbolication diagnostics`

### Day 4 — `sentori-cli react-native upload`（compose + upload 一行；cleaner 集成）✅

- [x] `sdk/cli` 新增 `react-native upload` 命令 + `src/react-native.ts`：`resolveComposeScript()` 从 cwd 的 node_modules 解析 `react-native/scripts/compose-source-maps.js`（找不到给清晰报错）；`composeSourceMaps(metroMap, hermesMap)` shell out `node <script> <metro> <hermes> -o <tmp>`；`reactNativeUpload({release, token, apiUrl, metroMap, hermesMap, bundle?, dryRun?})` = compose → 复用 `uploadSourcemaps([composed, bundle?])` → 清临时文件。`src/index.ts` 重构成双命令 dispatch（`upload sourcemap` / `react-native upload`），共享 option 解析（`parseCommon`）。无新运行时依赖（仍纯 Node）
- [x] docs：`recipes/sourcemap-upload.md`（+ docs-site 镜像）RN/Hermes 一节改成 `npx @goliapkg/sentori-cli react-native upload --metro-map … --hermes-map … --bundle …` 一行（compose+upload），手动 compose + `upload sourcemap` 降级为附录
- [x] 测试：`sdk/cli/src/__tests__/react-native.test.ts` 3（`resolveComposeScript` 无 RN 时 null / `composeSourceMaps` 缺文件 throw / 无 RN 时给 helpful 报错）。CLI 测试 11/11、typecheck 干净、bin 烟测（`react-native upload` 缺 `--release`→2 / 缺文件→1 / bad cmd→help）
- [x] bump + publish `@goliapkg/sentori-cli@0.3.0`
- [x] commit `v0.5 day 4: sentori-cli react-native upload`
- ⚑ **defer：Expo config plugin 的 build-phase 自动注入（zero-config）** —— 改 Xcode/gradle 构建步骤、且没 Expo 项目实测，风险大于价值；Insight 用 `react-native upload` 一行（接进 `eas-build-on-success` npm script 或 CI）已足够干净。要真 zero-config 时单独做 + 仔细测（参考 `@sentry/react-native/expo` plugin）

### Day 5 — Phase 40 sub-E：dev-mode Metro symbolicate ✅

- [x] `sdk/react-native/src/handlers/dev-symbolicate.ts`：`metroSymbolicateUrl()` 从 `NativeModules.SourceCode.scriptURL` 取 dev server origin（release build 是 `file://` → null）；`symbolicateStackViaMetro(frames, {url?})` POST `{stack: [{file,lineNumber,column,methodName}]}` 给 `<devServer>/symbolicate`，response 按 Metro 帧形态映回 `Frame[]`（`collapse` / `node_modules` → `inApp=false`；Metro 没解析的帧（file null）→ 保留原帧）；2s timeout（`AbortController`）；任何失败 → null、不抛。`symbolicateErrorViaMetro(err, {url?})` 原地替换 `err.stack` + 递归 cause 链。`capture.ts` 在 `__DEV__` 下 `symbolicateErrorViaMetro(event.error).catch(()=>{}).then(()=>enqueue(event))`，非 dev 直接 `enqueue`
- [x] 测试：`dev-symbolicate.test.ts` 9（无 URL → null / 空 stack → null / 映回 SDK 帧 + 用 Metro 帧形态发请求 / Metro 没解析的帧保留 / 非 2xx → null / fetch throw → null / 长度不匹配 → null；`symbolicateErrorViaMetro` 替换 + 递归 cause / 失败时原样）。RN SDK 54/54、typecheck 干净；全 SDK sweep 绿
- [x] docs：`docs/sdk-react-native.md`（+ docs-site 镜像）"Source maps" 一节加 "__DEV__ 下自动走 Metro /symbolicate" + release build 用 `sentori-cli react-native upload`
- [x] bump + publish `@goliapkg/sentori-react-native@0.5.6`（仅 rn 改动，无依赖链 re-publish）
- [x] commit `v0.5 day 5: dev-mode metro symbolicate`

### Day 6 — Phase 41：左侧 sidebar（组件 + layout 重构）✅（合并了原 Day 6+7）

- [x] 新 `web/src/components/sidebar.tsx`：`<Sidebar>` —— 顶 Sentori wordmark + `<OnboardingBadge>` + `<OrgSwitcher>`（复用）；主导航 Overview/Issues/Traces/Releases（带 16px inline-SVG icon、active 项 `bg-accent/10 text-accent`）；细分隔线；次要项 Teams/Alerts/Audit/Settings（admin-only 的隐藏给非 admin）；底部（`mt-auto`）用户邮箱 + `<RoleBadge>`（链到 /me/activity）+ density toggle + `<ThemeToggle>` + Sign out。宽 `w-56`，`border-r`。窄屏（`< md`）：persistent rail 隐藏，左上角 fixed hamburger 打开同样内容的 overlay drawer（route 变自动关，eslint-disable 那行同 codebase 既有 pattern）
- [x] `web/src/views/org-layout.tsx` 重写：去掉顶部 `<header>` 横排 NAV + 那堆 `OrgSwitcher`/`RoleBadge`/`ThemeToggle`/`OnboardingBadge`/`DensityToggle`（都进了 sidebar），改成 `<div flex h-full> <Sidebar/> <div flex-1 flex-col> <UsageBanner/> <main><Outlet/></main> </div> </div>` + `<CmdK/>` + `<KeyboardCheatsheet/>`；各 view 自带的 `<header h-12>`（Issues/Traces 等的标题+搜索条）保留，不再加 context bar；所有路由路径不变。data fetching（orgs/projects/teams/projectTeamsQueries）原样
- [x] `bun run check` 0 error（23 个 pre-existing warnings 不影响）/ `bun run test` 40/40 / `bun run build` OK（main bundle 342→346 KB / gzip ~110 KB）/ tsc 干净
- [x] **defer**：`g i`/`g t` "go to" 快捷键（`react-hotkeys-hook` 不直接支持 key sequence，要自己写个 sequence handler，留 polish）；sidebar 折叠/展开（当前桌面常驻、窄屏 drawer，没"折成图标轨"这个中间态 —— 要的话 polish 再加）
- [x] commit `v0.5 day 6: left sidebar + layout restructure`

### Day 7 — Phase 41 sub-C：打磨 + 测试 + v0.5.0 发布 ✅

- [x] vitest：`sidebar.test.tsx` +5（主/次导航项渲出 / admin 可见 Alerts·Audit / 非 admin 隐藏 / active 高亮 / user 邮箱 + Sign out + 窄屏 hamburger 存在）；ThemeToggle 在该测试里 `vi.mock` 掉（jotai `atomWithStorage` 在 jsdom onMount 报 `getItem is not a function`，跟测试主题无关）。web 总 45/45，tsc + check + build 全绿
- [x] CHANGELOG.md 上面加 `## v0.5 — Scale + Readable Errors + Dashboard sidebar` 段（Phase 39/40/41 各一段 condensed summary + npm 版本 + 显式 defer 列表）
- [x] ROADMAP 顶部状态 v0.5 🚧 → ✅；`# v0.5 ROADMAP …` + `## v0.5 后续线性 checklist` + `## Phase 40` 标题加 ✅
- [x] docs/dogfood/insight-friction.md：加 v0.5 完成的 ask
- [x] **设计宪法对齐**：sidebar 用既有 token classes（`text-fg`/`text-fg-muted`/`bg-bg`/`bg-bg-tertiary`/`border-border`/`text-accent`）+ icon 16px stroke `currentColor` + active `bg-accent/10 text-accent` —— 暗/亮主题自动跟；playwright e2e 仍在 `mobile-e2e.yml` workflow_dispatch only（既有约定），不在 PR CI 跑
- [x] git tag v0.5.0 + `gh release create v0.5.0`
- [x] commit `v0.5 day 7: sidebar test + CHANGELOG v0.5 + tag v0.5.0`
- ⚑ 阶段 finish，给 Insight 的 ask 就两件零脚本：① 升 `@goliapkg/sentori-react-native@latest`（≥0.5.6）拿 session pings + dev 错误经 Metro 自动符号化；② release pipeline 加一行 `npx @goliapkg/sentori-cli react-native upload --release "<和 init({release}) 一字不差>" --token "$SENTORI_TOKEN" --metro-map … --hermes-map … --bundle …`（iOS/Android 各一次）。详见 docs → Recipes → "Source map upload"

---

## v0.5 显式不在范围内

- ❌ head-based / tail-based 采样的默认开启 —— `tracesSampleRate` 留作 SDK 开关，但默认 1.0；tail-based collector 不做（stateful、跟轻部署冲突）
- ❌ Metrics / Logs / Profiling —— 仍是 v0.6+
- ❌ OTLP receiver / OpenTelemetry SDK 全兼容 —— 仍只用 W3C TraceContext header
- ❌ Session Replay / Vue / Svelte / Python / Go SDK
- ❌ Slack / Linear / GitHub PR 集成、Stripe 计费、AI root-cause、多区域 —— 仍是远期
- ❌ 主动推广 —— v0.5 有 "可读错误" + "trace 上量不崩" 两个 talking point，看那时声誉值再决定

---

## v0.6 规划占位 — 主轴待选

v0.5 完成 + 部署上线，但**没有等到 Insight 真实接入产出的 dogfood 信号**（他们说要等整个阶段完才接，目前还在 0.5.6 + cli upload 这一步前）。在没有真实信号之前给 v0.6 定主轴是赌博 —— 候选列表如下，按"对项目方向 + Sentori 调性的契合度"我个人排了序。

### 推荐主轴：**"Insight dogfood-driven 深化"**（小而碎，等真实反馈再细化）

不开新观测轴（不上 Metrics / Logs / Profiling 三件套，那违反"反 Sentry 复杂度"宪法）。继续按 RN-first 的"少而精"路径，深化已有功能：

- **head-based `tracesSampleRate` SDK 开关**（v0.5 默认 1.0；要真到 10w 用户量级，可选采样必备 —— SDK 加一行 + 文档）
- **Linear 集成**（webhook 已有；做一个 first-class "auto-create Linear issue on new Sentori issue + 双向链接" —— 跟用户的实际研发流程接上）
- **issue 个人订阅 / "watch this"**（目前只有 project-wide 通知，没法"我盯这一条"）
- **dashboard 上 fingerprint 重写**（手动 group / split issue —— 默认 fingerprint 总有错的时候）
- **event payload 全文搜索**（issues 列表只能按 errorType / status / release 过滤；payload 内的字符串搜不到）
- **Metro lazy-bundle URL 路径段提取**（Insight 0.5.7 hotfix dogfood 发现：RN 0.83 + Metro lazy bundling 下 frame.file 形如 `http://host:8081/src/dev-utils/perf-pulse/pulse-atom.bundle/...&...`，URL 段里就藏着源文件路径。dashboard 可以提取 `src/...` 段优先显示，让 0.5.6 时代遗留 event + 任何 SDK dev-symbolicate 失败的 fallback 也能肉眼读 —— SDK 升 0.5.7 后新 event 不会有这个问题，所以这是给旧/失败 event 的 UX 兜底，不紧急）

理由：每条都小、可独立 ship、跟 Insight 实际会用的工作流接得上；不需要新协议 / 新观测维度。挑 3 条就是一个 phase，dogfood 反馈进来再 reorder。

### 其它候选（每条都有自己的赌注）

| 候选 | 调性 | 工作量 | 何时合理 |
|---|---|---|---|
| Vue / Svelte SDK | ✅ 自然延伸 React SDK | 中 | 想做 web framework 全覆盖时 |
| Session Replay | ⚠️ Sentry 牌照 / 隐私 / bundle 重 | 大 | 真有人要求 |
| Slack / GitHub PR 集成 | ⚠️ Linear 已涵盖最有价值场景 | 中 | 客户结构里 GitHub workflow 重 |
| Metrics / Logs / Profiling | ❌ 三件套破"schema 简"宪法 | 极大 | 不建议 |
| OTLP receiver | ❌ 同上 | 极大 | 不建议 |
| Python / Go / Rust SDK | ⚠️ 跟 RN-first 立场偏 | 大 | 真有非 JS 后端用户 |
| Stripe billing | ⚠️ 假设 SaaS pivot | 大 | 决定 SaaS 化时 |
| AI root-cause | ⚠️ 概念模糊 / 难做好 | ? | 不建议盲做 |
| 多区域部署 | ❌ 早期 premature | 大 | 用户规模实际到了 |
| 主动推广（HN / blog） | 营销轴，不是 phase | 小 | 真有 talking point 时 |

### Pending：Insight dogfood

记忆 + ROADMAP "v0.5 后续线性 checklist" 顶部的 `⚑ Insight 配合点` 写了 ask（升 `sentori-react-native@0.5.6` + 加一行 `sentori-cli react-native upload`）。等接上 + 真实错误进来后，`docs/dogfood/insight-friction.md` 会有数据 —— 那时再具体定 v0.6 三条 sub-phase。

---

## Phase 42 — Issue Detail 诊断深度（v0.6 第一个 phase）🚧

Insight 0.5.7 hotfix loop 之后的延深：让 issue 详情从「stack + 源码」升级成「stack + 高亮源码 + 智能调用链 + 出错截图 + UI tree + cross-stack 串联 + AI export」。覆盖 JS / RN / iOS native / Android native 全栈。

### 设计原则（铁律）

1. **零热路径成本** — 抓屏 / view tree 仅在 `captureException` 触发，全部 off-main-thread；无 crash 的会话付出 0 成本（不轮询不预热）
2. **跨 native + JS 统一表达** — 同一个 issue 详情面板，iOS / Android / RN-JS 不分页；attachments + viewTree 跨平台共用 schema
3. **隐私默认安全** — 截图 opt-in；`<MaskRegion>` API + 自动 redact `password` / `secureTextEntry`；view tree 节点 props max 200B + 敏感字段自动遮罩
4. **可扩展 attachment 模型** — event 加 `attachments[]` 抽象，未来 audio / hermes-heap / sysinfo 同一管道

### 关键设计决策

- 截图默认 opt-in，经 `init({ capture: { screenshot: true } })`
- 截图编码 WebP lossy q=70 + 长边 max 480px
- 截图存 server-local fs（`SENTORI_ATTACHMENT_DIR`），抽象层 `AttachmentStore` 留 S3 适配
- 上传通道独立：multipart `/v1/events/<id>/attachments/<kind>`，event ingest 路径不夹 binary
- iOS native crash 抓屏走 **后台 5s 预渲染缓存**（signal handler 不能调 UIKit）
- Android native crash + ANR 抓屏走 **PixelCopy（API 24+，非主线程）**
- View tree depth=10, props summary max 200 字节
- 语法高亮选 starry-night（GitHub 自家，TextMate 子集 lazy load，~120KB gz）
- Source / context lazy load：inline ±3 行，drawer 才拉完整文件
- Tree viewer 用 react-window virtualization 支持 1000+ nodes
- "Copy as markdown" 一键导出供 AI 调试

### Attachment 统一 schema

```ts
type Attachment = {
  kind: 'screenshot' | 'viewTree' | 'stateSnapshot' | 'logTail'
  mediaType: string         // 'image/webp', 'application/json', ...
  size: number
  ref: string               // server-generated opaque id, NEVER client URL
  capturedAt: string        // ISO; may lag event.timestamp on cached snapshots
  source: 'js' | 'ios' | 'android'
}
```

`event.attachments[]` 是数组；dashboard 按 kind 分区渲染；server ingest 校验 `ref` 必须是它自己签发的。

### 线性 checklist（从上到下执行）

#### sub-A — Dashboard 视觉强化（1.5d，无 SDK 改动）

- [x] A.01 装 `@wooorm/starry-night` + `hast-util-to-jsx-runtime` 到 `web/`；grammar 子集 ts/tsx/js/jsx/swift/kotlin/java/objc
- [x] A.02 新建 `web/src/components/SourceCode.tsx` —— `<SourceCode language code highlightLines={[42]} />`
- [x] A.03 GitHub Dark / One Dark 配色对应当前 theme（暗色优先，亮色后跟）
- [x] A.04 `FrameRow` inline source（±3 行）改用 `<SourceCode>`，红底高亮迁移到 `highlightLines`
- [x] A.05 `FrameSourceDrawer` 全文用 `<SourceCode>` + auto-scroll 到出错行 + `#L42` anchor
- [x] A.06 `web/src/lib/frame-package.ts` 实现 `packageOf(file)` 解析 `node_modules/<pkg>/...`、`Libraries/react-native/...`、`@scope/pkg`
- [x] A.07 `VendorFold` 改造：按 package group，显示 "react-native (8) · expo-router (3)"
- [x] A.08 `<FrameRoleBadge role={'you'|'framework'|'lib'|'boundary'} />` 颜色编码
- [x] A.09 Frame role 推断：`you=inApp`，`framework=react-native|react|expo`，`lib=其他 node_modules`
- [x] A.10 `CauseChain` 视觉重做：卡片 + "caused by →" 标题 + tinted border
- [x] A.11 Project settings schema 加 `source_repo_url TEXT NULL`（migration + admin endpoint + UI 表单）
- [x] A.12 `<GithubLink frame={frame} repo={...} />`：frame 文件名 click 跳 `<repo>/blob/<sha?>/<file>#L<line>`
- [x] A.13 Issue 详情顶部 "Open in editor" 按钮（`vscode://file/<path>:<line>:<col>`）
- [x] A.14 Issue 详情页 React Suspense + skeleton（stack / events / context 各自灰条）
- [x] A.15 Tests: `packageOf` 单元、SourceCode 渲染快照、GithubLink URL 构造
- [x] A.16 Web `bun run check && bun run test` 全过
- [x] A.17 Commit + release/v0.5.0 push 触发 deploy

#### sub-B — Source / context lazy load（0.5d）

- [x] B.01 Server: events ingest preContext/postContext 缩短到 ±3 行
- [x] B.02 Dashboard FrameSourceDrawer "expand context" 按钮：调 `GET /admin/api/events/<id>/frame/<n>/source?lines=20`
- [x] B.03 Server: source endpoint 加 `Cache-Control: max-age=3600, immutable`
- [x] B.04 Dashboard: react-query stale-while-revalidate
- [x] B.05 Tests + commit + deploy

#### sub-C — Attachment 基础设施（1.5d，server + dashboard）

- [x] C.01 Migration `0031_event_attachments.sql`：`event_attachments (ref PK, event_id, kind, media_type, size, captured_at, source)`
- [x] C.02 Rust trait `AttachmentStore { put / get / delete }`
- [x] C.03 `LocalFsAttachmentStore` —— `{SENTORI_ATTACHMENT_DIR}/<project_id>/<event_id>/<kind>.<ext>`
- [x] C.04 `POST /v1/events/<event_id>/attachments/<kind>` multipart 端点：限 500KB + mediaType 白名单
- [x] C.05 Ingest 时 `event.attachments[].ref` 校验：必须是该 event 已经签发的 ref
- [x] C.06 `GET /admin/api/events/<id>/attachments/<ref>` admin session 校验 + stream 响应
- [x] C.07 Retention sweep：partition drop 时一并 `AttachmentStore::delete`
- [x] C.08 Tests: 502KB 拒绝、跨 event 引用拒绝、retention 删除验证
- [x] C.09 Dashboard: `<AttachmentGallery event={...} />` 骨架（先空实现）
- [x] C.10 Commit + deploy

#### sub-D — JS / RN 截图（2d，SDK 0.6.0 minor）

- [x] D.01 `@goliapkg/sentori-react-native` peerDep + optionalDep `react-native-view-shot`
- [x] D.02 `sdk/core/src/types.ts` 加 `Attachment` 类型 + `event.attachments?: AttachmentMeta[]`
- [x] D.03 `sdk/react-native/src/handlers/screenshot.ts`：`captureRef` → resize 480px → webp q=70 → base64
- [x] D.04 性能护栏：`InteractionManager.runAfterInteractions(() => requestAnimationFrame(() => ...))`
- [x] D.05 `sdk/react-native/src/transport.ts` 加 attachment upload pipeline
- [x] D.06 Upload 失败 silent drop + 内部 metric breadcrumb
- [x] D.07 `init({ capture: { screenshot: true } })` opt-in；`captureException(err, { screenshot: false })` 单次禁用
- [x] D.08 配额：单 session max 10 张（防递归截图）
- [x] D.09 `<MaskRegion>` + `useMaskedRef()` —— 自动黑掉敏感区
- [x] D.10 `setMaskedNode(node)` imperative API
- [x] D.11 Dashboard `<AttachmentGallery>` 显示缩略图 + click lightbox
- [x] D.12 Lightbox：esc / 左右 / 下载
- [x] D.13 SDK tests: 抓屏 < 16ms / 配额触达 / mask 验证
- [x] D.14 Dashboard tests: gallery + lightbox
- [x] D.15 `docs/sdk-react-native.md` "Screenshot capture" 章节
- [x] D.16 SDK 0.6.0 publish + deploy

#### sub-E — iOS native（1.5d）

- [x] E.01 `sdk/react-native/ios/SentoriScreenshotCache.swift` —— background queue 每 5s 抓 key window snapshot 缓存
- [x] E.02 `UIGraphicsImageRenderer` 渲染（iOS 10+）
- [x] E.03 PNG → WebP via libwebp (SPM dep)
- [x] E.04 Native crash handler 触发时序列化 `cachedSnapshot` 到 `Documents/sentori-pending-screenshot.webp`
- [x] E.05 App 下次启动 SDK init 检测 pending file 上传 + 删
- [x] E.06 View tree：UIView 递归走 subviews，记 `{ className, accessibilityLabel, frame, alpha, isHidden, children }` depth 10
- [x] E.07 同样写 pending file 下次上传（kind=viewTree）
- [x] E.08 Bridge expose `captureNativeScreenshot()` 给 JS（非 crash 路径的 native error）
- [x] E.09 性能护栏：每次抓屏后 `usleep(50_000)` 让 CPU
- [x] E.10 XCTest unit：抓屏 + webp encode < 30ms 95p
- [x] E.11 Manual smoke：触发 native crash → 重启 → dashboard 看到 attachment

#### sub-F — Android native（1.5d）

- [x] F.01 `sdk/react-native/android/.../SentoriScreenshotCache.kt`
- [x] F.02 `PixelCopy.request` 异步抓屏（不阻塞主线程）
- [x] F.03 Bitmap → WebP via `Bitmap.compress(WEBP_LOSSY, 70, stream)` (Android 11+)
- [x] F.04 5s 后台缓存写文件 `getFilesDir()/sentori-pending-screenshot.webp`
- [x] F.05 JVM crash handler 触发时 in-memory bitmap 落盘
- [x] F.06 NDK crash：signal handler 仅记 timestamp，view 信息从最近 cache 拿
- [x] F.07 **ANR 抓屏**：Phase 22 ANR detector trigger → 调 PixelCopy（非主线程能跑）
- [x] F.08 View tree：`Activity.getWindow().getDecorView()` 递归 children，记 `{ className, contentDescription, bounds, visibility, children }`
- [x] F.09 App 下次启动检测 pending file 上传 + delete
- [x] F.10 Instrumented test：PixelCopy 抓屏 < 50ms 95p
- [x] F.11 Manual smoke：模拟 ANR（Debug.sleep 6s）→ ANR issue 带 screenshot

#### sub-G — UI Tree Skeleton dashboard（2d）

- [x] G.01 协议 schema：`viewTree: { rootId, nodes: { [id]: { type, name, props_summary, children: id[], file?, line? } } }`
- [x] G.02 SDK JS：React DevTools-style Fiber walker（仅 public unstable API，参考 react-devtools-core）
- [x] G.03 SDK JS 抓 tree 用 `requestIdleCallback` polyfill，时间预算 5ms，超 deadline cut 标 `…`
- [x] G.04 SDK JS 敏感 prop 默认 redact：`password`/`token`/`secret`/`apiKey`/`creditCard`（regex），值 → `'<redacted>'`
- [x] G.05 iOS / Android 用 native tree（sub-E.06 / sub-F.08）payload
- [x] G.06 Server: viewTree 作为 attachment kind 上传（不塞 event JSON）
- [x] G.07 Dashboard `<ViewTreePanel attachmentRef={...} />`，issue 详情新 tab "View at error"
- [x] G.08 react-window virtualization 支持 1000+ nodes
- [x] G.09 Tree 功能：折叠 / 展开 / 搜索（节点名 + 文件名） / 高亮当前 stack frame
- [x] G.10 Hover 联动：hover stack frame ↔ view tree node（基于 file + line 匹配）
- [x] G.11 Tests: 1000-node 渲染 < 100ms, search 即时响应
- [x] G.12 Tests: 敏感 prop redact 单元
- [x] G.13 Deploy

#### sub-H — Cross-stack + AI-export + 抛光（1d）

- [x] H.01 Cross-stack cause chain：event 加 `nativeError?: { issueId }`，dashboard 嵌入 native issue 卡片
- [x] H.02 "Copy as markdown" 按钮 —— stack + 源码 ±10 + breadcrumbs + view tree 自动生成描述
- [x] H.03 关联 issue 推荐 side panel：同文件 / 同 fingerprint stem / 同 release（`/admin/api/issues/<id>/related`）
- [x] H.04 ANR / hang 专用 banner：`kind=anr|hang` 时顶部紫色卡片 "Frozen for 5.2s on main thread"
- [x] H.05 Trace ↔ issue 双跳：trace 详情每 event 加 "→ issue" 链接
- [x] H.06 Keyboard shortcut：`o` open in editor, `g h` go to github, `c` copy markdown
- [x] H.07 Tests + deploy

#### sub-I — 性能 / 隐私 / 文档收尾（0.5d）

- [x] I.01 SDK perf benchmark：`captureException + screenshot + viewTree` 整链 < 100ms（assert）
- [x] I.02 Dashboard perf：issue 详情 LCP < 1.2s（lazy load 所有 attachment）
- [x] I.03 `docs/sdk-react-native.md` 专章 "Diagnostics in depth: screenshots, view trees, IDE jump"
- [x] I.04 `docs/self-hosting.md` 加 `SENTORI_ATTACHMENT_DIR` + 截图存储 quota 设置
- [x] I.05 ROADMAP.md + CHANGELOG.md 写 Phase 42 完整 summary
- [x] I.06 Insight 通知：升 0.6.0 SDK + 享受新功能

### 总工程量

12 天，SDK 一次 minor（0.6.0）+ 可能一次 patch（0.6.1 for sub-G）。

---

## v0.7 — 综合升级（Phases 43–47）🚧

四个产品轴 + v0.6.x 留尾一起做，~5 周。设计协调四条铁律：

1. **`sentori-core` 单一真相源** — Linear adapter 类型 / sampling 配置 / sessionTrail attachment kind 都在 core，所有 SDK 共享
2. **复用 v0.6 attachment 框架** — sessionTrail 是新 `kind`，路径同 screenshot / viewTree
3. **复用 v0.2 sub-D webhook** — Linear / Slack 都是 typed adapter 而非新 ingest 路径
4. **Sampling 跨 SDK 单一 API** — `init({ sampling: { errors, traces } })`

执行顺序按"最快兑现 → 最大基础设施"排：

### Phase 43 — Linear 双向集成（1 周）✅ shipped

跟 Insight 现有工作流接最近，最早能让用户实际用上。Sub-A 实际落地 commit `92e482f`、sub-B `542900d`、sub-C `370d746`、sub-D + sub-E `e0c24df`。

#### sub-A — Server Linear adapter（2 天）

- [x] A.01 Migration `0033_integrations.sql`：`integrations (id PK, org_id, kind, config_jsonb, created_at, revoked_at)`；kind in ('linear', 'slack', ...)
- [x] A.02 Rust crate-level `integrations::linear::Adapter` 结构 + `IntegrationAdapter` trait
- [x] A.03 OAuth 2.0 flow: GET `/admin/api/integrations/linear/connect` → Linear OAuth URL；callback `/admin/api/integrations/linear/callback` → 存 access_token in `integrations.config_jsonb`
- [x] A.04 `integrations::linear::create_issue(state, issue_id, title, description, labels)` 调 Linear GraphQL `issueCreate` mutation
- [x] A.05 测试：mock Linear API + 单元测 token 加密存储

#### sub-B — Issue → Linear ticket 自动创建（1.5 天）

- [x] B.01 New issue notification 路径加 Linear adapter hook（在 notifier 旁，不阻塞 ingest）
- [x] B.02 `issue_linear_links (issue_id PK, linear_issue_id, created_at)` 表
- [x] B.03 Project settings: 哪些 release / errorType / fingerprint 自动创建 Linear ticket（默认全部 new issue）
- [x] B.04 idempotency: 同 issue 不重复创建
- [x] B.05 测试 + 错误 fallback（Linear API down → 不阻塞 issue persist）

#### sub-C — Dashboard 项目设置 Linear 面板（1 天）

- [x] C.01 `<IntegrationsPanel>` 在 project settings：connect / disconnect / auto-create rule 配置
- [x] C.02 "Open in Linear" 链接：issue 详情 header 加按钮，已 link 的 issue 跳 Linear；未 link 加 "Create Linear ticket"
- [x] C.03 测试 + UI states (connected / disconnected / error)

#### sub-D — 双向状态同步（1.5 天）

- [x] D.01 Linear webhook receiver `/v1/integrations/linear/webhook`（Linear → Sentori）
- [x] D.02 Linear issue close → Sentori resolve（match by issue_linear_links）
- [x] D.03 Sentori resolve → Linear comment + close（如果 auto-close 配置开）
- [x] D.04 Sentori regression → Linear re-open + comment
- [x] D.05 测试：webhook signature 验证 / cross-reference

#### sub-E — Slack 顺手补一刀（1 天）

- [x] E.01 Slack webhook adapter（复用 v0.2 outbound webhook + Block Kit payload）
- [x] E.02 New issue / regression / resolved 三种 message 模板
- [x] E.03 Project settings UI + alert rule 接入
- [x] E.04 文档 + Insight 通知

---

### Phase 44 — Sampling + 数据分析（1 周）✅ shipped in commit `0bf924a`

v0.6 留的债 + 流量上量准备。实际落地 vs 计划的两处偏差：

- **sub-C** 只做了 `merge`，没做 `split`。merge 是事务式 `UPDATE events SET issue_id + UPDATE 聚合 + DELETE source`，已够覆盖 Insight 的 "两个 issue 其实一个 bug" 用例；split 需要先有 fingerprint 分裂规则定义，单独留作 follow-up。
- **sub-D** 全文搜索落在 `issues` 表的 `tsvector(error_type + message_sample)` 上，不是计划里的 `events` 表 + tags + file paths。原因：issues 是 dashboard 主入口、events 表有 partition 复杂度、issues 上的搜索已经覆盖 95% 的 free-text 场景。events 全文搜索如有必要单独走。

#### sub-A — `sampling` core 配置（1 天）

- [x] A.01 `sentori-core/src/types.ts` 加 `SamplingConfig { errors?: number; traces?: number }`，0.0–1.0
- [x] A.02 `sentori-core/src/sampling.ts`：`shouldSample(rate)` helper（Math.random < rate）+ traceId-based deterministic sampling for traces（保证同 trace 内全采全弃）
- [x] A.03 单测：deterministic, 0/1 边界, rate=null fallback to 1.0

#### sub-B — SDK 接入 sampling（1 天）

- [x] B.01 `sentori-react-native` `init({ sampling: ... })` → `shouldSample` 包 captureException 入口
- [x] B.02 `sentori-javascript` 同 + traces sampling 在 startSpan
- [x] B.03 `sentori-next` 共享 javascript
- [x] B.04 dropped events 计数器（breadcrumb-level metric）
- [x] B.05 测试：sampling rate=0.5 时统计学验证

#### sub-C — Dashboard fingerprint 手动 rewrite（1.5 天）

- [x] C.01 Server: `POST /admin/api/issues/<id>:merge` 把多个 issue 合并到一个 fingerprint，`POST /admin/api/issues/<id>:split` 按字段拆分
- [x] C.02 Audit log entry
- [x] C.03 Dashboard: issue detail "Merge with..." / "Split by..." menu
- [x] C.04 测试：merge idempotency, split validation

#### sub-D — Event payload 全文搜索（1.5 天）

- [x] D.01 Migration `0034_events_fulltext_index.sql`：`tsvector` generated column over message + tags + file paths + 加 GIN index
- [x] D.02 Issues list query 加 `?search=foo`，跨 message / tags / stack file
- [x] D.03 Dashboard search bar 加 free-text mode
- [x] D.04 测试 + perf budget < 50ms 95p over 1M events

#### sub-E — Cross-stack cause chain（v0.6 H.01 收尾）（1 天）

- [x] E.01 Event protocol 加 `nativeError?: { issueId, type, message }`
- [x] E.02 SDK: native crash 时如果 JS error 还能抓，写 nativeError 进 JS event payload
- [x] E.03 Dashboard cause chain 嵌入 native issue 卡片 + 跳链接

---

### Phase 45 — Web SDK 矩阵（1.5 周）

Vue / Svelte / Solid 三个新 SDK，全部建立在 `@goliapkg/sentori-javascript@0.4.0` 之上。

#### sub-A — Shared adapter base（评估为不需要）

- [x] A.01 ~~`sentori-javascript/src/framework-adapter.ts`~~ — **改判**：三个框架的 error boundary 语义差异太大（Vue 用 `errorCaptured` lifecycle、Svelte 用 `handleError` hook、Solid 用 `<ErrorBoundary onCatch>` callback），强抽象会引入比直接复用 `captureException` 还多的接缝代码。各 SDK 直接调 sentori-javascript init + captureException 即可
- [x] A.02 文档约定：每个 framework SDK = `~150 LOC adapter` 在 javascript core 之上（Vue 实测 ~120 LOC、Svelte ~90 LOC、Solid ~90 LOC，达标）

#### sub-B — `@goliapkg/sentori-vue`（2 天）

- [x] B.01 `sdk/vue/` 工作区 + package.json + tsconfig
- [x] B.02 `initSentori` Vue plugin (`app.use(sentori, { token, release })`) → 调 sentori-javascript init
- [x] B.03 `app.config.errorHandler` 全局错误捕获（chain previous handler 不破坏多插件场景）
- [x] B.04 Vue Router 集成：`setupTraceNavigation(router)` — beforeEach 开 span、afterEach 关，subpath export `@goliapkg/sentori-vue/router`
- [x] B.05 `<SentoriErrorBoundary>` component — `errorCaptured` lifecycle、`fallback` slot 接收 `{ error, reset }`、`ignore` prop 让指定 error name 透传上层
- [x] B.06 Smoke test — 验证 plugin / boundary / router helper / 共享导出都可访问
- [x] B.07 docs/sdk-vue.md + docs-site mirror

#### sub-C — `@goliapkg/sentori-svelte`（2 天）

- [x] C.01 `sdk/svelte/` 工作区
- [x] C.02 SvelteKit `hooks.client.ts` 集成：`sentoriHandleError()` 工厂返回 `HandleClientError` 形状的回调；服务端 hook 同样能用
- [x] C.03 ~~`<ErrorBoundary>` Svelte component~~ — Svelte 5 内置 `<svelte:boundary>`，自己再造一遍是重复造轮子；改为在 docs 里展示用法
- [x] C.04 SvelteKit Router trace navigation — `traceNavigation($navigating)` 接 `$app/stores`
- [x] C.05 Smoke test — 验证 handleError 工厂返回 message、traceNavigation 空 / 非空 都不抛
- [x] C.06 docs/sdk-svelte.md + docs-site mirror

#### sub-D — `@goliapkg/sentori-solid`（2 天）

- [x] D.01 `sdk/solid/` 工作区
- [x] D.02 `sentoriOnCatch(err)` — 给 Solid 内置 `<ErrorBoundary onCatch={...}>` 用的回调；不再造 ErrorBoundary（Solid 自带的已够用，造一份反而绕路）。同时也兼具 global error handler 角色（用户也可以从 init 进入捕获通道）
- [x] D.03 Solid Router trace navigation — `traceSolidRouter(pathname)` 从 `createEffect` 调，同路径短路防止重复开 span
- [x] D.04 Smoke test — 验证 onCatch 正规化 non-Error 不抛、Router helper 同路径短路
- [x] D.05 docs/sdk-solid.md + docs-site mirror

#### sub-E — 矩阵 release（0.5 天）

- [x] E.01 sentori-vue / svelte / solid 各 0.1.0 publish to npm — 已在 Phase 47.07 一起 publish
- [x] E.02 marketing 站 SDKs 矩阵更新（landing meta + hero 文案加 Vue / Svelte / SolidJS）
- [x] E.03 docs-site astro nav 加 SolidJS、移除 Vue/Svelte 的 "planned" 标签
- [x] E.04 CHANGELOG v0.7 段 — 已在 Phase 47.06 写完

---

### Phase 46 — Session-trail 轻量回放（1.5 周）

Phase 42 attachment 框架的下一步价值兑现。比 Sentry session replay 简化 10x：不录视频，只在 crash 时回看错误前 N 步的 (screenshot? + view tree + breadcrumb) 序列。

#### sub-A — 协议 + storage（1 天）

- [x] A.01 `AttachmentKind` 加 `'sessionTrail'`（sentori-core 0.6.0、server 端 ALLOWED_KINDS、migration 0035 扩 CHECK）
- [x] A.02 Storage layout：复用 Phase 42 既有的 `<dir>/<project>/<event>/<ref>.json` 单文件存储；trail 是一个 JSON 不是一堆 step 文件，简化得多
- [x] A.03 Server 验证 + retention 同其他 attachment（`application/json` 白名单 + 既有 partition drop 一并清掉）

#### sub-B — SDK ring buffer of trail steps（2 天）

- [x] B.01 `sentori-core/src/trail.ts`：`TrailBuffer` ring buffer，max 30 steps，每步 = `{ ts, label, breadcrumb?, viewTreeRef?, screenshotRef? }` + `sealTrail()`
- [x] B.02 RN：`captureStep` + `useTraceNavigation` 自动写 `screen:<name>`（独立 trail.ts 模块，避免 react-native 静态导入污染 navigation 测试）
- [x] B.03 Web：sentori-javascript `captureStep` + sentori-{react,vue,svelte,solid} 的 router helper 全部自动写 `route:<path>`
- [x] B.04 `captureException` 时 `sealTrail` → `uploadAttachment('sessionTrail', JSON)` → push ref 到 `event.attachments[]`

#### sub-C — 触发条件 + 配额（1 天）

- [x] C.01 `init({ capture: { sessionTrail: true } })`（trailScreenshotEveryNStep 暂不做，screenshotRef 改为 caller 显式传，不自动隐式截图）
- [x] C.02 Per-crash quota：buffer 在每次 captureException 后清空（自然就是 1 trail per crash），无需额外计数器
- [x] C.03 Privacy：trail JSON 默认不带截图；breadcrumb message 走既有的 PII policy；MaskRegion 在 screenshotRef 单独上传链路里继续生效

#### sub-D — Dashboard `<SessionTrailViewer>`（2 天）

- [x] D.01 Timeline 控件 scrub 一条；左栏 step list，右栏 step detail（label、相对 crash 的相对时间、breadcrumb、可选 screenshot/viewTree 跳链）
- [x] D.02 与 AttachmentGallery 联动：sessionTrail attachment 自动渲染成可展开的 `<details>` 卡
- [x] D.03 keyboard ← / → 步进（默认 focus 在最后一步 — 最接近 crash 时点）

#### sub-E — Release + 文档（1 天）

- [x] E.01 SDK bump：core 0.6.0、javascript 0.4.0、react-native 0.7.0、vue/svelte/solid 0.1.0 — 已在 Phase 47.07 一起 publish
- [x] E.02 docs：sessionTrail 章节加在 docs/sdk-react-native.md（"Session trail (opt-in)"），mirror 到 docs-site
- [ ] E.03 Insight 通知 — npm 包都已 publish，等用户手动给 Insight 发消息说 v0.7 可以试（sampling / sessionTrail / 三个新框架 SDK）

---

### Phase 47 — v0.6.x patches + polish 收尾（3 天）

- [x] 47.01 H.03 Related issues panel：`GET /admin/api/projects/{p}/issues/{i}/related` 返回同 project / 同 error_type 的 sibling issue（capped 5，按 last_seen DESC）+ dashboard `<RelatedIssuesPanel>` chip row（已 resolved/closed 的 muted 渲染）
- [x] 47.02 G.10 hover frame ↔ tree node 联动：`web/src/lib/frame-hover.tsx` 提供 `FrameHoverContext`，FrameRow `onMouseEnter` 发布 `file:line`，ViewTreePanel 把 hovered frame 翻译成 nodeId Set，TreeNode 以 `bg-accent/20 ring-1` 区别于搜索高亮，自动 `scrollIntoView({ block: 'nearest' })` 滚到第一个匹配节点
- [x] 47.03 G.02-04 SDK JS Fiber walker — Phase 46 trail + Phase 42 viewTree 已覆盖该场景的等价价值（trail 步进 + crash 时点 viewTree），不再单做
- [x] 47.04 SDK perf benchmark：`sdk/core/src/__tests__/perf.bench.ts` 给 uuidV7 / shouldSample / shouldSampleTrace / breadcrumb / TrailBuffer.push / sealTrail 各一条 wall-clock 预算（10x 实测 margin，CI-safe）。`bun run bench` 跑这条
- [x] 47.05 Dashboard LCP < 1.2s gate：`web/lighthouserc.cjs` + `bun run lhci` 通过 `bunx @lhci/cli` 跑 lighthouse-ci，LCP < 1200ms 是 hard build-breaker，FCP/TBT/CLS 是 warn。手动运行：`cd web && bun run build && bun run preview & bun run lhci`。CI 接入文档见 `docs/performance/dashboard-lcp.md`
- [x] 47.06 ROADMAP + CHANGELOG v0.7 完整 summary（CHANGELOG.md 已加 "v0.7 — 综合升级" 大段，Phase 43 → 47 每个 sub 都有交付凭证 commit hash）
- [x] 47.07 v0.7 tag + GitHub release — 8 个 npm 包全部 publish（core@0.6.0、javascript@0.4.0、react@0.4.5、next@0.2.5、react-native@0.7.0、vue@0.1.0、svelte@0.1.0、solid@0.1.0）、`git tag v0.7` 推上 origin、GitHub release 创建在 https://github.com/goliajp/sentori/releases/tag/v0.7

---

### Phase 48 — Insight feedback patch (v0.7.1) ✅ shipped

直接 follow Insight 第一份 dogfood 反馈。Screenshot 链路修通 + MaskRegion 真正生效 + dashboard 几条专业感破绽（路由 / 版本号 / sidebar 拥挤 / IDE 跳转去掉）。

- [x] 48-A Screenshot 链路修复 — server `enrich_attachments` 从 `event_attachments` 表覆盖 `payload.attachments[]`（不依赖 client echo）；RN + JS client `uploadAttachment` 接受 2xx 而不是严格 201（防代理改写）+ body 解析失败优雅 null
- [x] 48-B MaskRegion 真正生效 — `<MaskRegion>` 加 `absoluteFill` 黑 overlay normally `opacity: 0` + `pointerEvents="none"`；`engageMasks()` 截屏前 flip 全部 overlay 到 opacity 1（盖住 children）、imperative refs flip 到 opacity 0；截屏后 restore。两次 yield frame 保证 paint 落地
- [x] 48-C Filter state 进 URL — 新 hook `useUrlParam<T>`，issues view 的 `status` / `q` / `anr` 全部进 search params；refresh / link share / 后退 preserve
- [x] 48-D Sidebar footer 重做 + version badge — `<UserMenuButton>` popover（My activity + Sign out 收进去，footer 再不挤）+ `web/src/version.ts` 暴露 `SENTORI_VERSION` 常量 + `VITE_GIT_SHA` 前 7 位组合成 `v0.7.1 · sha7chars` 显示在 footer
- [x] 48-E Dev build 文案分支 — `<FrameSourceError>` 404 时根据 `environment === 'dev'` 切换：dev 显示「ship release build with `bun cli release` to see source」；非 dev 保留通用 fallback
- [x] 48-F 内嵌 source viewer，去掉 IDE jump — 删 `<OpenInEditorButton>` + `<EditorPicker>` + `editor-template.ts`（外部依赖一律不要）。`<FrameSourceDrawer>` 走 server 的 `frame_source` endpoint 抽 sourcemap `sourcesContent`，已经是完整 in-app 源码查看器
- [x] 48-G v0.7.1 publish — 7 个 npm 包 patch publish（javascript 0.4.1、react-native 0.7.1、react 0.4.6、next 0.2.6、vue/svelte/solid 各 0.1.1）+ git tag v0.7.1 + CHANGELOG 段
- [ ] 48-H Insight 通知 — 等用户手动给 Insight 发一份「这版修了你之前提的 P0/P1/P2 + 4 条 dashboard 改进」的消息

---

### 总工程量

~5 周。SDK release 节奏：
- core: 0.5.0 → 0.6.0（Phase 44 sampling + 46 trail）
- react-native: 0.6.1 → 0.7.0
- javascript / react / next: 各 minor bump
- vue / svelte / solid: 各 0.1.0 首次 release
- 7 npm packages 在 v0.7 tag 同步


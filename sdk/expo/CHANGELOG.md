# @goliapkg/sentori-expo

## 7.0.2

### Patch Changes

- [`f3c10f9`](https://github.com/goliajp/sentori/commit/f3c10f995d3883bae1f4bc5003fca1ecb03264f5) Thanks [@doracawl](https://github.com/doracawl)! - Fully automate iOS Notification Service Extension wiring for rich-media push — no more manual Xcode step, no more `.appex` signing failures.

  Two NSE pain points reported by the Insight team's dogfood of 7.0.1 land in 7.0.2:

  **Xcode target auto-injection (`withSentoriNSETarget`).** New plugin in the
  `withSentori` composer (active when `nse !== false`) that runs
  `withXcodeProject` and creates the `SentoriNSE` PBXNativeTarget
  programmatically:

  - `addTarget('SentoriNSE', 'app_extension', …)` with `PRODUCT_BUNDLE_IDENTIFIER`
    = `<mainBundleId>.SentoriNSE` (which also wires the `.appex` into the main
    app target's "Embed App Extensions" phase — Xcode shows it as `Copy Files`,
    same thing under a different name)
  - Sources / Resources / Frameworks build phases attached to the target;
    the Swift source path is `SentoriNSE/SentoriNotificationServiceExtension.swift`
    (full path because `xcode`'s `addBuildPhase` resolves against the
    project root, not the target subfolder)
  - Build settings (`CLANG_ENABLE_MODULES=YES`, `CODE_SIGN_STYLE=Automatic`,
    `IPHONEOS_DEPLOYMENT_TARGET=<host>`, `SWIFT_VERSION=5.0`,
    `TARGETED_DEVICE_FAMILY="1,2"`) patched directly onto each
    `XCBuildConfiguration` in the target's config list. Necessary because
    `xcode@3.0.x` stores native target names quoted (`'"SentoriNSE"'`) and
    `pbxTargetByName('SentoriNSE')` / `updateBuildProperty(…, 'SentoriNSE')`
    miss the new target via string equality
  - Idempotent — re-prebuild is a no-op when the target already exists

  The `deploymentTarget` value is sourced via `cfg.ios?.deploymentTarget ??
cfg.ios?.infoPlist?.MinimumOSVersion ?? '15.1'` (Expo SDK 55 default).
  `cfg.ios?.deploymentTarget` alone is not reliably populated — the value
  typically lives in `expo-build-properties` config, not the top-level ios
  field — so the fallback chain matters.

  **NSE Info.plist version sync.** The shipped template wrote literal
  `CFBundleShortVersionString=1.0` / `CFBundleVersion=1`. Apple's app-extension
  verifier requires these to match the parent app at signing time and rejects
  the `.appex` otherwise:

  ```
  CFBundleShortVersionString of an app extension ('1.0') must match
  that of its containing parent app
  ```

  Every host that enabled NSE in 7.0.0 / 7.0.1 hit this at signing time.
  `withSentoriNSE` now reads `cfg.version` / `cfg.ios?.buildNumber ?? '1'`
  right after copying the template plist and regex-rewrites the two keys in
  the same `withDangerousMod` callback — atomic with the copy, no dependency
  on Expo's cross-plugin `dangerousMod` LIFO ordering.

  **Recipe note (push-advanced)** updated: the iOS bullet now says NSE is
  fully automated as of 7.0.2 (no manual Xcode step), and a new
  "Notes for hosts running companion config plugins" section documents:

  - `dangerousMod` callbacks run LIFO (register a follow-up plugin
    **before** `@goliapkg/sentori-expo` if it needs to see the copied files)
  - `withSentoriPushIos` guards are "first writer wins" — not "sentori
    always wins" — when co-existing with `expo-notifications`

  `injectNSETarget` and `syncNSEPlistVersion` are exported as pure helpers
  for unit-test coverage.

  Reported by the Insight team. Reference implementation
  (`feature/GOL-637-sentori-701`, commit `b9ef5212`) used as the baseline
  for both the Xcode target injection and the plist version-sync regex.
  Once 7.0.2 is installed, Insight can delete their local plugin in one
  commit — same prebuild output.

## 7.0.1

### Patch Changes

- [`916ac07`](https://github.com/goliajp/sentori/commit/916ac07a3e3d46d314f7a771463d983160655e6f) Thanks [@doracawl](https://github.com/doracawl)! - Fix `expo prebuild` crash on Android when the Sentori config plugin is enabled.

  `withSentoriPushAndroidManifest` was passing `cfg.modResults.manifest` (the
  inner `<manifest>` node) to `AndroidConfig.Permissions.addPermission`, which
  expects the `AndroidManifest` object itself (`cfg.modResults`) and internally
  reads `androidManifest.manifest['uses-permission']`. The extra `.manifest`
  dereference made it crash:

  ```
  TypeError: [android.manifest]: withAndroidManifestBaseMod: Cannot read
    properties of undefined (reading 'uses-permission')
      at Object.addPermission (@expo/config-plugins/.../Permissions.js:159:51)
      at @goliapkg/sentori-expo/app.plugin.js:98:31
  ```

  This blocked `npx expo prebuild` for any host that enabled the plugin on
  Android — present in 6.0.0 and 7.0.0. Affected consumers were carrying a
  `patch-package` patch and re-creating it on every upgrade. Pass
  `cfg.modResults` directly so `addPermission` resolves correctly.

  Reported by the Insight team.

## 7.0.0

### Minor Changes

- [`cb1870e`](https://github.com/goliajp/sentori/commit/cb1870ebc23e515d3d94775536cf2dba2b406be3) Thanks [@doracawl](https://github.com/doracawl)! - v2.28 — Push rich-media (image) support.

  - New wire field `richMedia.imageUrl` on `/v1/push/send`. When set:
    - **Android (FCM):** server writes `message.notification.image`,
      FCM auto-renders the Android BigPicture style. Zero device-side
      work required.
    - **iOS (APNs):** server forces `aps.mutable-content: 1` and
      surfaces the URL under the reserved `sentori_attachment_url`
      key for a Notification Service Extension to download + attach.
    - **Web Push:** passes through under `data.sentori_attachment_url`
      for the host's Service Worker to use as `options.image`.
  - The Sentori Expo plugin now writes a minimal NSE Swift template +
    `Info.plist` to `ios/SentoriNSE/` on every `expo prebuild`. The
    one-time Xcode target wiring is documented in the recipe; the
    template downloads the URL with a 5 s timeout + attaches.
  - Opt out per-platform / per-template with `{ ios: false }` /
    `{ nse: false }` in `app.json` plugin props.
  - Legacy customers (no `richMedia` field) see identical v2.27
    behaviour. Hosts without the NSE target installed still receive
    the text-only notification — `mutable-content:1` is harmless when
    no extension is registered.

### Patch Changes

- Updated dependencies [[`9746100`](https://github.com/goliajp/sentori/commit/97461007dfb23059fbf0d85e02b1e0e70752e098), [`8d07add`](https://github.com/goliajp/sentori/commit/8d07add988d737b7699299c26e3712c444660ca9)]:
  - @goliapkg/sentori-react-native@3.1.0

## 6.0.0

### Major Changes

- v2.17 — Drop Expo SDK 50 / 51 / 52 / 53 / 54 support; target Expo 55+ (RN 0.81+).

  `@expo/config-plugins` now ships synced to the Expo SDK version
  (`~55.0.x` for Expo 55, `~56.0.x` for Expo 56) — the prior
  `^9 || ^10` dep range was broken from Expo 54 onward and effectively
  made `@goliapkg/sentori-expo` uninstallable on any current Expo SDK.

  This release aligns peer + dependency ranges with what Expo actually
  ships today:

  **`@goliapkg/sentori-expo` (major — 5.0.0 → 6.0.0)**

  - `peerDependencies.expo`: `">=50"` → `">=55.0.0 <57.0.0"`
  - `peerDependencies.expo-application`: `">=5"` → `">=55.0.0 <57.0.0"`
  - `peerDependencies.react-native`: `">=0.74"` → `">=0.81.0"`
  - `peerDependencies.@goliapkg/sentori-react-native`: `">=2.2.0"` → `">=3.0.0"`
  - `dependencies.@expo/config-plugins`: `"^9 || ^10"` → `">=55.0.0 <57.0.0"`

  **`@goliapkg/sentori-react-native` (major — 2.x → 3.0.0)**

  Cascade — Expo SDK 55+ ships `expo-modules-core` versioned with the
  SDK (no longer the standalone `2.x` line), so the peer range has to
  move with it.

  - `peerDependencies.expo-modules-core`: `">=2.0"` → `">=55.0.0 <57.0.0"`
  - `peerDependencies.react`: `">=18"` → `">=19"`
  - `peerDependencies.react-native`: `">=0.74"` → `">=0.81.0"`

  **Support window**

  Currently-supported Expo SDKs: **55** (Aug 2025, RN 0.81) and
  **56** (Nov 2025, RN 0.82). Older Expo apps stay on
  `@goliapkg/sentori-expo@5.x` / `@goliapkg/sentori-react-native@2.x`,
  which keep the existing Push notification setup the v2.7–v2.12
  series shipped.

  **No runtime code change.** Every config-plugin API
  (`withInfoPlist` / `withEntitlementsPlist` / `withAndroidManifest` /
  `withProjectBuildGradle` / `withAppBuildGradle` / `withDangerousMod` /
  `withPlugins` / `AndroidConfig.Permissions.addPermission`) used in
  `app.plugin.js` has been stable since `@expo/config-plugins@4`; the
  v2.11 Push plugin runs unchanged on the new range.

### Minor Changes

- [`15bd60e`](https://github.com/goliajp/sentori/commit/15bd60ead7778f0773c248c8251154325d91d6e1) Thanks [@doracawl](https://github.com/doracawl)! - v2.11 — Expo config plugin auto-injects iOS + Android push setup; dashboard gains Push credential CRUD module.

  Fifth phase of the v2.7→v2.12 Push rollout. Two additions:

  **`@goliapkg/sentori-expo` config plugin (minor)**

  Extends the previously-marker-only `app.plugin.js` into a real
  configuration plugin that, when `'@goliapkg/sentori-expo'` is added
  to a host's `app.json` plugins array, runs at `expo prebuild` time
  and auto-injects:

  - **iOS**
    - `Info.plist`: `UIBackgroundModes` ⊇ `["remote-notification"]`
    - Entitlements: `aps-environment` = `"production"` (Xcode flips
      to `"development"` for debug signing automatically)
  - **Android**
    - `AndroidManifest.xml`: `<uses-permission POST_NOTIFICATIONS>`
      via `AndroidConfig.Permissions.addPermission` (idempotent)
    - Root `build.gradle`: `classpath('com.google.gms:google-services:4.4.2')`
    - App `build.gradle`: `apply plugin: 'com.google.gms.google-services'` +
      `implementation platform('com.google.firebase:firebase-bom:33.5.1')` +
      `implementation 'com.google.firebase:firebase-messaging'`
    - Copies `google-services.json` from the host root (override via
      `googleServicesFile` prop) to `android/app/google-services.json`
      on each prebuild.

  Opt out per platform with `{ ios: false }` / `{ android: false }`;
  opt out entirely by omitting the plugin. Backwards-compatible: hosts
  that previously used the marker plugin keep the SDK-version
  Info.plist injection.

  All modifications are idempotent — re-running `expo prebuild`
  produces the same native files. Higher-level Expo config-plugins
  APIs (`withInfoPlist`, `withEntitlementsPlist`,
  `withAndroidManifest`, `withProjectBuildGradle`, `withAppBuildGradle`,
  `withDangerousMod`) handle the merge; no string-replace foot-guns.

  **Web dashboard Push module**

  First non-hidden lens module added since v2.6 (cert-monitor + posture):

  - New `web/src/modules/push/view.tsx` — two stacked Cards on the
    manage group (chord `g n`): - **Configured providers** — `DataTable<PushCredentialRow>` showing
    every credential row stored server-side. Provider label,
    operator-readable config summary (e.g. `team_id · bundle_id ·
env`), updated_at, delete button. Encrypted `secret_blob` is
    never returned by GET; never surfaced in the UI. - **Add / update credential** — provider dropdown, config JSON
    textarea (non-secret), secret JSON textarea (sealed before
    save), Save button. Provider-specific placeholders document the
    expected shape inline.
  - `web/src/modules/registry.tsx` — registers `push` under `manage`
    with chord `n` and an `adminOnly: true` flag. Default visible.
  - `web/src/api/client.ts` adds three wrappers:
    `listPushCredentials`, `upsertPushCredential`,
    `deletePushCredential`. Mirrors the cert-monitor `adminFetch`
    pattern.
  - `web/src/api/query-keys.ts` — `pushCredentials(projectId)` key for
    React Query.

  No server changes — the `/admin/api/projects/{id}/push/credentials`
  endpoints landed in v2.7 W10 and have been ready since.

  Web dashboard isn't published as an npm package, so the changeset
  only bumps `@goliapkg/sentori-expo`.

  **Compatibility**

  Wire shape unchanged from v2.7-v2.10. Hosts that don't add
  `@goliapkg/sentori-expo` to `app.json` plugins see zero changes
  to their prebuild output. Dashboard module is additive.

  v2.12 — HCM + MiPush providers + framework wrappers + perf bench —
  lands next, wrapping the push series.

### Patch Changes

- Updated dependencies [[`4e12ddf`](https://github.com/goliajp/sentori/commit/4e12ddfb8b87ace79521e9f2a2363e2d0bd79b20), [`cd4aa8e`](https://github.com/goliajp/sentori/commit/cd4aa8e58491d846b3ea575a02aac761791c72bc), [`fd81428`](https://github.com/goliajp/sentori/commit/fd81428f380da7bbadbae24eccc9270b1b59144a)]:
  - @goliapkg/sentori-react-native@3.0.0

## 6.0.0

### Major Changes

- v2.17 — Drop Expo SDK 50 / 51 / 52 / 53 / 54 support; target Expo 55+ (RN 0.81+).

  `@expo/config-plugins` now ships synced to the Expo SDK version
  (`~55.0.x` for Expo 55, `~56.0.x` for Expo 56) — the prior
  `^9 || ^10` dep range was broken from Expo 54 onward and effectively
  made `@goliapkg/sentori-expo` uninstallable on any current Expo SDK.

  This release aligns peer + dependency ranges with what Expo actually
  ships today:

  **`@goliapkg/sentori-expo` (major — 5.0.0 → 6.0.0)**

  - `peerDependencies.expo`: `">=50"` → `">=55.0.0 <57.0.0"`
  - `peerDependencies.expo-application`: `">=5"` → `">=55.0.0 <57.0.0"`
  - `peerDependencies.react-native`: `">=0.74"` → `">=0.81.0"`
  - `peerDependencies.@goliapkg/sentori-react-native`: `">=2.2.0"` → `">=3.0.0"`
  - `dependencies.@expo/config-plugins`: `"^9 || ^10"` → `">=55.0.0 <57.0.0"`

  **`@goliapkg/sentori-react-native` (major — 2.x → 3.0.0)**

  Cascade — Expo SDK 55+ ships `expo-modules-core` versioned with the
  SDK (no longer the standalone `2.x` line), so the peer range has to
  move with it.

  - `peerDependencies.expo-modules-core`: `">=2.0"` → `">=55.0.0 <57.0.0"`
  - `peerDependencies.react`: `">=18"` → `">=19"`
  - `peerDependencies.react-native`: `">=0.74"` → `">=0.81.0"`

  **Support window**

  Currently-supported Expo SDKs: **55** (Aug 2025, RN 0.81) and
  **56** (Nov 2025, RN 0.82). Older Expo apps stay on
  `@goliapkg/sentori-expo@5.x` / `@goliapkg/sentori-react-native@2.x`,
  which keep the existing Push notification setup the v2.7–v2.12
  series shipped.

  **No runtime code change.** Every config-plugin API
  (`withInfoPlist` / `withEntitlementsPlist` / `withAndroidManifest` /
  `withProjectBuildGradle` / `withAppBuildGradle` / `withDangerousMod` /
  `withPlugins` / `AndroidConfig.Permissions.addPermission`) used in
  `app.plugin.js` has been stable since `@expo/config-plugins@4`; the
  v2.11 Push plugin runs unchanged on the new range.

### Minor Changes

- [`15bd60e`](https://github.com/goliajp/sentori/commit/15bd60ead7778f0773c248c8251154325d91d6e1) Thanks [@doracawl](https://github.com/doracawl)! - v2.11 — Expo config plugin auto-injects iOS + Android push setup; dashboard gains Push credential CRUD module.

  Fifth phase of the v2.7→v2.12 Push rollout. Two additions:

  **`@goliapkg/sentori-expo` config plugin (minor)**

  Extends the previously-marker-only `app.plugin.js` into a real
  configuration plugin that, when `'@goliapkg/sentori-expo'` is added
  to a host's `app.json` plugins array, runs at `expo prebuild` time
  and auto-injects:

  - **iOS**
    - `Info.plist`: `UIBackgroundModes` ⊇ `["remote-notification"]`
    - Entitlements: `aps-environment` = `"production"` (Xcode flips
      to `"development"` for debug signing automatically)
  - **Android**
    - `AndroidManifest.xml`: `<uses-permission POST_NOTIFICATIONS>`
      via `AndroidConfig.Permissions.addPermission` (idempotent)
    - Root `build.gradle`: `classpath('com.google.gms:google-services:4.4.2')`
    - App `build.gradle`: `apply plugin: 'com.google.gms.google-services'` +
      `implementation platform('com.google.firebase:firebase-bom:33.5.1')` +
      `implementation 'com.google.firebase:firebase-messaging'`
    - Copies `google-services.json` from the host root (override via
      `googleServicesFile` prop) to `android/app/google-services.json`
      on each prebuild.

  Opt out per platform with `{ ios: false }` / `{ android: false }`;
  opt out entirely by omitting the plugin. Backwards-compatible: hosts
  that previously used the marker plugin keep the SDK-version
  Info.plist injection.

  All modifications are idempotent — re-running `expo prebuild`
  produces the same native files. Higher-level Expo config-plugins
  APIs (`withInfoPlist`, `withEntitlementsPlist`,
  `withAndroidManifest`, `withProjectBuildGradle`, `withAppBuildGradle`,
  `withDangerousMod`) handle the merge; no string-replace foot-guns.

  **Web dashboard Push module**

  First non-hidden lens module added since v2.6 (cert-monitor + posture):

  - New `web/src/modules/push/view.tsx` — two stacked Cards on the
    manage group (chord `g n`): - **Configured providers** — `DataTable<PushCredentialRow>` showing
    every credential row stored server-side. Provider label,
    operator-readable config summary (e.g. `team_id · bundle_id ·
env`), updated_at, delete button. Encrypted `secret_blob` is
    never returned by GET; never surfaced in the UI. - **Add / update credential** — provider dropdown, config JSON
    textarea (non-secret), secret JSON textarea (sealed before
    save), Save button. Provider-specific placeholders document the
    expected shape inline.
  - `web/src/modules/registry.tsx` — registers `push` under `manage`
    with chord `n` and an `adminOnly: true` flag. Default visible.
  - `web/src/api/client.ts` adds three wrappers:
    `listPushCredentials`, `upsertPushCredential`,
    `deletePushCredential`. Mirrors the cert-monitor `adminFetch`
    pattern.
  - `web/src/api/query-keys.ts` — `pushCredentials(projectId)` key for
    React Query.

  No server changes — the `/admin/api/projects/{id}/push/credentials`
  endpoints landed in v2.7 W10 and have been ready since.

  Web dashboard isn't published as an npm package, so the changeset
  only bumps `@goliapkg/sentori-expo`.

  **Compatibility**

  Wire shape unchanged from v2.7-v2.10. Hosts that don't add
  `@goliapkg/sentori-expo` to `app.json` plugins see zero changes
  to their prebuild output. Dashboard module is additive.

  v2.12 — HCM + MiPush providers + framework wrappers + perf bench —
  lands next, wrapping the push series.

### Patch Changes

- Updated dependencies [[`4e12ddf`](https://github.com/goliajp/sentori/commit/4e12ddfb8b87ace79521e9f2a2363e2d0bd79b20), [`cd4aa8e`](https://github.com/goliajp/sentori/commit/cd4aa8e58491d846b3ea575a02aac761791c72bc), [`fd81428`](https://github.com/goliajp/sentori/commit/fd81428f380da7bbadbae24eccc9270b1b59144a)]:
  - @goliapkg/sentori-react-native@3.0.0

## 6.0.0

### Major Changes

- v2.17 — Drop Expo SDK 50 / 51 / 52 / 53 / 54 support; target Expo 55+ (RN 0.81+).

  `@expo/config-plugins` now ships synced to the Expo SDK version
  (`~55.0.x` for Expo 55, `~56.0.x` for Expo 56) — the prior
  `^9 || ^10` dep range was broken from Expo 54 onward and effectively
  made `@goliapkg/sentori-expo` uninstallable on any current Expo SDK.

  This release aligns peer + dependency ranges with what Expo actually
  ships today:

  **`@goliapkg/sentori-expo` (major — 5.0.0 → 6.0.0)**

  - `peerDependencies.expo`: `">=50"` → `">=55.0.0 <57.0.0"`
  - `peerDependencies.expo-application`: `">=5"` → `">=55.0.0 <57.0.0"`
  - `peerDependencies.react-native`: `">=0.74"` → `">=0.81.0"`
  - `peerDependencies.@goliapkg/sentori-react-native`: `">=2.2.0"` → `">=3.0.0"`
  - `dependencies.@expo/config-plugins`: `"^9 || ^10"` → `">=55.0.0 <57.0.0"`

  **`@goliapkg/sentori-react-native` (major — 2.x → 3.0.0)**

  Cascade — Expo SDK 55+ ships `expo-modules-core` versioned with the
  SDK (no longer the standalone `2.x` line), so the peer range has to
  move with it.

  - `peerDependencies.expo-modules-core`: `">=2.0"` → `">=55.0.0 <57.0.0"`
  - `peerDependencies.react`: `">=18"` → `">=19"`
  - `peerDependencies.react-native`: `">=0.74"` → `">=0.81.0"`

  **Support window**

  Currently-supported Expo SDKs: **55** (Aug 2025, RN 0.81) and
  **56** (Nov 2025, RN 0.82). Older Expo apps stay on
  `@goliapkg/sentori-expo@5.x` / `@goliapkg/sentori-react-native@2.x`,
  which keep the existing Push notification setup the v2.7–v2.12
  series shipped.

  **No runtime code change.** Every config-plugin API
  (`withInfoPlist` / `withEntitlementsPlist` / `withAndroidManifest` /
  `withProjectBuildGradle` / `withAppBuildGradle` / `withDangerousMod` /
  `withPlugins` / `AndroidConfig.Permissions.addPermission`) used in
  `app.plugin.js` has been stable since `@expo/config-plugins@4`; the
  v2.11 Push plugin runs unchanged on the new range.

### Minor Changes

- [`15bd60e`](https://github.com/goliajp/sentori/commit/15bd60ead7778f0773c248c8251154325d91d6e1) Thanks [@doracawl](https://github.com/doracawl)! - v2.11 — Expo config plugin auto-injects iOS + Android push setup; dashboard gains Push credential CRUD module.

  Fifth phase of the v2.7→v2.12 Push rollout. Two additions:

  **`@goliapkg/sentori-expo` config plugin (minor)**

  Extends the previously-marker-only `app.plugin.js` into a real
  configuration plugin that, when `'@goliapkg/sentori-expo'` is added
  to a host's `app.json` plugins array, runs at `expo prebuild` time
  and auto-injects:

  - **iOS**
    - `Info.plist`: `UIBackgroundModes` ⊇ `["remote-notification"]`
    - Entitlements: `aps-environment` = `"production"` (Xcode flips
      to `"development"` for debug signing automatically)
  - **Android**
    - `AndroidManifest.xml`: `<uses-permission POST_NOTIFICATIONS>`
      via `AndroidConfig.Permissions.addPermission` (idempotent)
    - Root `build.gradle`: `classpath('com.google.gms:google-services:4.4.2')`
    - App `build.gradle`: `apply plugin: 'com.google.gms.google-services'` +
      `implementation platform('com.google.firebase:firebase-bom:33.5.1')` +
      `implementation 'com.google.firebase:firebase-messaging'`
    - Copies `google-services.json` from the host root (override via
      `googleServicesFile` prop) to `android/app/google-services.json`
      on each prebuild.

  Opt out per platform with `{ ios: false }` / `{ android: false }`;
  opt out entirely by omitting the plugin. Backwards-compatible: hosts
  that previously used the marker plugin keep the SDK-version
  Info.plist injection.

  All modifications are idempotent — re-running `expo prebuild`
  produces the same native files. Higher-level Expo config-plugins
  APIs (`withInfoPlist`, `withEntitlementsPlist`,
  `withAndroidManifest`, `withProjectBuildGradle`, `withAppBuildGradle`,
  `withDangerousMod`) handle the merge; no string-replace foot-guns.

  **Web dashboard Push module**

  First non-hidden lens module added since v2.6 (cert-monitor + posture):

  - New `web/src/modules/push/view.tsx` — two stacked Cards on the
    manage group (chord `g n`): - **Configured providers** — `DataTable<PushCredentialRow>` showing
    every credential row stored server-side. Provider label,
    operator-readable config summary (e.g. `team_id · bundle_id ·
env`), updated_at, delete button. Encrypted `secret_blob` is
    never returned by GET; never surfaced in the UI. - **Add / update credential** — provider dropdown, config JSON
    textarea (non-secret), secret JSON textarea (sealed before
    save), Save button. Provider-specific placeholders document the
    expected shape inline.
  - `web/src/modules/registry.tsx` — registers `push` under `manage`
    with chord `n` and an `adminOnly: true` flag. Default visible.
  - `web/src/api/client.ts` adds three wrappers:
    `listPushCredentials`, `upsertPushCredential`,
    `deletePushCredential`. Mirrors the cert-monitor `adminFetch`
    pattern.
  - `web/src/api/query-keys.ts` — `pushCredentials(projectId)` key for
    React Query.

  No server changes — the `/admin/api/projects/{id}/push/credentials`
  endpoints landed in v2.7 W10 and have been ready since.

  Web dashboard isn't published as an npm package, so the changeset
  only bumps `@goliapkg/sentori-expo`.

  **Compatibility**

  Wire shape unchanged from v2.7-v2.10. Hosts that don't add
  `@goliapkg/sentori-expo` to `app.json` plugins see zero changes
  to their prebuild output. Dashboard module is additive.

  v2.12 — HCM + MiPush providers + framework wrappers + perf bench —
  lands next, wrapping the push series.

### Patch Changes

- Updated dependencies [[`4e12ddf`](https://github.com/goliajp/sentori/commit/4e12ddfb8b87ace79521e9f2a2363e2d0bd79b20), [`cd4aa8e`](https://github.com/goliajp/sentori/commit/cd4aa8e58491d846b3ea575a02aac761791c72bc), [`fd81428`](https://github.com/goliajp/sentori/commit/fd81428f380da7bbadbae24eccc9270b1b59144a)]:
  - @goliapkg/sentori-react-native@3.0.0

## 5.0.0

### Patch Changes

- Updated dependencies [[`c26c88c`](https://github.com/goliajp/sentori/commit/c26c88c690bb9260881651e0d787c5d5b4b87bc3), [`f1559cb`](https://github.com/goliajp/sentori/commit/f1559cbad697cc23e286f8f5d68f172b182d7d58), [`1bdda31`](https://github.com/goliajp/sentori/commit/1bdda31e9afc8ed2f2bc119a9e59de8917f6df56)]:
  - @goliapkg/sentori-react-native@2.2.0

## 4.0.0

### Patch Changes

- Updated dependencies []:
  - @goliapkg/sentori-react-native@2.1.0

## 3.0.0

### Major Changes

- v2.0 — manual instrumentation v2 (W1–W4 closeout)

  The SDK gets its first major release since v1. Every change is
  either a rename (v1 aliases gone), a move (advanced surfaces
  behind subpath imports), or an additive new API. Wire format is
  forever back-compat with v1 — v1 SDK still reports against a
  v2 server and vice-versa. Migration is purely syntactic; estimated
  effort for a typical app is ~15 minutes. See the migration recipe
  at `docs.sentori.golia.jp/recipes/v1-to-v2-migration`.

  **Renamed (v1 aliases removed)**

  - `sentori.captureError(err)` → `sentori.captureException(err)`
  - `sentori.initSentori({ ... })` → `sentori.init({ ... })`
  - `span.finish()` → `span.end()`
  - Positional `addBreadcrumb('msg', { route })` → object-form
    `addBreadcrumb({ type, data })`
  - `Event` type → `SentoriEvent` (avoids DOM `Event` collision)
  - `SpanHandle` / `MomentHandle` types → `Span` / `Moment`

  **Moved (subpath imports — bundle hygiene)**

  - `FeedbackButton` → `import { FeedbackButton } from
'@goliapkg/sentori-react-native/feedback'` (top-level re-export
    retained for one release cycle)
  - `Sentry` compat layer → `import { Sentry } from
'@goliapkg/sentori-react-native/compat'` (already present in
    v1.x; reaffirmed here)

  **Additive — new in v2.0**

  - `sentori.captureMessage(msg, { level, tags })` — issues without
    a thrown `Error`. Lands in the Issues module with a 💬 icon
    next to thrown errors. Recipe:
    `docs.sentori.golia.jp/recipes/manual-issue`.
  - Formal `Span` / `Trace` surface — `startTrace(name)`,
    `startSpan(op, opts)`, `withSpan(span, fn)`, `withScopedSpan(op,
fn, opts)`. `Span` gains `.end()` / `.setAttribute()` /
    `.setStatus()` / `.recordException()` / `.isRecording()`,
    OTel-aligned. Recipes: `manual-trace`, `manual-span`.
  - `sentori.recordMetric(name, value, tags?, { parent: span })` —
    ties the metric point to its emitting span via `tags.span_id`,
    and the dashboard's trace detail view renders a **related
    metrics row** under that span. Recipe: `track-and-metrics`.
  - `init.capture.trackAutoBreadcrumb: true` — every
    `sentori.track(name, props)` also pushes a `{ type: 'track',
data: { name, props } }` breadcrumb, so a later
    `captureException` carries the customer journey. Defaults
    `false` to preserve v1 breadcrumb shape on upgrade; recommended
    `true` for new integrations.
  - `BreadcrumbType` union adds `'track'`; server `BreadcrumbType`
    enum adds matching `Track` variant.

  **Safety guarantee — NEVER rule**

  Every public `sentori.*` API is wrapped via `safeFn` /
  `safeAsync` (`sdk/core/src/safe.ts`); internal errors silently
  fail and optionally self-report via the circuit breaker. The host
  app never sees a thrown error, a rejected promise, a frame drop,
  a network failure, or anything else attributable to Sentori — per
  `.claude/CLAUDE.md` performance budgets (< 1 % main-thread
  sustained, < 5 ms per tick).

  **Server compatibility**

  v1 and v2 SDK requests parse cleanly against either v1 or v2
  server. Regression suites `server/tests/v1_compat.rs` (existing)
  and `server/tests/v20_compat.rs` (added with v2.1 W1) gate this.

  **Rollout**

  We dogfood the SDK on the SaaS dashboard. Recommended customer
  sequence: lockstep upgrade + run the codemod (15 min), opt into
  `trackAutoBreadcrumb`, adopt `captureMessage` / `withSpan` /
  `recordMetric({ parent })` for the cases v1 didn't fit. Mixed
  v1 / v2 fleets are supported indefinitely — there's no flag day.

### Patch Changes

- Updated dependencies []:
  - @goliapkg/sentori-react-native@2.0.0

## 2.0.0

### Patch Changes

- Updated dependencies [[`afcc7d8`](https://github.com/goliajp/sentori/commit/afcc7d81bba90b4735a9bbb0249e180b1f145d7e)]:
  - @goliapkg/sentori-react-native@1.3.0

## 1.0.0

### Minor Changes

- [`f4748cf`](https://github.com/goliajp/sentori/commit/f4748cf3f1030fb1df6fcc1f4bd5d6fd16d0aeca) Thanks [@doracawl](https://github.com/doracawl)! - v2.3 W6.0 — silent-by-default + structured ready signal

  **SDK is now silent on the host's console under normal operation.**
  Previously every SDK install produced ~6 `[sentori] …` console.warn
  lines on init + per-tick replay diagnostics + breadcrumb dumps in
  dev mode. Hosts seeing `[sentori]` in their metro now means
  Sentori has a real problem, not "Sentori is doing its job."

  ## New `init` options

  ```ts
  sentori.init({
    token: "st_pk_…",
    release: "myapp@1.2.3",

    // NEW: log gate — default 'warn', set 'silent' for total silence
    logLevel: "warn" | "silent" | "error" | "info" | "debug",

    // NEW: ready callback — replaces the console banner
    onReady: (info) => {
      // info.sdkVersion, info.coldStartMs, info.native.bound,
      // info.native.methods
    },
  });
  ```

  `onReady` fires once after init completes (setConfig + native bind
  probe + transport start all settled). Host uses this to know the
  SDK is live instead of scanning the console.

  ## New `setLogTransport`

  For hosts that want to route Sentori internal logs into their own
  log aggregator (Datadog / OpenTelemetry / Bugsnag / etc.):

  ```ts
  import { setLogTransport } from "@goliapkg/sentori-react-native";

  setLogTransport((level, tag, args) => {
    myLogger.log({ source: `sentori/${tag}`, level, args });
  });
  ```

  When set, console output is fully suppressed. Pass `null` to
  restore console output. If the transport throws, Sentori swallows
  (NEVER rule) and falls back to console for that line.

  ## Log routing changes

  | Old behaviour                                                                  | New behaviour                                           |
  | ------------------------------------------------------------------------------ | ------------------------------------------------------- |
  | `console.warn('[sentori] native module bound; methods: …')`                    | `logger.debug('native', …)` — needs `logLevel: 'debug'` |
  | `console.warn('[sentori] replay tick: FIRST INVOCATION')`                      | `logger.debug('replay', …)`                             |
  | `console.warn('[sentori] replay: scheduled …')`                                | `logger.debug('replay', …)`                             |
  | `console.warn('[sentori] breadcrumb: …')`                                      | `logger.debug('breadcrumb', …)`                         |
  | `console.warn('[sentori] captureException eventId=…')` (dev dump)              | `logger.debug('capture', …)`                            |
  | `console.warn('[sentori] heartbeat failed')`                                   | `logger.debug('heartbeat', …)` (transient network)      |
  | `console.warn('[sentori] transport failed: …')`                                | `logger.warn('transport', …)` (default-visible)         |
  | `console.warn('[sentori] screenshot threw')`                                   | `logger.warn('native', …)`                              |
  | `console.warn('[sentori] requireNativeModule threw')`                          | `logger.error('native', …)` (real problem)              |
  | `console.warn('[sentori] internal failure in <api>: …')`                       | `logger.error('internal', …)` (default-visible)         |
  | `console.log('sentori: initialized (dev) · cold N ms')` (one-shot init banner) | **removed** — surface via `onReady`                     |

  Net effect with default `logLevel: 'warn'`:

  - ✓ Silent on success path
  - ✓ Real problems still visible
  - ✓ Host can dial up to `'debug'` when debugging Sentori itself
  - ✓ Host can dial down to `'silent'` for CI / production-quiet hosts

  ## Why now

  User feedback (2026-05-23) on a host metro session showing 6
  `[sentori]` WARN lines for normal init. The Sentori principle is
  "免费的好处" — a free bonus must not pollute the host's runtime
  surface. Console warns from normal operation broke that contract.

  Part of the [v2.3 SDK redesign](../docs/design/sdk-v2.3-redesign.md);
  identity layer + Sentry compat layer follow in W6.1+.

### Patch Changes

- Updated dependencies [[`ff0be91`](https://github.com/goliajp/sentori/commit/ff0be919b7d5cc0a1ba84e00d6203218806c5450), [`f4748cf`](https://github.com/goliajp/sentori/commit/f4748cf3f1030fb1df6fcc1f4bd5d6fd16d0aeca)]:
  - @goliapkg/sentori-react-native@1.2.0

## 0.2.0

### Minor Changes

- Updated dependencies [[`09c823f`](https://github.com/goliajp/sentori/commit/09c823f4bcc9216f7c14943480dff390bef7d9de), [`cdddae4`](https://github.com/goliajp/sentori/commit/cdddae448347fe6fdb7ceeb87c9818b13a9844d0), [`ff6d036`](https://github.com/goliajp/sentori/commit/ff6d03698d4bde47e857fd58e859910364032241)]:

  - @goliapkg/sentori-react-native@1.1.0

  (Version manually pinned to 0.2.0 from changesets' auto-1.0.0 — the
  thin Expo adapter doesn't earn a major-stability claim yet; 1.0.0
  is reserved for a future audited stable cut.)

## 0.1.3

### Patch Changes

- [`2e611cb`](https://github.com/goliajp/sentori/commit/2e611cbf7b3751d8a7c93e15dfef1bafa53f523c) Thanks [@doracawl](https://github.com/doracawl)! - v1.x final polish: loosen inter-package dependency ranges from exact pins to caret ranges, plus refresh `@goliapkg/sentori-expo`'s peer range on `@goliapkg/sentori-react-native`.

  Previously every SDK's `dependencies` listed sibling packages with exact pins (e.g. `"@goliapkg/sentori-core": "0.8.3"`), which forced peer-dep resolution conflicts the moment any individual package moved. The same `core` package would be requested at two different exact versions simultaneously from two sibling adapters, and npm/bun would surface a warning or pick one arbitrarily.

  These dependencies now use caret ranges (e.g. `"@goliapkg/sentori-core": "^0.8.3"`). For pre-1.0 packages caret restricts to the same minor (`>=0.8.3 <0.9.0`), so the behavioral envelope is unchanged from a SemVer standpoint while patch-level updates flow through normally.

  `@goliapkg/sentori-expo`'s peer dependency on `@goliapkg/sentori-react-native` was stuck at `">=0.2.0"` (an artefact from when RN was on 0.2.x); now updated to `">=1.0.0-rc"` to reflect the current RN line.

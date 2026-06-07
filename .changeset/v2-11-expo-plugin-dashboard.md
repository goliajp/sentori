---
"@goliapkg/sentori-expo": minor
---

v2.11 — Expo config plugin auto-injects iOS + Android push setup; dashboard gains Push credential CRUD module.

Fifth phase of the v2.7→v2.12 Push rollout. Two additions:

**`@goliapkg/sentori-expo` config plugin (minor)**

Extends the previously-marker-only `app.plugin.js` into a real
configuration plugin that, when `'@goliapkg/sentori-expo'` is added
to a host's `app.json` plugins array, runs at `expo prebuild` time
and auto-injects:

* **iOS**
  - `Info.plist`: `UIBackgroundModes` ⊇ `["remote-notification"]`
  - Entitlements: `aps-environment` = `"production"` (Xcode flips
    to `"development"` for debug signing automatically)
* **Android**
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

* New `web/src/modules/push/view.tsx` — two stacked Cards on the
  manage group (chord `g n`):
  - **Configured providers** — `DataTable<PushCredentialRow>` showing
    every credential row stored server-side. Provider label,
    operator-readable config summary (e.g. `team_id · bundle_id ·
    env`), updated_at, delete button. Encrypted `secret_blob` is
    never returned by GET; never surfaced in the UI.
  - **Add / update credential** — provider dropdown, config JSON
    textarea (non-secret), secret JSON textarea (sealed before
    save), Save button. Provider-specific placeholders document the
    expected shape inline.
* `web/src/modules/registry.tsx` — registers `push` under `manage`
  with chord `n` and an `adminOnly: true` flag. Default visible.
* `web/src/api/client.ts` adds three wrappers:
  `listPushCredentials`, `upsertPushCredential`,
  `deletePushCredential`. Mirrors the cert-monitor `adminFetch`
  pattern.
* `web/src/api/query-keys.ts` — `pushCredentials(projectId)` key for
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

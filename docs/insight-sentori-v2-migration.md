# insight-mobile → Sentori SDK 5.x migration guide

Audience: the insight-mobile team. This is the file-by-file recipe
for moving from `@goliapkg/sentori-react-native` 4.0.0 to 5.0.0
(the five-kind redesign). Every change below was validated
end-to-end against the production instance on 2026-08-01 — a local
reference branch `feature/sentori-v2` exists with the exact diff,
but you own the merge; nothing has been pushed to your repo.

General API mapping (not insight-specific):
`@goliapkg/sentori-react-native/MIGRATION.md` on npm/GitHub.

## 0. What you get

- Crashes, auto-detected warns (rage taps / long freezes / slow
  cold start), release-anchored regression tracking, probe
  tripwires, and email notifications — reporting to
  `https://sentori.golia.jp` (project **insight-mobile**).
- The native layer is unchanged: no pod/gradle churn, existing dev
  clients keep working.

## 1. Dependencies — `package.json`

```diff
-    "@goliapkg/sentori-expo": "^9.0.1",
-    "@goliapkg/sentori-react-native": "4.0.0",
+    "@goliapkg/sentori-expo": "^10.0.0",
+    "@goliapkg/sentori-react-native": "^5.0.0",
     ...
-    "@goliapkg/sentori-cli": "0.6.0",
+    "@goliapkg/sentori-cli": "^1.0.0",
```

`@goliapkg/sentori-core@^2.0.0` comes in transitively. Then
`bun install`.

## 2. Token — `tenants/qualcomm/config.ts`

The 4.x `st_pk_…` token is refused by the 2.x server. An
ingest-scope token for project **insight-mobile** is already
minted — grab it from the dashboard (**Settings → Tokens**, ask
the owner for access) and replace the `sentori.token` value. The
`ingestUrl` (`https://ingest.sentori.golia.jp`) stays as is.

## 3. Init — `src/runtime/bootstrap/scripts/sentori.ts`

The `capture.*` block is gone; detection is declarative:

```ts
init({
  detect: {
    longFreeze: true,
    rageTap: true,
    slowColdStart: true,
    // slowApi stays opt-in
  },
  environment: __DEV__ ? 'dev' : 'prod',
  ingestUrl: sentoriConfig.ingestUrl,
  logLevel: __DEV__ ? 'info' : 'warn',
  release: `${tenant.app.slug}@${tenant.ios.version}+${tenant.android.versionCode}`,
  // B-type replay: rolling wireframe ring, shipped only when an
  // error/warn fires. Staging can keep a longer window.
  replaySeconds: Env.isStaging ? 30 : 15,
  token: sentoriConfig.token,
})
// Ambient context replaces per-flag calls:
sentori.context({ 'env-mode': Env.mode, tenant: tenant.id })
```

Removed here: `onReady`, `launchCrashGuard`, `sampleProfiler`,
`sessionTrail`, `runtimeMetrics`, `sentori.registerMaskQuery(…)`
(masking returns with the SDK's privacy pass — screenshots are
currently unmasked, keep `screenshot` semantics in mind), and
`getColdStartMs()` (now internal to the slow_cold_start detector).

## 4. Verb call sites

| File | Change |
|---|---|
| `src/features/auth-sign-in/bio-report.ts` | `sentori.addBreadcrumb({ data, type: 'custom' })` → `sentori.trace(\`bio.${event}\`, data, { quiet: true })`; `sentori.captureException(error, { tags })` → `sentori.error(error, tags)`; `sentori.track(\`bio.${event}\`, props)` → `sentori.trace(\`bio.${event}\`, props)` |
| `src/hooks/listeners/use-auth-listener.ts` | 4× `sentori.setUser({ id, linkBy: { email }, name })` → `sentori.user({ id, email, name })` (flat shape); `setUser(null)` → `user(null)` |
| `src/runtime/bootstrap/scripts/integrity.ts` | 3× `sentori.setFeatureFlag(k, v)` → `sentori.context({ k: v })` |
| `src/network/pinning/prod-adapter.ts` | inside the lazy require proxy: `sentori.captureException(err, extras)` → `sentori.error(err, extras)` (the injected `PinnedAdapterDeps['sentori']` interface + its test mocks can stay as-is) |
| `src/debug/dev-panel.tsx` | `sentori.captureException(new Error(…), { tags: {…} })` → `sentori.error(new Error(…), {…})` (data is flat); remove `<FeedbackButton trigger="fab" />` and its import (component removed); `triggerNativeCrash` import is unchanged |
| `src/runtime/bootstrap/app-provider.tsx` | `<sentori.RageTapCapture>` → named import: `import { RageTapCapture } from '@goliapkg/sentori-react-native'` |
| `src/runtime/bootstrap/atoms.ts`, `setup.ts` | remove `getColdStartMs` imports and the `coldMs:` fields in log lines (the SDK reports slow cold starts itself) |
| `src/app/_layout.tsx` | no change — `useTraceNavigation(navigationRef)` survives |
| `src/platform/notifications/providers/sentori-provider.ts` | no change — the `push.*` namespace is carried as-is |

`tsc --noEmit` should be clean after these; eslint will ask for
alphabetical key order on the new `user({ … })` objects.

## 5. New: plant the GOL-663 probe (recommended)

A probe is a regression tripwire: put it in the branch that used
to be the bug, and its silence becomes proof the fix holds. The
GOL-663 fix (cross-email org switch reseeding) has a natural spot
in `src/hooks/listeners/use-auth-listener.ts`:

```ts
if (target) {
  // …existing reseed…
} else {
  // GOL-663 tripwire: reaching this branch means a cross-email
  // switch found no stored session — the old bug's exact shape.
  sentori.probe('GOL-663-switch-without-session', { org })
}
```

Then register it per release (api-scope token, not the ingest one):

```bash
sentori-cli probes sync \
  --release "focus-ai-app@<ios.version>+<android.versionCode>" \
  --dir src --token $SENTORI_API_TOKEN
```

The probe shows on the dashboard's **Instruments** page — green
while silent.

## 6. Release pipeline — sourcemaps

`.devtools/cli/commands/release/sourcemap.ts` still calls the
0.6.0 CLI surface; the 1.x command is:

```bash
sentori-cli upload sourcemap <bundle.map> \
  --release "focus-ai-app@<version>+<build>" --token $SENTORI_API_TOKEN
```

Upload failures print a friendly notice and **exit 0** — they
never block a release (pass `--strict` if you want a hard gate).
Events received before the upload are re-symbolicated
automatically afterwards. dSYM/proguard uploads use the same
command with the respective file.

## 7. Verify

1. `bunx tsc --noEmit` + your pre-commit scenario — both were
   green on the reference branch.
2. Run the dev client, open Dev Utils → **Sentori Err**: an
   `error` issue appears on https://sentori.golia.jp within
   seconds (a `slow_cold_start` warn usually beats you to it —
   dev-client startup trips the detector).
3. Watch the mail: new issues and regressions notify the owner +
   assigned admins (per-user switches under **Settings →
   Notifications**).

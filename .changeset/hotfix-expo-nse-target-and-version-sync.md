---
'@goliapkg/sentori-expo': patch
---

Fully automate iOS Notification Service Extension wiring for rich-media push — no more manual Xcode step, no more `.appex` signing failures.

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

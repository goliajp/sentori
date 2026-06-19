---
'@goliapkg/sentori-expo': patch
---

Fix `expo run:ios --device` provisioning-profile failure on the auto-injected NSE target.

`withSentoriNSETarget` (shipped in 7.0.2) created the `SentoriNSE`
PBXNativeTarget without `DEVELOPMENT_TEAM` on its Debug / Release
build configurations. Sim builds don't sign with real profiles so
this slipped through; device builds hit:

```
No profiles for 'com.<app>.SentoriNSE' were found:
  Xcode couldn't find any iOS App Development provisioning profiles
  matching 'com.<app>.SentoriNSE'. Automatic signing is disabled and
  unable to generate a profile.
```

Xcode UI then falls back to the user's personal Apple-ID team
(whichever team the developer is signed into Xcode with), which is
not the project's team — Apple refuses to issue a NSE bundle-id
profile under it.

`injectNSETarget` now mirrors the host app's signing team onto the
NSE target: it reads `config.ios?.appleTeamId` from the Expo config
(the same value the main app target uses) and patches
`DEVELOPMENT_TEAM` into each `XCBuildConfiguration` in the NSE
target's config list, alongside the existing `CODE_SIGN_STYLE` /
`CODE_SIGN_IDENTITY` settings.

If the host hasn't configured `ios.appleTeamId` (manual-signing
projects, no automatic signing flow), `DEVELOPMENT_TEAM` is left
unset and existing behaviour is preserved.

Reported by the Insight team after cutting over to 9.0.0 on real
iPhone hardware. Fix lands as `injectNSETarget(pbxproj, {
appleTeamId?, deploymentTarget, mainBundleId })` — backward-compatible
signature (the new field is optional). Verified by inspecting
`ios/<App>.xcodeproj/project.pbxproj` after `expo prebuild --clean`:
the NSE target's Debug + Release configs both carry
`DEVELOPMENT_TEAM = <host team>`.

---
'@goliapkg/sentori-expo': patch
---

Fix `expo prebuild` crash on Android when the Sentori config plugin is enabled.

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

---
title: Android source bundle upload
description: Upload your Android source tree so the dashboard can render inline source for Kotlin / Java frames
---

# Android source bundle upload

ProGuard mappings let Sentori resolve obfuscated symbols back to their
original Kotlin / Java identifiers, but mappings don't carry the source
code itself. To show inline source on the issue-detail "Stack" tab,
upload your Android source tree alongside the mapping.

## One-shot: from a directory

```bash
npx @goliapkg/sentori-cli@latest upload source-bundle \
  --release "myapp@1.0.0" \
  --platform android \
  ./android/app/src
```

The CLI walks the directory and bundles `.kt / .java` files. Re-running
replaces the previous archive for the same `(release, platform)`.

## CI: React Native + Expo

Install `@goliapkg/sentori-react-native` (already in your app) — the
package ships a tiny helper that handles release + token + paths in one
command:

```jsonc
// package.json
{
  "scripts": {
    "build:android": "react-native bundle ... && sentori-rn-upload-source-bundle --platform android"
  }
}
```

Configuration goes in `sentori.config.json` at the app root:

```jsonc
{
  "token": "...",
  "projectId": "<uuid>",
  "apiUrl": "https://sentori.golia.jp",
  "sources": { "android": "android/app/src" }
}
```

Token + project id also accept the env vars `SENTORI_TOKEN` and
`SENTORI_PROJECT_ID`. Release defaults to `name@version` from
`package.json` if you don't pass `--release`.

## Multiple bundles per release

If your Android tree has separate gradle modules with their own source
sets, pass `--module <label>` so each bundle lives in its own slot:

```bash
sentori-cli upload source-bundle --platform android --module app    ./android/app/src
sentori-cli upload source-bundle --platform android --module shared ./android/shared/src
```

The dashboard's release-detail page shows the module label on each
bundle row so you can tell them apart later.

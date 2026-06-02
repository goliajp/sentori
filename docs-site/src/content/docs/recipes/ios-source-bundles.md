---
title: iOS source bundle upload
description: Upload your iOS source tree so the dashboard can render inline source for Swift / Obj-C frames
---

# iOS source bundle upload

dSYM uploads let Sentori resolve `PC → file:line` for iOS crashes, but
dSYMs don't carry the actual source code. To show inline source on the
issue-detail "Stack" tab, upload your iOS source tree alongside the
dSYM.

## One-shot: from a directory

```bash
npx @goliapkg/sentori-cli@latest upload source-bundle \
  --release "myapp@1.0.0" \
  --platform ios \
  ./ios
```

The CLI walks the directory and bundles `.swift / .m / .mm / .h / .hpp`
files, then tar.gz's them into a temp archive and uploads. Re-running
replaces the previous archive for the same `(release, platform)`.

## CI: React Native + Expo

Install `@goliapkg/sentori-react-native` (already in your app) — the
package ships a tiny helper that handles release + token + paths in one
command:

```jsonc
// package.json
{
  "scripts": {
    "build:ios": "react-native bundle ... && sentori-rn-upload-source-bundle --platform ios"
  }
}
```

Configuration goes in `sentori.config.json` at the app root:

```jsonc
{
  "token": "...",
  "projectId": "<uuid>",
  "apiUrl": "https://sentori.golia.jp",
  "sources": { "ios": "ios" }
}
```

Token + project id also accept the env vars `SENTORI_TOKEN` and
`SENTORI_PROJECT_ID`. Release defaults to `name@version` from
`package.json` if you don't pass `--release`.

## Multiple bundles per release

Polyrepo / multi-target apps (main app + watch ext + share ext)
typically have separate source trees. Pass `--module <label>` so each
bundle lives in its own slot and the lookup path tries all of them:

```bash
sentori-cli upload source-bundle --platform ios --module main      ./ios
sentori-cli upload source-bundle --platform ios --module watch-ext ./ios-watch
```

The dashboard's release-detail page shows the module label on each
bundle row so you can tell them apart later.

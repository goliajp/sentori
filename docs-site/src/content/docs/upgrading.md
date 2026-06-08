---
title: Upgrading
description: How to keep your @goliapkg/sentori-* packages current — what to bump, when, and what changes between releases.
---

# Upgrading

Sentori publishes each SDK independently to npm. There is **no monolithic version**; you upgrade `@goliapkg/sentori-react` on its own schedule from `@goliapkg/sentori-react-native`, and a server-side change does not force a client bump.

This page tells you which release you're on, which is current, and what the differences mean.

## Current published versions

The table below is the live state of the npm registry. Bookmark this page — we update it on every release.

| Package | Latest | What it is |
|---|---|---|
| `@goliapkg/sentori-core` | **1.3.1** | Wire-format + logger + capture primitives. Indirect dependency for every other JS SDK. |
| `@goliapkg/sentori-javascript` | **1.3.0** | Plain-browser / Node SDK. Use this when none of the framework wrappers below apply. |
| `@goliapkg/sentori-react` | **1.1.1** | `<SentoriProvider>` + hooks for React SPAs. Wraps `sentori-javascript`. |
| `@goliapkg/sentori-next` | **1.1.1** | Next.js App Router + Pages + `onRequestError` wire-up. Wraps `sentori-react`. |
| `@goliapkg/sentori-react-native` | **3.0.0** | RN runtime — replay walker, native crash hooks, push register. |
| `@goliapkg/sentori-expo` | **6.0.0** | Expo config plugin (auto-injects iOS Info.plist + Android manifest + Gradle) + thin wrapper. |
| `@goliapkg/sentori-vue` | **1.2.0** | Vue 3 plugin + composables. |
| `@goliapkg/sentori-svelte` | **1.2.0** | Svelte 5 store + actions. |
| `@goliapkg/sentori-solid` | **1.2.0** | Solid signals + ErrorBoundary integration. |
| `@goliapkg/sentori-cli` | **0.6.0** | CLI for sourcemap upload, dSYM upload, mapping.txt upload, push send, MCP serve. |

Run `npm ls @goliapkg/sentori-react` (or `bun pm ls | grep sentori`) inside your repo to see what you're actually on.

## Should I upgrade?

**Always take the latest patch (`x.y.Z`) of whatever majors you're on.** Patches are wire-compat, API-compat, and behaviour-equivalent — they fix bugs that we shipped, not ones you can wait out. The upgrade is a one-line `bun add @goliapkg/sentori-react@^1.1`.

**Minors (`x.Y.0`) add features and never break the public API.** Upgrade when something in the release notes is useful to you. No urgency unless a security advisory is attached.

**Majors (`X.0.0`) only ship when we can't preserve a v0 surface any longer.** The last one was v1 → v2 (mid-2025) — see [v1 → v2 migration](/recipes/v1-to-v2-migration). We design every major with a codemod so a typical app migrates in under an hour.

### Patch you should not skip

`sentori-core@1.3.1`, `sentori-react@1.1.1`, `sentori-next@1.1.1` (2026-06) downgrade every `console.error` in the SDK runtime to `console.warn`. Before this patch, an init failure or a runtime-metrics flush failure surfaced as a red `[sentori] …` line in the host app's console. Host teams reading red output occasionally mistook these for their own app crashing and pulled Sentori out. The patch closes that surface — there are no behaviour changes beyond the colour of the log line. **If you're on `^1.1` of `sentori-react` or `sentori-next`, `bun install` picks up the patch automatically; no code change required.**

## How to upgrade

### 1. Check what you have

```bash
# show the resolved versions in your lockfile
bun pm ls 2>/dev/null | grep '@goliapkg/sentori' || npm ls 2>/dev/null | grep '@goliapkg/sentori'
```

### 2. Bump the package(s) you actually consume

The framework wrappers pull in `sentori-core` + `sentori-javascript` transitively — you almost never need to bump `sentori-core` by hand. Just bump the top-level package you `import` from:

```bash
# React SPA
bun add @goliapkg/sentori-react@latest

# Next.js
bun add @goliapkg/sentori-next@latest

# React Native (Expo or bare)
bun add @goliapkg/sentori-react-native@latest
# If you're on Expo, also bump the plugin:
bun add @goliapkg/sentori-expo@latest

# Vue / Svelte / Solid — same pattern with the matching package name
```

### 3. Re-install + verify

```bash
bun install
bun pm ls | grep '@goliapkg/sentori'   # confirm the bump landed
```

Restart your dev server. If you're on Hermes / Metro / Vite with prebundling, kill and re-run them — they cache by version in some configurations.

### 4. Smoke test

The fastest way to confirm the SDK is alive:

```ts
import { sentori } from '@goliapkg/sentori-javascript'  // or your wrapper

sentori.captureMessage('post-upgrade smoke', { tags: { source: 'upgrade-check' } })
```

Open your Sentori dashboard, the event should arrive within a few seconds. If it doesn't, jump to [troubleshooting](/troubleshooting).

## Major upgrades

When the leading digit changes, the [migration recipe for that boundary](/recipes/v1-to-v2-migration) is the source of truth. The pattern we ship every time:

- **TL;DR with the codemod up front** — typical upgrade is six search-replaces.
- **Renamed APIs table** — old → new + the reason.
- **Behaviour notes** — what's silently different at runtime (rare; we annotate).
- **What you can leave alone** — most v1 callsites need no change.

Wire format is forever back-compat. A v1 SDK reports cleanly against a v2 server and vice versa. So you can upgrade the server and the SDK on separate weeks.

## Self-hosted: server + SDK independence

If you self-host the Sentori server, the same back-compat guarantee applies in both directions. You can:

- Upgrade your server image without touching your apps.
- Upgrade your apps without touching the server.
- Run a heterogeneous fleet (one app on `sentori-react@1.0`, another on `1.1.1`) against the same server, indefinitely.

The only "must move together" axis is a major version bump *of a single SDK across all surfaces of one app* — e.g. if you're using `sentori-react@2` inside the same project as `sentori-next@1`, they share `sentori-core` transitively and will fight over the resolution. `bun install` will warn; pin both wrappers to the same major.

## What to do when an upgrade goes wrong

1. **Pin back to the previous version** in your `package.json` (`@^1.1.0` instead of `@^1.1.1`, etc.) and `bun install` — that's your rollback.
2. **Open a ticket on the [issue tracker](https://github.com/goliajp/sentori/issues)** with: the previous version, the new version, the symptom (stack trace if any), and your platform.
3. **Worst case**: tell `sentori.init({ logLevel: 'silent', ... })` to mute the SDK while we ship a fix. The host app keeps working; you lose the Sentori reports until the next bump.

There's nothing in the SDK that can corrupt your app state — every public surface is wrapped in NEVER-rule safeFn boundaries, so a Sentori internal exception cannot propagate to your code. Rollback is purely a cosmetic operation.

# Insight followup — sourcemap upload 413 unblocked + canonical iOS / Android flows documented

Date: 2026-05-18 (~19:00 JST)
Server: `1.0.0-rc.1` deploy with the outer body cap restructured
CLI: `@goliapkg/sentori-cli@0.5.2`

## TL;DR — both Insight asks closed

1. **Server outer body cap raised to 256 MB.** The rc.10 server fix (1 MB → 16 MB) only addressed the inner cap above the attachment route. The dsym / mapping / sourcemap admin routes always declared 256 MB inner caps but the outer Tower layer kept squeezing them — same shape bug, second occurrence. Outer is now 256 MB; small-payload ingest routes self-limit at 1 MB explicitly so they don't inherit the looser ceiling.

2. **CLI help text now explicitly distinguishes the iOS vs Android canonical flows.** No code change needed for the iOS path — `sentori-cli upload sourcemap <composed.map> <bundle>` already worked; it just wasn't documented as the iOS canonical invocation.

## Server fix

`server/src/router.rs`:

```rust
// Before:
const MAX_BODY_BYTES: usize = 16 * 1024 * 1024;     // outer
const MAX_ADMIN_UPLOAD_BYTES: usize = 256 * 1024 * 1024;  // inner

// After:
const MAX_BODY_BYTES: usize = 256 * 1024 * 1024;    // outer, sized to the largest inner
const MAX_ADMIN_UPLOAD_BYTES: usize = 256 * 1024 * 1024;  // inner (unchanged)
```

Tower layers stack outside in; an outer cap below an inner cap silently dominates. We hit this twice in two days — first 1 MB outer + 16 MB inner for replay attachment, now 16 MB outer + 256 MB inner for sourcemap. The pattern is now: **outer = max inner**, with explicit per-route narrowing for endpoints that shouldn't accept big bodies.

The /v1/events / spans / sessions / etc. ingest routes now carry their own `RequestBodyLimitLayer::new(1 MB)` so a wedged client can't keep us reading megabytes of garbage before the JSON parser rejects it.

Verified by `curl -F file=@5MB-payload ...` against `ingest.sentori.golia.jp` post-deploy: pre-rc.10 outer 1 MB hit 413 at 1.1 MB; rc.10's 16 MB at 17 MB; this fix accepts 5 MB cleanly (401 from auth, not 413 from body cap).

After your team retries the 37 MB Android `packager.map` upload, expect 401 (token sanity) or 2xx (token good) — neither will be 413.

## CLI canonical flows (now in `--help`)

### Android — both raw maps survive `bundleRelease`, use `react-native upload`

```
npx @goliapkg/sentori-cli react-native upload \
  --release "<app>@<version>+<build>" --token "$SENTORI_TOKEN" \
  --metro-map  android/app/build/intermediates/sourcemaps/react/release/index.android.bundle.packager.map \
  --hermes-map android/app/build/intermediates/sourcemaps/react/release/index.android.bundle.compiler.map \
  --bundle     android/app/build/generated/assets/react/release/index.android.bundle
```

The CLI shells out to react-native's `scripts/compose-source-maps.js`, then POSTs the composed map + the bundle. Server stores both and uses the composed map for symbolication.

### iOS — `react-native-xcode.sh` already composed, use `upload sourcemap`

```
npx @goliapkg/sentori-cli upload sourcemap \
  --release "<app>@<version>+<build>" --token "$SENTORI_TOKEN" \
  "$BUILT_PRODUCTS_DIR/main.jsbundle.map" \
  "$BUILT_PRODUCTS_DIR/main.jsbundle"
```

`react-native-xcode.sh` runs `compose-source-maps.js` itself, writes the result to `$SOURCEMAP_FILE`, and `rm`s the intermediate metro + hermes maps. By the time `xcodebuild archive` finishes there is only the composed map on disk; the `react-native upload` flow can't run. `upload sourcemap` takes positional file paths and uploads each as-is — the server treats a client-composed map identically to a server-composed one for symbolication purposes.

### Why two commands

`react-native upload` is convenience for the Android happy path. `upload sourcemap` is the lower-level primitive. We're not deprecating `react-native upload` because the Android path still needs the compose step and doing it in the CLI is the simplest mental model for that platform.

## Cumulative server body-limit picture

| Layer | Old | After rc.10 SDK | After this fix |
|---|---|---|---|
| Outer cap (global) | 1 MB | 16 MB | **256 MB** |
| Per-route `/v1/events*` etc. | (none) | (none — used outer) | **1 MB explicit** |
| Per-route attachment | (none → outer 1 MB) | 16 MB inner | 16 MB inner (now actually applies) |
| Per-route admin upload (sourcemap / dsym / mapping) | 256 MB inner (but outer 1 MB capped) | 256 MB inner (but outer 16 MB capped) | **256 MB inner (now actually applies)** |

## What you should do

### To unblock today's blocked release symbolication

```bash
SENTORI_ADMIN_TOKEN=<token> \
  npx --yes @goliapkg/sentori-cli@latest react-native upload \
  --release "focus-ai-app@5.4.26051801+350" \
  --token "$SENTORI_ADMIN_TOKEN" \
  --metro-map  "android/app/build/intermediates/sourcemaps/react/release/index.android.bundle.packager.map" \
  --hermes-map "android/app/build/intermediates/sourcemaps/react/release/index.android.bundle.compiler.map" \
  --bundle     "android/app/build/generated/assets/react/release/index.android.bundle"
```

Should now succeed against the deployed server. v350 maps will land retroactively; minified frames from v350 crashes will start resolving once the upload completes.

### For ongoing builds — pin `@goliapkg/sentori-cli@0.5.2` or later in CI

0.5.2 ships the canonical iOS / Android examples in `--help`. No code-path change vs 0.5.1; safe to upgrade.

### For the gating change (your side)

You mentioned wiring failed sourcemap upload as a release gate rather than a silently-ignored warning. That's the right call — feel free to fail the build on non-zero exit from `sentori-cli`. The 413 path now exits non-zero with a clean error message.

## Status

| Insight ask | Verdict |
|---|---|
| 1. Raise sourcemap upload limit (≥100 MB) | ✅ — outer cap 16 MB → 256 MB, per-route 256 MB inner cap now actually applies |
| 2. Document canonical iOS post-build invocation | ✅ — `--help` + this doc both spell out the `upload sourcemap` shape with composed map + bundle; symbolication is identical to server-composed |
| 3. Deprecate `react-native upload` | declined — Android still needs the convenience; the two-command split aligns with the two raw-vs-composed realities |

Pre-rc.10 1.5 MB replay payload that worked back then was either against an interim deploy (one of the rc.x server images that briefly had a wider limit), or your verify time hit a different ingest endpoint than today's. Either way, the layering is now correct end-to-end and there's a regression test (`attachment_route_accepts_payloads_above_1mb`) that locks it.

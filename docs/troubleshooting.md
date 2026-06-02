---
title: Troubleshooting
description: Common Sentori questions, what to check, and how to fix them
---

# Troubleshooting

Ten questions that come up over and over. Each one: what to check,
what to expect, what to fix.

## 1. Dashboard isn't seeing any events

**Diagnose**

```bash
# Smoke-test from the same machine the app runs on
curl -sI -X POST "$SENTORI_INGEST_URL/v1/events" \
  -H "Authorization: Bearer $SENTORI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Look at the status code:

- `202` — the endpoint accepted a (malformed) event. Wiring is fine,
  problem is upstream of HTTP (init didn't run, capture isn't being
  called, hooks are stripped by a router).
- `400` — endpoint reachable, token OK, the test payload was just
  rejected for missing fields. Same conclusion as 202.
- `401` — token mismatch. Check it starts with `st_pk_` and matches
  the project's token in Project settings → tokens.
- `429` — rate limit. Default is 1000 req/min/token; bump via
  `SENTORI_RATE_LIMIT_PER_MIN` or wait a minute.
- Connection refused / timeout — network. Confirm `SENTORI_INGEST_URL`
  is reachable from the app's network (not just your laptop).

**Fix**

Look at the SDK's stdout/console for `[sentori]` lines. The transport
logs every failure with the full URL and status; the test above
should be redundant if you can grep your logs.

## 2. Stack traces are minified

**Diagnose**

Open an Issue detail page. If the frames show files like
`index-DkkF.js` and functions like `Y`/`Z`/`a`, the sourcemap for
that release isn't loaded. Two reasons:

- **Source map not uploaded** — most common. Run:

  ```bash
  sentori-cli upload sourcemap \
    --release "myapp@1.2.3+456" \
    --token "$SENTORI_TOKEN" \
    --ingest-url "$SENTORI_INGEST_URL" \
    dist/assets/
  ```

- **Release name mismatch** — the upload's `--release` and the
  event's `release` field must match byte-for-byte (case-sensitive,
  including the `+build` suffix). Compare:

  ```bash
  # what the SDK sent
  curl ".../admin/api/projects/$PROJ/issues/$ISSUE/events" | jq '.[0].release'

  # what the upload labelled
  ls /data/artifacts/  # or check the release detail page
  ```

**Fix**

If the issue page now shows an "Unsymbolicated stack" banner above
the frames, click "Open release →" — the release detail page shows
which artifacts are present and the upload command to use if any
are missing.

## 3. dSYM uploaded successfully but iOS frames still minified

**Diagnose**

The dashboard's release detail page lists slices with `arch` and
`uuid`. Compare the `uuid` to the event's frame:

```bash
# uuid the dSYM has
xcrun dwarfdump --uuid path/to/dSYM/Contents/Resources/DWARF/*

# uuid the event references — look at any frame's `debugId` field
```

If the uuids don't match, the dSYM was generated from a different
build than the one that crashed. Common causes:

- Debug build symbolicated against a release dSYM (or vice versa).
- Build cache wasn't cleaned; the dSYM is for the previous commit.
- Multi-architecture issue: you uploaded arm64 but the event came
  from a sim build (x86_64 / arm64-sim).

**Fix**

Find the matching dSYM:

```bash
# Spotlight indexes dSYMs locally
mdfind "com_apple_xcode_dsym_uuids == <event uuid>"
```

Re-upload with the matching dSYM. Sentori dedupes by sha256, so
re-running the upload is a no-op if it's the same file.

## 4. token 401

The transport returned 401. The server's 401 response includes a
`hint` field telling you which check failed:

```bash
curl -i -X POST "$SENTORI_INGEST_URL/v1/events" \
  -H "Authorization: Bearer $SENTORI_TOKEN" -d '{}' | tail -5
```

Possible hints:

| Hint | Cause | Fix |
|---|---|---|
| `token format invalid` | Doesn't start with `st_pk_` (public) or `sk_` (admin) | Copy from project settings, not from a chat snippet |
| `token revoked` | Was rotated/deleted | Rotate yours to the new value |
| `token mismatch` | Valid prefix but unknown to server | Wrong project? Cross-check `SENTORI_TOKEN` vs project id |
| `admin token required` | You used `st_pk_` on an admin endpoint | Switch to the `sk_` token |

## 5. Webhook signature doesn't validate

**Diagnose**

Sentori signs every webhook with HMAC-SHA-256 of the raw body using
the webhook's secret. Header: `X-Sentori-Signature: sha256=<hex>`.

Common signature failures:

- **Re-serialising the body** before HMAC — even minimal whitespace
  changes break the hash. Validate against the raw bytes.
- **Wrong secret** — webhook secrets are per-rule, not per-project.
  Check Alert rule → webhook → secret.
- **Constant-time comparison missing** — if you `===` strings,
  upstream timing-attack tests in the receiver will flag you. Use
  `crypto.timingSafeEqual` (Node) or the equivalent.

**Fix**

```ts
import crypto from 'node:crypto'

function verify(rawBody: Buffer, header: string, secret: string): boolean {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
```

## 6. crash-free sessions is stuck at 0%

The Overview page shows `crash-free sessions: 0%` even though some
events are flowing. Diagnose by checking the SDK is calling
`sentori.startSession()` (RN does this in `init`; web does not).

For web: sessions are not currently emitted by the JS SDK. The
crash-free metric only renders on projects that have at least one
session ping. If you only have web apps, the metric is correctly
zero (zero sessions → zero non-crashed → 0%). Hide the widget or
ignore it.

For RN: the SDK pings on every `init` and again on app foreground.
If the metric is stuck at 0%, watch the logs:

```bash
adb logcat -s sentori     # Android
xcrun simctl spawn booted log stream --predicate 'process == "MyApp"' | grep sentori   # iOS
```

Look for `session: started` lines. Missing → init ran but
`startSession` failed (usually a permissions or network issue on
boot).

## 7. Regression didn't fire when I expected

**Diagnose**

Sentori marks an issue `regressed` when:

1. It was resolved with a `resolvedInRelease`, AND
2. A new event lands with `(app, version)` strictly greater than
   `resolvedInRelease`.

Build numbers (`+build` suffix) are ignored. So `myapp@1.4.0+1`
resolving and `myapp@1.4.0+2` re-occurring does **not** trigger
regression.

```bash
# what was the resolve set to?
curl "/admin/api/projects/$P/issues/$I" | jq '.resolvedInRelease'

# what release sent the new event?
curl "/admin/api/projects/$P/issues/$I/events" | jq '.[0].release'
```

**Fix**

If you want every build to count as a new release for regression
purposes, encode the build into the `version` portion (less ideal)
or accept the current semantics (more honest — you didn't ship a
new version, you just rebuilt).

If the dashboard says the issue is still `resolved` but you have
events from a newer release: the regression evaluator runs on a
1-minute cron; wait a minute and refresh. Persistent miss = bug,
file an issue.

## 8. Hook errors not captured (React)

**Diagnose**

`useSentori()` / `useCaptureError()` throw if called outside a
`<SentoriProvider>`. That's deliberate — a silent no-op would be
worse than a clear error.

Symptoms:

- Component test fails with `[sentori-react] hook used outside <SentoriProvider>`
- Storybook renders complain on every story

**Fix**

In tests: wrap the render with the Provider, even with a dummy
config:

```tsx
const PROVIDER = (
  <SentoriProvider
    config={{
      token: 'st_pk_testtesttesttesttesttesttest',
      release: 'test@0.0.0',
      environment: 'test',
      ingestUrl: 'http://127.0.0.1:0',
    }}
  >
    {/* ... */}
  </SentoriProvider>
)
```

In Storybook: add the Provider to `.storybook/preview.tsx` decorators.

## 9. CI builds are slow because of source-map upload

The `sentori-cli upload sourcemap` step is sequential and uploads
the entire directory. For very large bundles (10+ MB) it can take
30–60s.

**Fix**

- Run upload in parallel with deploy when safe (errors that hit
  before symbols arrive will just look minified until symbols
  catch up — usually a few seconds).
- Upload only the changed assets by diffing `dist/assets/` against
  a previous build's manifest. CLI rejects on size and dedupes by
  sha256 internally; uploading the whole dir is safe but wasteful.
- Increase the CI runner's network bandwidth (GitHub `ubuntu-latest`
  is usually 1 Gbps; `runs-on: ubuntu-22.04` is similar).

## 10. Local dev floods the dashboard

You're seeing 1000+ events from `environment: dev` in production
dashboard.

**Fix**

Skip init in dev:

```ts
// web
if (import.meta.env.MODE === 'production') {
  // wrap with SentoriProvider
}

// RN
if (!__DEV__) {
  sentori.init({ /* ... */ })
}
```

Or set up a separate `dev` project with its own token, and switch
between them via `.env.local` (untracked) vs `.env.production`
(tracked). See [Multi-environment](./recipes/multi-environment.md)
for the full strategy.

## Still stuck?

- File an issue on [GitHub](https://github.com/goliajp/sentori/issues)
- Self-hosted: check `docker compose logs server` for warnings
- The dashboard's Audit log (Settings → Audit) records every config
  change in the project; sometimes "events stopped flowing" is
  "someone rotated the token an hour ago"

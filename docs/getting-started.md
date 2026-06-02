---
title: Getting started
description: Pick the 5-minute quickstart that matches your stack
---

# Getting started

Sentori is an error-tracking + APM platform. There's a 5-minute
quickstart for each supported stack — pick yours:

| Stack | Quickstart |
|---|---|
| **React** (Vite / CRA / any bundler) | [getting-started/react](./getting-started/react.md) |
| **React Native** (bare or Expo) | [getting-started/react-native](./getting-started/react-native.md) |
| **Next.js** (App Router or Pages) | [getting-started/nextjs](./getting-started/nextjs.md) |
| **Node.js / Bun** (Express, Hono, Fastify, scripts) | [getting-started/node](./getting-started/node.md) |

All four assume you already have:

- a **token** (`st_pk_...`)
- an **ingest URL**

For SaaS: sign up at <https://sentori.golia.jp> and copy from
project settings. For self-hosted: see [Self-hosting](./self-hosting.md).

Don't have a backend yet?

- [Self-hosting](./self-hosting.md) — one `docker compose up` on
  your own VM
- The SaaS at <https://sentori.golia.jp> is the same binary +
  same schema, just multi-tenant

## Working without an SDK

If you're prototyping or writing your own client, you can POST
directly to the ingest endpoint:

```bash
curl -X POST "$SENTORI_INGEST_URL/v1/events" \
  -H "Authorization: Bearer $SENTORI_TOKEN" \
  -H "Sentori-Sdk: curl/0.0.0" \
  -H "Content-Type: application/json" \
  -d '{
    "id": "01000000-0000-7000-8000-000000000001",
    "timestamp": "'"$(date -u +%FT%T.000Z)"'",
    "kind": "error",
    "platform": "javascript",
    "release": "myapp@0.1.0+1",
    "environment": "dev",
    "device": {"os": "other", "osVersion": "0"},
    "app": {"version": "0.1.0"},
    "error": {
      "type": "TypeError",
      "message": "hello sentori",
      "stack": [{"file": "shell.ts", "line": 1, "inApp": true}]
    }
  }'
```

See the [Protocol reference](./protocol.md) for the full schema.

## After you have events flowing

- [Notify Sentori of deploys](#deploy-pings) — one curl in CI keeps
  the release timeline accurate
- [Triage from CI with sentori-cli](#triage-from-ci) — `issue
  list / resolve / silence`
- [Make errors readable: upload source maps](#source-maps) —
  see `src/Foo.tsx:42` instead of `index.bundle:1:288432`

### Deploy pings

Add one line to your CI right after the build is uploaded:

```bash
curl -fsS -X POST "$SENTORI_INGEST_URL/v1/deploys" \
  -H "Authorization: Bearer $SENTORI_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"release\":\"myapp@$VERSION+$BUILD\",\"environment\":\"prod\"}"
```

Idempotent — re-running the same release just refreshes
`deployAt`, so flaky-CI retry is safe.

### Triage from CI

```bash
# Latest 20 active issues — one line per issue.
npx @goliapkg/sentori-cli issue list \
  --project "$PROJECT_ID" --status active --limit 20

# Mark resolved, tagging the fix release. The dashboard's regression
# detector flips it back to `regressed` if a matching event lands later.
npx @goliapkg/sentori-cli issue resolve <issue-uuid> \
  --project "$PROJECT_ID" \
  --in-release "myapp@1.2.4+457"

# Silence a known-noisy issue.
npx @goliapkg/sentori-cli issue silence <issue-uuid> \
  --project "$PROJECT_ID"
```

The admin token (`SENTORI_ADMIN_TOKEN`, `sk_` prefix) is in project
settings → tokens.

### Source maps

So a stack trace points at `src/Foo.tsx:42`, not `index.bundle:1:288432`.
After a release build, upload the source map tagged to the release —
**byte-for-byte the same string you pass to `init({ release })`**:

```bash
npx @goliapkg/sentori-cli@latest upload sourcemap \
  --release "myapp@$VERSION+$BUILD" --token "$SENTORI_TOKEN" \
  dist/assets/            # a build dir, or specific .map / .js files
```

The server symbolicates matching events at ingest and groups the issue
on the original-source frame. React Native (Hermes) needs the Metro
and Hermes maps composed first — see
[Source map upload](./recipes/sourcemap-upload.md) for the per-platform
steps and CI recipes (GitHub Actions / GitLab / Vercel / EAS).

## Reference

- [Protocol](./protocol.md) — wire format, if you're writing your
  own SDK or just curious
- [Self-hosting](./self-hosting.md) — production deploy, SMTP,
  backups, behind a reverse proxy
- [SDK — React](./sdk-react.md) / [SDK — React Native](./sdk-react-native.md)

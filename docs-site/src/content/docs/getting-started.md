---
title: Getting started
description: 5-minute quickstart from clone to first event
---

# Sentori — getting started

Five minutes from `git clone` to your first event in the dashboard.

## Prerequisites

- Docker with the `docker compose` plugin
- An app to instrument (or use `sdk/react-native/example/` in this repo)

## 1. Clone & configure

```bash
git clone <repo> sentori
cd sentori
```

Create `.env` with these values:

```bash
cat > .env <<EOF
SENTORI_DEV_TOKEN=st_pk_dev0000000000000000000000
SENTORI_ADMIN_PASSWORD=changeme
SENTORI_SESSION_SECRET=$(openssl rand -hex 32)
SENTORI_PG_PASSWORD=$(openssl rand -hex 16)
EOF
```

For SMTP, rate-limit, log-level overrides, copy
`docker-compose.override.example.yml` to `docker-compose.override.yml`.

## 2. Start

```bash
docker compose up -d
docker compose ps                # postgres should be "healthy"
docker compose logs -f server    # confirm "sentori-server listening"
```

## 3. Sign in to the dashboard

Open <http://localhost:8000>. Sign in with `SENTORI_ADMIN_PASSWORD`.

You should see the empty Issues list. The header has a `Sign out`
button; the search box accepts `/` to focus.

## 4. Send your first event

In a React Native app:

```ts
import { sentori } from '@goliapkg/sentori-react-native'

sentori.init({
  token: 'st_pk_dev0000000000000000000000',
  release: 'myapp@0.1.0+1',
  ingestUrl: 'http://<your-host>:8080',
})

throw new TypeError('hello sentori')
```

Or quickly from a shell:

```bash
curl -X POST http://localhost:8080/v1/events \
  -H "Authorization: Bearer st_pk_dev0000000000000000000000" \
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

Refresh the dashboard — the issue should appear within a few seconds.

## 5. Tell Sentori when you ship (optional)

Add one line to your CI right after the build is uploaded to users.
The dashboard's release timeline highlights the moment so regression
charts line up with the actual deploy.

```bash
curl -fsS -X POST "$SENTORI_INGEST_URL/v1/deploys" \
  -H "Authorization: Bearer $SENTORI_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"release\":\"myapp@$VERSION+$BUILD\",\"environment\":\"prod\"}"
```

Idempotent — re-running the same `release` just refreshes the
`deployAt` timestamp, so re-running a flaky CI job is safe.

GitHub Actions:

```yaml
- name: Notify Sentori of deploy
  env:
    SENTORI_TOKEN: ${{ secrets.SENTORI_TOKEN }}
  run: |
    curl -fsS -X POST https://ingest.sentori.golia.jp/v1/deploys \
      -H "Authorization: Bearer $SENTORI_TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"release\":\"myapp@${{ github.ref_name }}+${{ github.run_number }}\",\"environment\":\"prod\"}"
```

## What's next

- [SDK reference](./sdk-react-native.md) — full `sentori.init`, capture
  helpers, ErrorBoundary, native crash capture, source-map upload
- [Self-hosting guide](./self-hosting.md) — production deploy, SMTP,
  backups, behind a reverse proxy
- [Protocol](./protocol.md) — wire format, if you're writing your own
  SDK or just curious

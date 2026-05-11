---
title: Source map upload from CI
description: GitHub Actions / GitLab CI / Vercel build hook recipes
---

# Source map upload from CI

`sentori-cli upload sourcemap` takes a release name + files or
directories and POSTs to ingest. Walks dirs for `.js` / `.js.map`
pairs, dedupes by sha256 so re-runs are cheap.

```bash
sentori-cli upload sourcemap \
  --release "myapp@1.2.3+456" \
  --token "$SENTORI_TOKEN" \
  --ingest-url "$SENTORI_INGEST_URL" \
  dist/assets/
```

Below: how to wire this into the three most common CI surfaces.

## GitHub Actions

`.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  build-and-upload:
    runs-on: ubuntu-latest
    env:
      SENTORI_TOKEN: ${{ secrets.SENTORI_TOKEN }}
      SENTORI_INGEST_URL: https://ingest.sentori.golia.jp
      RELEASE: myapp@${{ github.ref_name }}+${{ github.run_number }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun run build
      - name: Install sentori-cli
        run: |
          curl -fsSL https://cdn.sentori.golia.jp/install-cli.sh | bash
          echo "$HOME/.sentori/bin" >> "$GITHUB_PATH"
      - name: Upload sourcemaps
        run: sentori-cli upload sourcemap --release "$RELEASE" dist/assets/
      - name: Notify of deploy
        run: |
          curl -fsS -X POST "$SENTORI_INGEST_URL/v1/deploys" \
            -H "Authorization: Bearer $SENTORI_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"release\":\"$RELEASE\",\"environment\":\"prod\"}"
      # ... actual deploy step (Vercel CLI / AWS S3 sync / Fly deploy / ...)
```

Notes:

- `actions/checkout@v4` is sufficient — we don't need `fetch-depth:
  0`. The release name comes from `github.ref_name` + `run_number`.
- The install step caches naturally on subsequent runs because the
  GHA runner image is fresh per job but `curl` is fast (~1 s).
- Put the upload **before** the deploy step so any release the user
  sees is already symbolicatable. If the upload fails (network /
  ingest down), failing the deploy job is the safe default.

## GitLab CI

`.gitlab-ci.yml`:

```yaml
stages: [build, deploy]

variables:
  SENTORI_INGEST_URL: "https://ingest.sentori.golia.jp"

build:
  stage: build
  image: oven/bun:1
  script:
    - bun install --frozen-lockfile
    - bun run build
  artifacts:
    paths: [dist/]
    expire_in: 1 day

upload-sourcemaps:
  stage: deploy
  image: oven/bun:1
  needs: [build]
  script:
    - curl -fsSL https://cdn.sentori.golia.jp/install-cli.sh | bash
    - export PATH="$HOME/.sentori/bin:$PATH"
    - export RELEASE="myapp@$CI_COMMIT_REF_NAME+$CI_PIPELINE_IID"
    - sentori-cli upload sourcemap --release "$RELEASE" dist/assets/
    - |
      curl -fsS -X POST "$SENTORI_INGEST_URL/v1/deploys" \
        -H "Authorization: Bearer $SENTORI_TOKEN" \
        -H "Content-Type: application/json" \
        -d "{\"release\":\"$RELEASE\",\"environment\":\"prod\"}"
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
```

`SENTORI_TOKEN` lives in GitLab's CI/CD variables (Settings →
CI/CD → Variables, mark "Masked"). `CI_PIPELINE_IID` is the
per-project pipeline number — stable + monotonic.

## Vercel build hook

Vercel doesn't expose a separate "post-build" step in the dashboard,
but `package.json#scripts.build` is a normal shell command:

```json
{
  "scripts": {
    "build": "next build && bun run upload-sourcemaps",
    "upload-sourcemaps": "node ./scripts/upload-sourcemaps.mjs"
  }
}
```

`scripts/upload-sourcemaps.mjs`:

```js
#!/usr/bin/env node
import { execSync } from 'node:child_process'

const release = `myapp@${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'local'}`
const token = process.env.SENTORI_TOKEN
if (!token) {
  console.warn('[sentori] SENTORI_TOKEN unset, skipping')
  process.exit(0) // don't fail the build on a missing local token
}

execSync(
  `sentori-cli upload sourcemap --release "${release}" .next/static/chunks/`,
  { stdio: 'inherit' },
)

// Deploy ping — Vercel sets VERCEL_ENV to 'production'|'preview'|'development'
execSync(
  `curl -fsS -X POST "$SENTORI_INGEST_URL/v1/deploys" \
    -H "Authorization: Bearer ${token}" \
    -H "Content-Type: application/json" \
    -d '{"release":"${release}","environment":"${process.env.VERCEL_ENV ?? 'preview'}"}'`,
  { shell: '/bin/bash', stdio: 'inherit' },
)
```

Add `SENTORI_TOKEN` + `SENTORI_INGEST_URL` to Vercel project →
Settings → Environment Variables (scope: Production + Preview).

For source-map generation specifically:

```js
// next.config.js
module.exports = {
  productionBrowserSourceMaps: true,
}
```

## Verifying

After an upload, the release detail page in the dashboard
(`/org/<slug>/releases/<encoded-release>`) shows:

- a "Source maps: N files" line
- per-file size + sha256
- the first 5 events to land against this release with a "preview
  symbolicated frame" panel

If the upload succeeded but events still show minified frames, check
that the release name on the event matches the upload exactly —
case-sensitive, `+build` suffix included.

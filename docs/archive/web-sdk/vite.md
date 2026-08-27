---
title: Vite + React
description: Wire Sentori into a Vite + React (SPA) project
---

# Vite + React

The Sentori dashboard itself is a Vite + React app and follows this
recipe verbatim.

## 1. Install

```bash
bun add @goliapkg/sentori-react
# or
pnpm add @goliapkg/sentori-react
```

## 2. Environment

`.env.production` (or `.env.local` for dev):

```bash
VITE_SENTORI_TOKEN=st_pk_...
VITE_SENTORI_RELEASE=myapp@1.2.3
VITE_SENTORI_INGEST=https://ingest.sentori.golia.jp
```

Vite only exposes `VITE_*` variables to the browser bundle. Anything
else stays server-side.

## 3. Wire `main.tsx`

```tsx
// src/main.tsx
import { SentoriErrorBoundary, SentoriProvider } from '@goliapkg/sentori-react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App'

const sentoriConfig = {
  token: import.meta.env.VITE_SENTORI_TOKEN,
  release: import.meta.env.VITE_SENTORI_RELEASE,
  environment: import.meta.env.MODE === 'production' ? 'prod' : 'dev',
  ingestUrl: import.meta.env.VITE_SENTORI_INGEST,
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SentoriProvider config={sentoriConfig}>
      <SentoriErrorBoundary fallback={<DashboardCrashed />}>
        <App />
      </SentoriErrorBoundary>
    </SentoriProvider>
  </StrictMode>,
)

function DashboardCrashed() {
  return (
    <div role="alert">
      <h2>Something went wrong</h2>
      <p>Refresh the page or contact support if it persists.</p>
    </div>
  )
}
```

`<SentoriProvider>` initialises the JS SDK (window error / unhandled
rejection hooks included) and exposes the capture API via context.
`<SentoriErrorBoundary>` catches anything thrown during render and
forwards it to the same SDK with `tags.source = 'react.errorBoundary'`.

## 4. Optional — route breadcrumbs

If you use react-router:

```tsx
// src/Shell.tsx
import { useSentoriRouter } from '@goliapkg/sentori-react/router'

export function Shell({ children }: { children: React.ReactNode }) {
  useSentoriRouter()
  return <>{children}</>
}
```

Mount once high in the tree (inside the `Router` and inside
`SentoriProvider`). Every pathname change becomes a `nav` breadcrumb.

## 5. Source maps

`vite.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
  },
})
```

After `bun run build`, maps land in `dist/assets/*.map`. Upload from
CI:

```bash
sentori-cli upload sourcemap \
  --release "myapp@$(git rev-parse --short HEAD)" \
  --token "$SENTORI_TOKEN" \
  --ingest-url "$SENTORI_INGEST_URL" \
  dist/assets/
```

## 6. CI example

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
      VITE_SENTORI_TOKEN: ${{ secrets.SENTORI_TOKEN }}
      VITE_SENTORI_RELEASE: myapp@${{ github.sha }}
      VITE_SENTORI_INGEST: https://ingest.sentori.golia.jp
      SENTORI_TOKEN: ${{ secrets.SENTORI_TOKEN }}
      SENTORI_INGEST_URL: https://ingest.sentori.golia.jp
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
        run: |
          sentori-cli upload sourcemap \
            --release "myapp@${{ github.sha }}" \
            dist/assets/
      # ... your deploy step
```

## Bundle size

`<SentoriProvider>` + `<SentoriErrorBoundary>` together add about
4 KB gzip on top of an existing React + Vite bundle (measured on the
Sentori dashboard at 336 KB total, gzip 107 KB).

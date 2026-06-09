import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import pkg from './package.json' with { type: 'json' }

// v2.20: hard-enforce single-source version. `/VERSION` at repo root
// is the canonical truth; `server/build.rs` and this config both
// panic the build if their respective package version drifts from it.
const rootVersionPath = resolve(import.meta.dirname, '..', 'VERSION')
const rootVersion = readFileSync(rootVersionPath, 'utf8').trim()
if (rootVersion !== pkg.version) {
  throw new Error(
    `version drift: web/package.json = ${pkg.version}, root VERSION = ${rootVersion}. ` +
      `Update both to match (and server/Cargo.toml too — build.rs enforces it).`,
  )
}

export default defineConfig({
  base: '/',
  build: {
    // `@wooorm/starry-night` ships its oniguruma WASM grammar engine
    // as one large blob (~8 MB raw, ~1.8 MB gzipped). SourceCode.tsx
    // already dynamic-imports it, so users only pay the bytes when
    // they open an issue's source view. Vite's default 500 kB warning
    // still fires on the lazy chunk — bump the threshold so the warn
    // surfaces real over-sized chunks instead of this expected one.
    chunkSizeWarningLimit: 9_000,
  },
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: { '@': resolve(import.meta.dirname, 'src') },
  },
  server: {
    proxy: {
      '/admin/api': 'http://localhost:8080',
      // Phase 18 sub-I-2: dashboard issues /api/auth/login, /api/orgs/...
      // as same-origin relative paths; in production Caddy forwards both
      // /admin/api/* and /api/* to the server. Match that here so vite
      // dev (and `bun run preview`, used by playwright e2e) works without
      // a fronting proxy.
      '/api': 'http://localhost:8080',
      // v1.0 — dev-only token-peek routes used by Playwright e2e to
      // pluck single-use verify/reset tokens out of the DB without
      // shelling into postgres. Server only mounts them when
      // SENTORI_EXPOSE_DEV_TOKENS=1; the proxy hop here is a no-op in
      // prod because the path doesn't exist anyway.
      '/dev': 'http://localhost:8080',
    },
  },
  test: {
    environment: 'jsdom',
    // Vitest auto-globs *.spec.ts; e2e/* is for Playwright and uses
    // @playwright/test which would otherwise import-fail under vitest.
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
  },
})

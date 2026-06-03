import { defineConfig, devices } from '@playwright/test'

// Phase 18 sub-I-2.
//
// Spec layout: `e2e/*.spec.ts`. Specs talk to the dashboard at
// http://127.0.0.1:5173 (vite dev) which proxies /api/* and /admin/api/*
// to the rust server at :8080.
//
// Prerequisites for running locally / in CI:
//   - Postgres on 127.0.0.1:55434 with user=postgres pw=dev db=sentori
//   - (no Valkey required — server tolerates VALKEY_URL unset)
//   - cargo on PATH so the webServer can build & run sentori-server
//
// Trigger via `bun run test:e2e`.

// DATABASE_URL is parameterized so CI (postgres service on :5432) and
// local dev (docker-compose on :55434) can both run the same suite.
// Override via `DATABASE_URL=...` in the calling env.
const SERVER_ENV = {
  DATABASE_URL:
    process.env.DATABASE_URL || 'postgres://postgres:dev@127.0.0.1:55434/sentori',
  SENTORI_DEV_TOKEN: 'st_pk_e2etest00000000000000000000',
  SENTORI_ADMIN_PASSWORD: 'e2e-admin',
  SENTORI_SESSION_SECRET: 'e2e-secret-please-rotate',
  SENTORI_BASE_URL: 'http://127.0.0.1:5173',
  // Mount /dev/last-verify-token + /dev/last-reset-token so the e2e
  // helpers can read single-use tokens out of the DB over HTTP — works
  // in CI without `docker exec`. Server skips these routes when the
  // env is unset (prod default).
  SENTORI_EXPOSE_DEV_TOKENS: '1',
  RUST_LOG: 'warn,sentori_server=info',
} as const

export default defineConfig({
  testDir: './e2e',
  // CI cold-starts plus the forgot-password test (register → verify
  // → SMTP probe → UI submit → reset UI → re-login) needs more than
  // 30 s for a fresh runner. Locally these tests still finish in
  // ~5 s; the higher ceiling is dead time on a warm machine.
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false, // share one server / one DB
  // CI has been flaking on the forgot-password test even at 45 s
  // for the response — the server reliably answers in <1 s once
  // it's awake but the first hit on a cold runner can be much
  // slower. One retry covers the cold-start tax without masking
  // a real regression (a real bug would fail both attempts).
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    // Keep traces for failed tests so a CI flake gives us a
    // playwright.zip we can actually inspect (timeline, screenshots,
    // network log) instead of just "timeout exceeded".
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: [
    {
      command: 'cd ../server && cargo run --quiet',
      url: 'http://127.0.0.1:8080/v1/events/_recent',
      env: SERVER_ENV,
      reuseExistingServer: true,
      timeout: 300_000, // first cargo build is slow
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // Use `vite preview` (production-built bundle) instead of `vite
      // dev`. The dev server's esbuild prebundling cross-chunks GDS
      // (@goliapkg/gds ESM 370-entry package) and emits a broken
      // `require_isUnsafeProperty` reference, which crashes every
      // page on mount. `bun run build` (rollup) handles the same
      // graph correctly. e2e against the production bundle is closer
      // to what users hit anyway.
      command:
        'bun run vite build --logLevel error && bun run vite preview --host 127.0.0.1 --port 5173',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 180_000, // build adds ~30s on a fresh runner
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
})

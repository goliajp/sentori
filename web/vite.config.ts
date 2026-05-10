import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/',
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

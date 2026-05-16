/**
 * Phase 48 sub-D — single source of truth for the dashboard's version
 * string, surfaced in the sidebar footer.
 *
 * Bump `SENTORI_VERSION` on every release that ships dashboard
 * changes (it's independent of npm-published SDK versions). The
 * `BUILD_SHA` is whatever VITE_GIT_SHA was injected at build time
 * (Dockerfile.web sets it from `$GITHUB_SHA`); falls back to "dev"
 * for local `bun run dev`.
 *
 * The string the user sees is `v0.8.0 · sha7chars` — long enough to
 * tell two deploys apart, short enough to fit in the sidebar.
 */

export const SENTORI_VERSION = 'v0.9.0'

const rawSha: string | undefined = import.meta.env.VITE_GIT_SHA
export const BUILD_SHA = rawSha?.slice(0, 7) || 'dev'

export const VERSION_LABEL = `${SENTORI_VERSION} · ${BUILD_SHA}`

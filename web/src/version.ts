/**
 * Single source of truth for the dashboard's user-visible version
 * string (sidebar footer + anywhere else "what version am I on" is
 * shown).
 *
 * v2.1 — derived from `web/package.json` `version` instead of
 * carrying its own constant. The three-string drift was a real
 * bug: at one point `package.json` said `1.0.1`, this file said
 * `v1.0.0-rc.6`, and `server/Cargo.toml` said `1.0.0-rc.1`. The
 * user saw three different "build" numbers depending on where in
 * the UI they looked. Now there's one number to bump.
 *
 * What still has to bump in lockstep on a deployment cut:
 *   - `web/package.json` `version`        ← canonical (this file
 *                                            derives from it)
 *   - `server/Cargo.toml` `version`       ← Overview "build N"
 *                                            strip reads
 *                                            CARGO_PKG_VERSION
 *
 * SDK packages under `sdk/*` are independent — each ships to npm
 * on its own changeset-managed cadence and is NOT this version.
 *
 * `BUILD_SHA` is whatever `VITE_GIT_SHA` was injected at build
 * time (Dockerfile.web sets it from `$GITHUB_SHA`); falls back
 * to "dev" for local `bun run dev`. The footer the user sees is
 * `v1.1.0 · 71bf239` — version locates the deploy in repo
 * history, sha locates the exact commit.
 */
import pkg from '../package.json'

export const SENTORI_VERSION = `v${pkg.version}`

const rawSha: string | undefined = import.meta.env.VITE_GIT_SHA
export const BUILD_SHA = rawSha?.slice(0, 7) || 'dev'

export const VERSION_LABEL = `${SENTORI_VERSION} · ${BUILD_SHA}`

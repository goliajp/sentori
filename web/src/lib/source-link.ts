/**
 * Phase 42 sub-A.12 — turn (project sourceRepoUrl, frame file, line)
 * into a clickable link to the source on GitHub / GitLab / Bitbucket
 * / Gitea. They all share the `<base>/blob/<ref>/<path>#L<line>` URL
 * shape, so one helper works for all four.
 *
 * Returns `null` when:
 *   - the project has no `sourceRepoUrl` configured
 *   - the frame `file` has no recognisable repo-relative path
 *     (e.g. `node_modules/...`, an `http://` bundle URL, an absolute
 *     `/Users/...` machine path with no detectable repo root)
 *
 * The matched relative path strategy is intentionally narrow: we look
 * for `src/...`, `lib/...`, `ios/...`, `android/...`, `app/...`,
 * `web/...`, `server/...`, `sdk/...`, `tests/...` segments — i.e.
 * the standard repo roots — and use the first one as the start of
 * the URL path. If a project has an unusual layout the user can
 * report it and we'll extend the recognised prefixes.
 *
 * `ref` is `main` by default; future improvements can read the
 * release-name commit SHA from the project's deploy artifacts.
 */

const REPO_PATH_PREFIXES = [
  'src',
  'lib',
  'app',
  'ios',
  'android',
  'web',
  'server',
  'sdk',
  'tests',
  'packages',
  'apps',
] as const

export function frameToSourceUrl(opts: {
  file: null | string | undefined
  line: number
  /** Default 'main'. Future: feed in the commit SHA from `event.release`. */
  ref?: string
  sourceRepoUrl: null | string | undefined
}): null | string {
  const { file, line, ref = 'main', sourceRepoUrl } = opts
  if (!sourceRepoUrl || !file) return null

  // Decode URL-encoded paths from Metro lazy-bundle URLs.
  let normalised = file
  if (normalised.includes('%2F') || normalised.includes('%2f')) {
    try {
      normalised = decodeURIComponent(normalised)
    } catch {
      // bad escape — keep raw
    }
  }

  // Skip node_modules / http(s) urls.
  if (normalised.includes('/node_modules/')) return null
  if (/^https?:\/\//.test(normalised)) return null

  const rel = relativeRepoPath(normalised)
  if (!rel) return null

  // Trim any trailing slash on the base so we don't end up with `//`.
  const base = sourceRepoUrl.replace(/\/+$/, '')
  return `${base}/blob/${encodeURIComponent(ref)}/${rel}#L${line}`
}

function relativeRepoPath(file: string): null | string {
  for (const prefix of REPO_PATH_PREFIXES) {
    const m = file.match(new RegExp(`(?:^|/)(${prefix}/[^?#]+)`))
    if (m) return m[1] ?? null
  }
  // Bare-leaf filename — assume it's at the repo root (e.g. `README.md`
  // would never appear in a stack trace, but `webpack.config.js` etc.
  // might). Only allow if no `/` is present.
  if (!file.includes('/')) return file
  return null
}

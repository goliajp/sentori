import { Navigate } from 'react-router'

/**
 * v2.4 single-domain catch-all redirect. Dashboard moved from root
 * to `/main/*`, but old bookmarks / external links / shared URLs
 * may still point at the v2.3-era root path (e.g.
 * `/org/golia/issues?status=active`). React Router's root-level
 * `path: '*'` matches those; this component preserves the full
 * pathname + search + hash and rewrites it to `/main` + same path.
 *
 * Without this, the root catch-all bounced to a flat `/main` and
 * the user landed on Overview instead of the page they bookmarked.
 */
export function DashboardLegacyRedirect() {
  const { pathname, search, hash } = window.location
  return <Navigate replace to={`/main${pathname}${search}${hash}`} />
}

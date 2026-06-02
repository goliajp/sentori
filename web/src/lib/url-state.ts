import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'

/**
 * `useState`-shaped hook that mirrors a single `URLSearchParams`
 * key against react-router's location.
 *
 * v2.2 — re-implemented on top of react-router's `useLocation` +
 * `useNavigate`. The previous version (Phase 48 sub-C) read
 * `window.location.search` once at mount and only listened to
 * `popstate`, which meant deep-link navigation via `<Link to="/x?y=z">`
 * silently lost the filter on the destination view: react-router's
 * pushState doesn't fire `popstate`, so the inbound view never
 * re-read the URL. (Concrete repro 2026-05-22: Release Detail's
 * "open N issues in this release →" link navigated to
 * `/issues?release=…` but IssuesView rendered the unfiltered list.)
 *
 * Now `value` is derived directly from `useLocation().search` on
 * every render, which react-router updates synchronously across
 * navigation — programmatic or back/forward.
 *
 * Setter calls `navigate({ search }, { replace: true })` — keeps the
 * back button moving between *pages*, not between filter changes
 * on the same page (a stack-history filter would be a UX maze).
 *
 * Caveat: only handles single-value string params. Multi-select
 * state (e.g. tag chips) should serialise to a comma-joined string
 * before passing through here.
 *
 * Usage:
 *
 *     const [release, setRelease] = useUrlParam<string>('release', '')
 *     // user clicks the "× clear" chip
 *     setRelease('')           // strips ?release= from URL
 *     // navigated in via /issues?release=focus-ai-app@5.4.x
 *     // release === 'focus-ai-app@5.4.x'
 *
 * The `validate` callback lets the caller reject malformed values
 * that landed in the URL via copy-paste or stale links — return
 * `null` to fall back to the default.
 */
export function useUrlParam<T extends string>(
  key: string,
  fallback: T,
  validate?: (raw: string) => null | T
): [T, (next: T) => void] {
  const location = useLocation()
  const navigate = useNavigate()

  const raw = new URLSearchParams(location.search).get(key)
  let value: T
  if (raw === null) value = fallback
  else if (validate) value = validate(raw) ?? fallback
  else value = raw as T

  const set = useCallback(
    (next: T) => {
      const params = new URLSearchParams(location.search)
      if (next === fallback) {
        params.delete(key)
      } else {
        params.set(key, next)
      }
      const search = params.toString()
      navigate(
        { pathname: location.pathname, search: search ? `?${search}` : '' },
        { replace: true }
      )
    },
    [key, fallback, location.pathname, location.search, navigate]
  )

  return [value, set]
}

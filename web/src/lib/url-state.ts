import { useCallback, useEffect, useState } from 'react'

/**
 * Phase 48 sub-C — `useState`-shaped hook that mirrors a single
 * `URLSearchParams` key. Reading it on first render parses the current
 * URL so refresh / link-share / back-button preserves the state; calling
 * the setter writes the new value back into `location.search` with
 * `history.replaceState` so it does not pollute browser back history
 * (filters are a view mode, not a navigation step).
 *
 * Caveat: only handles single-value string params. Multi-select state
 * (e.g. tag chips) should serialise to a comma-joined string before
 * passing through here.
 *
 * Usage:
 *
 *     const [status, setStatus] = useUrlParam<Status>('status', 'active')
 *     // user clicks the "regressed" tab
 *     setStatus('regressed')
 *     // URL becomes /org/.../issues?status=regressed; refresh restores.
 *
 * The `validate` callback lets the caller reject malformed values that
 * landed in the URL via copy-paste or stale links — return `null` to
 * fall back to the default.
 */
export function useUrlParam<T extends string>(
  key: string,
  fallback: T,
  validate?: (raw: string) => null | T
): [T, (next: T) => void] {
  const read = useCallback((): T => {
    if (typeof window === 'undefined') return fallback
    const raw = new URLSearchParams(window.location.search).get(key)
    if (raw === null) return fallback
    if (validate) return validate(raw) ?? fallback
    return raw as T
  }, [key, fallback, validate])

  const [value, setValue] = useState<T>(() => read())

  // Listen for `popstate` so the back button restores the older filter.
  useEffect(() => {
    const onPop = () => setValue(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [read])

  const set = useCallback(
    (next: T) => {
      setValue(next)
      const url = new URL(window.location.href)
      if (next === fallback) {
        url.searchParams.delete(key)
      } else {
        url.searchParams.set(key, next)
      }
      // replaceState keeps the back button moving between *pages*,
      // not between filter changes on the same page.
      window.history.replaceState(null, '', url)
    },
    [key, fallback]
  )

  return [value, set]
}

import { useIsFetching, useIsMutating } from '@tanstack/react-query'

import { TopProgress } from './ui'

/**
 * Phase 50 sub-B7 — bridge react-query's `isFetching` / `isMutating`
 * counts into the global `<TopProgress>` bar. Sits inside the
 * QueryClientProvider so it can read the counters.
 *
 * Excludes initial mounts (the global query's first fetch is its
 * own loading state inside the view); we only show the bar when
 * background fetches (revalidates, mutations) are running so the
 * user gets visible feedback that "stuff is happening up top".
 */
export function GlobalProgress() {
  const fetches = useIsFetching()
  const mutations = useIsMutating()
  return <TopProgress show={fetches + mutations > 0} />
}

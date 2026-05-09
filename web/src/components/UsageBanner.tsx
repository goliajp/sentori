import { useQuery } from '@tanstack/react-query'

import { type OrgRow, orgsApi } from '@/api/client'

const WARN_THRESHOLD = 80
const HARD_THRESHOLD = 100

/**
 * Phase 15 sub-D: persistent banner under the org top nav when monthly
 * event usage is approaching or has hit the plan limit. Refreshes every
 * 60 s so a freshly-flushed counter shows up promptly without spamming
 * the endpoint.
 */
export function UsageBanner({ org }: { org: OrgRow }) {
  const { data } = useQuery({
    queryFn: () => orgsApi.usage(org.slug),
    queryKey: ['usage', org.slug],
    refetchInterval: 60_000,
    staleTime: 60_000,
  })

  if (!data) return null
  const pct = data.percentUsed
  if (pct < WARN_THRESHOLD) return null

  const exceeded = pct >= HARD_THRESHOLD
  const reset = new Date(data.resetAt).toISOString().slice(0, 10)
  const tone = exceeded
    ? 'border-red-500/60 bg-red-500/10 text-red-300'
    : 'border-amber-500/60 bg-amber-500/10 text-amber-200'

  return (
    <div className={`border-b ${tone} px-6 py-1.5 text-[12px]`}>
      <span className="font-medium">
        {exceeded
          ? 'Monthly event quota reached.'
          : `Using ${Math.round(pct)}% of your monthly event quota.`}
      </span>{' '}
      <span className="opacity-80">
        {data.eventCount.toLocaleString()} / {data.eventLimitMonthly.toLocaleString()} events ·
        resets {reset}
        {exceeded &&
          ` · new events are being dropped (${data.droppedCount.toLocaleString()} so far)`}
      </span>
    </div>
  )
}

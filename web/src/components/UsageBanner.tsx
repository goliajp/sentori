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
  // Phase 49 sub-C — use semantic status tokens instead of raw amber /
  // red so the banner stays in sync with InfoBox + dark-mode palette.
  const tone = exceeded
    ? 'border-[color:var(--color-danger-border)] bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)]'
    : 'border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)]'

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

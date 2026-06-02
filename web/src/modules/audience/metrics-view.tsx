import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { adminApi, type AudienceBucket } from '@/api/client'
import { ModuleEmpty } from '@/components/Hint'
import { qk } from '@/api/query-keys'

/**
 * Audience > Metrics — v1.1 chunk C.
 *
 * Reads `/admin/api/projects/{id}/audience/metrics` (default 7-day
 * range, day granularity). Renders:
 *   - headline DAU sparkline + totals strip
 *   - one inline bar chart per metric (dau / pageviews / errors)
 *
 * Cohort retention + stacked-area breakdowns land in chunk D when
 * the dataset shape stabilises.
 */
export function AudienceMetricsView({ projectId }: { projectId: string }) {
  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    meta: { persist: true },
    queryFn: () => adminApi.audienceMetrics(projectId, { granularity: 'day' }),
    queryKey: qk.audience.metrics(projectId, 'day'),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  if (isLoading && !data) {
    return <ModuleEmpty eyebrow="metrics">Computing…</ModuleEmpty>
  }
  if (error) {
    return <ModuleEmpty eyebrow="metrics">Failed to read audience metrics.</ModuleEmpty>
  }

  const buckets = data?.buckets ?? []
  const totals = data?.totals ?? {
    errors: 0,
    pageviews: 0,
    trackEvents: 0,
    uniqueUsers: 0,
  }

  return (
    <div className="space-y-6">
      <p className="font-mono text-[11px] text-[color:var(--ink-muted)]">
        last 7 days · daily buckets · refreshes every 60s
      </p>

      <section className="rule-grid grid-cols-2 md:grid-cols-4">
        <Totem label="unique users" value={totals.uniqueUsers} />
        <Totem label="pageviews" value={totals.pageviews} />
        <Totem label="track events" value={totals.trackEvents} />
        <Totem label="errors" value={totals.errors} variant="warning" />
      </section>

      <BarSeries buckets={buckets} field="dau" title="Daily Active Users" />
      <BarSeries buckets={buckets} field="pageviews" title="Pageviews" />
      <BarSeries buckets={buckets} field="errors" title="Errors" variant="warning" />
    </div>
  )
}

function Totem({ label, value, variant }: { label: string; value: number; variant?: 'warning' }) {
  return (
    <div className="rule-cell">
      <div
        className="t-display text-[color:var(--ink)]"
        style={{
          color: variant === 'warning' && value > 0 ? 'var(--danger)' : undefined,
          fontSize: '40px',
        }}
      >
        {value.toLocaleString()}
      </div>
      <div className="t-tag mt-2">{label}</div>
    </div>
  )
}

function BarSeries({
  buckets,
  field,
  title,
  variant,
}: {
  buckets: AudienceBucket[]
  field: 'dau' | 'errors' | 'pageviews' | 'trackEvents'
  title: string
  variant?: 'warning'
}) {
  const rows = useMemo(() => {
    if (buckets.length === 0) return []
    const max = Math.max(...buckets.map((b) => b[field]), 1)
    return buckets.map((b) => ({
      label: shortDate(b.t),
      pct: (b[field] / max) * 100,
      value: b[field],
    }))
  }, [buckets, field])

  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">{title}</span>
        <span className="sec-head-sub">
          {rows.length === 0 ? 'no data' : `${rows.length} day${rows.length === 1 ? '' : 's'}`}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="py-3 font-mono text-[11px] text-[color:var(--ink-muted)]">
          no events captured in this range yet
        </p>
      ) : (
        <ul className="pt-3">
          {rows.map((r) => (
            <li
              className="flex items-baseline gap-3 border-b border-[color:var(--rule-soft)] py-1.5 last:border-b-0"
              key={r.label}
            >
              <span className="basis-[68px] font-mono text-[11px] text-[color:var(--ink-muted)]">
                {r.label}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  aria-hidden
                  className="block h-[6px]"
                  style={{
                    backgroundColor:
                      variant === 'warning' && r.value > 0 ? 'var(--danger)' : 'var(--accent)',
                    opacity: 0.25 + (r.pct / 100) * 0.6,
                    width: `${Math.max(r.pct, 1)}%`,
                  }}
                />
              </span>
              <span className="font-mono text-[12px] text-[color:var(--ink)] tabular-nums">
                {r.value.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function shortDate(t: string): string {
  const d = new Date(t)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

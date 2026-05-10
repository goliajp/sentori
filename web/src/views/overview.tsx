import { useQuery } from '@tanstack/react-query'

import { adminApi, type HealthBucket, type HealthSummary } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'

/**
 * Phase 26 sub-D: project overview / health widget.
 *
 * Last 24 hours (default), 1-hour buckets so a single screen-width
 * sparkline tells the story of the day. Three numbers up top:
 * crash-free session rate, crash-free user rate, total sessions.
 * Click into Releases for per-release breakdown.
 */
export function OverviewView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.health(projectId!, { bucket: '1h' }),
    queryKey: ['health', projectId, '1h'],
    staleTime: 30_000,
  })

  if (!projectId) {
    return (
      <EmptyState
        hint="Create one in your org settings to start ingesting events."
        title="No project selected"
      />
    )
  }
  if (isLoading) return <LoadingState />
  if (error) return <ErrorState label="Failed to load health." />
  if (!data) return null

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-fg text-xl font-semibold">{currentProject?.name ?? 'Overview'}</h1>
        <p className="text-fg-muted mt-1 text-[12px]">
          Last 24 hours · {data.buckets.length} bucket{data.buckets.length === 1 ? '' : 's'}
        </p>
      </header>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat
          accent={rateAccent(data.summary.crashFreeSessionRate, 0.99)}
          hint={`${data.summary.crashedSessions.toLocaleString()} crashed · ${data.summary.erroredSessions.toLocaleString()} errored`}
          label="Crash-free sessions"
          value={formatRate(data.summary.crashFreeSessionRate)}
        />
        <Stat
          accent={rateAccent(data.summary.crashFreeUserRate, 0.995)}
          hint={`${data.summary.crashedUsers.toLocaleString()} of ${data.summary.totalUsers.toLocaleString()} users`}
          label="Crash-free users"
          value={formatRate(data.summary.crashFreeUserRate)}
        />
        <Stat
          accent="neutral"
          hint={`${data.summary.totalUsers.toLocaleString()} unique users`}
          label="Total sessions"
          value={data.summary.totalSessions.toLocaleString()}
        />
      </section>

      <section>
        <h2 className="text-fg-muted text-[11px] tracking-wider uppercase">Sessions over time</h2>
        <SessionSparkline buckets={data.buckets} />
      </section>

      <section>
        <SummaryFootnote summary={data.summary} />
      </section>
    </div>
  )
}

function Stat({
  accent,
  hint,
  label,
  value,
}: {
  accent: 'good' | 'neutral' | 'warn'
  hint: string
  label: string
  value: string
}) {
  const ring =
    accent === 'good'
      ? 'ring-green-500/30'
      : accent === 'warn'
        ? 'ring-amber-500/30'
        : 'ring-border'
  const dot =
    accent === 'good' ? 'bg-green-400' : accent === 'warn' ? 'bg-amber-400' : 'bg-fg-muted/40'
  return (
    <div className={`border-border rounded-md border p-4 ring-1 ${ring}`}>
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-fg-muted text-[11px] tracking-wider uppercase">{label}</span>
      </div>
      <div className="text-fg mt-2 font-mono text-2xl tabular-nums">{value}</div>
      <div className="text-fg-muted mt-1 text-[11px]">{hint}</div>
    </div>
  )
}

/**
 * Pure-SVG sparkline. Width fills container; height fixed at 80px.
 * Stacks crashed (red) on top of total-crashed (gray) so the visual
 * width of the red layer reads as the unhealthy share at a glance.
 *
 * No external chart library — sparklines are a few <rect>s, and this
 * keeps bundle size flat.
 */
function SessionSparkline({ buckets }: { buckets: HealthBucket[] }) {
  if (buckets.length === 0) {
    return <p className="text-fg-muted mt-2 text-[12px]">No session pings in this window.</p>
  }
  const max = Math.max(1, ...buckets.map((b) => b.total))
  const w = 100 / buckets.length
  return (
    <svg
      aria-label="Sessions over time"
      className="border-border bg-bg-tertiary/30 mt-2 h-20 w-full rounded-md border"
      preserveAspectRatio="none"
      viewBox={`0 0 100 100`}
      role="img"
    >
      {buckets.map((b, i) => {
        const totalH = (b.total / max) * 100
        const crashedH = (b.crashed / max) * 100
        const x = i * w
        const y = 100 - totalH
        return (
          <g key={i}>
            <rect
              fill="currentColor"
              height={totalH}
              opacity="0.4"
              width={w * 0.85}
              x={x + w * 0.075}
              y={y}
            />
            {crashedH > 0 && (
              <rect
                fill="rgb(239 68 68)"
                height={crashedH}
                width={w * 0.85}
                x={x + w * 0.075}
                y={100 - crashedH}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

function SummaryFootnote({ summary }: { summary: HealthSummary }) {
  if (summary.totalSessions === 0) {
    return (
      <p className="text-fg-muted text-[12px]">
        Wire up sessions in your SDK with <code className="font-mono">sentori.init({'{...}'})</code>{' '}
        — the JS / RN packages send a session ping on app close automatically.
      </p>
    )
  }
  return null
}

function formatRate(rate: null | number): string {
  if (rate == null) return '—'
  return `${(rate * 100).toFixed(2)}%`
}

function rateAccent(rate: null | number, healthyThreshold: number): 'good' | 'neutral' | 'warn' {
  if (rate == null) return 'neutral'
  return rate >= healthyThreshold ? 'good' : 'warn'
}

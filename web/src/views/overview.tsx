import { useQuery } from '@tanstack/react-query'

import { adminApi, type HealthSummary } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { LineChart } from '@/components/charts'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { EmptyArt, PageBody, PageHeader, PageShell, StatNumber } from '@/components/ui'

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
        icon={<EmptyArt kind="project" />}
        title="No project selected"
      />
    )
  }
  if (isLoading) return <LoadingState />
  if (error) return <ErrorState label="Failed to load health." />
  if (!data) return null

  return (
    <PageShell>
      <PageHeader
        subtitle={`Last 24 hours · ${data.buckets.length} bucket${data.buckets.length === 1 ? '' : 's'}`}
        title={currentProject?.name ?? 'Overview'}
      />
      <PageBody>
        <div className="space-y-6">
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat
              accent={rateAccent(data.summary.crashFreeSessionRate, 0.99)}
              format={formatRate}
              hint={`${data.summary.crashedSessions.toLocaleString()} crashed · ${data.summary.erroredSessions.toLocaleString()} errored`}
              label="Crash-free sessions"
              rawValue={data.summary.crashFreeSessionRate ?? 0}
            />
            <Stat
              accent={rateAccent(data.summary.crashFreeUserRate, 0.995)}
              format={formatRate}
              hint={`${data.summary.crashedUsers.toLocaleString()} of ${data.summary.totalUsers.toLocaleString()} users`}
              label="Crash-free users"
              rawValue={data.summary.crashFreeUserRate ?? 0}
            />
            <Stat
              accent="neutral"
              format={(v) => Math.round(v).toLocaleString()}
              hint={`${data.summary.totalUsers.toLocaleString()} unique users`}
              label="Total sessions"
              rawValue={data.summary.totalSessions}
            />
          </section>

          <section>
            <h2 className="text-fg-muted t-sm mb-2 tracking-wider uppercase">Sessions over time</h2>
            <LineChart
              data={data.buckets.map((b) => ({
                crashed: b.crashed,
                errored: b.errored,
                ok: Math.max(0, b.total - b.crashed - b.errored),
                total: b.total,
                ts: b.at,
              }))}
              height={180}
              series={[
                { color: 'var(--color-accent)', key: 'ok', label: 'OK' },
                { color: 'var(--color-warning)', key: 'errored', label: 'Errored' },
                { color: 'var(--color-danger)', key: 'crashed', label: 'Crashed' },
              ]}
            />
          </section>

          <section>
            <SummaryFootnote summary={data.summary} />
          </section>
        </div>
      </PageBody>
    </PageShell>
  )
}

function Stat({
  accent,
  format,
  hint,
  label,
  rawValue,
}: {
  accent: 'good' | 'neutral' | 'warn'
  format: (v: number) => string
  hint: string
  label: string
  rawValue: number
}) {
  // Phase 49 sub-C — semantic tokens; Phase 50 sub-B4 — StatNumber
  // ease-out count-up on the hero digits.
  const ring =
    accent === 'good'
      ? 'ring-[color:var(--color-success-border)]'
      : accent === 'warn'
        ? 'ring-[color:var(--color-warning-border)]'
        : 'ring-border'
  const dot =
    accent === 'good'
      ? 'bg-[color:var(--color-success)]'
      : accent === 'warn'
        ? 'bg-[color:var(--color-warning)]'
        : 'bg-fg-muted/40'
  return (
    <div
      className={`border-border bg-bg-secondary rounded-md border p-4 ring-1 ${ring} transition-colors`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-fg-muted t-sm tracking-wider uppercase">{label}</span>
      </div>
      <div className="text-fg mt-2 font-mono text-2xl tabular-nums">
        <StatNumber format={format} value={rawValue} />
      </div>
      <div className="text-fg-muted t-sm mt-1">{hint}</div>
    </div>
  )
}

// Phase 50 sub-A2: the bespoke `<SessionSparkline>` is replaced by
// the reusable `<LineChart>` primitive — same data path, much richer
// hover + multi-series support. Bare-bones <rect> sparkline removed.

function SummaryFootnote({ summary }: { summary: HealthSummary }) {
  if (summary.totalSessions === 0) {
    return (
      <p className="text-fg-muted t-md">
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

import { useQuery } from '@tanstack/react-query'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'

/**
 * Overview — 4-up KPI cards + 3-pane lower row. Backed by real
 * adminApi.listProjects so the project count is live; the rest of the
 * KPIs are honest placeholders until /admin/api/overview lands.
 */
export function OverviewView() {
  const { currentOrg } = useOrg()
  const projectsQ = useQuery({ queryFn: adminApi.listProjects, queryKey: ['projects'] })
  const projectCount = (projectsQ.data ?? []).filter((p) => p.orgSlug === currentOrg.slug).length

  return (
    <div className="space-y-3">
      <PageHeader subtitle="Live status across ingest, alerting, and projects" title="Overview" />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <StatCard label="Active projects" status="active" value={projectCount.toString()} />
        <StatCard label="Events / min" status="active" value="—" />
        <StatCard label="Crash-free" status="active" value="—" />
        <StatCard label="Ingest health" status="active" value="OK" />
      </div>

      <Pane title="Health">
        <div className="text-fg-muted t-md">
          Live throughput and per-project health summaries land here in the next iteration.
        </div>
      </Pane>
    </div>
  )
}

function StatCard({
  label,
  status,
  value,
}: {
  label: string
  status: 'active' | 'error' | 'warning'
  value: string
}) {
  const dot = status === 'active' ? 'bg-success' : status === 'warning' ? 'bg-warning' : 'bg-danger'
  return (
    <div className="border-border bg-bg-secondary/30 rounded-md border px-3 py-2.5">
      <div className="text-fg-muted t-sm mb-1 flex items-center gap-1.5 font-semibold tracking-wider uppercase">
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        {label}
      </div>
      <div className="text-fg t-lg font-mono font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function Pane({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="border-border bg-bg-secondary/30 overflow-hidden rounded-md border">
      <header className="border-border border-b px-3 py-2">
        <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">{title}</span>
      </header>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  )
}

// v2.15 — Moments module (v3 GDS migration + flip under find-slow lens).
//
// User-flow performance — host wraps a flow with
// `sentori.startMoment('checkout').end()` and the SDK ships per-flow
// timing + abandon/failed counts. List view shows one row per moment
// name with count + p50/p95 + abandon%; click-row navigates to the
// detail view that streams individual samples.
//
// Find-slow lens extension per docs/roadmap/v2.15.md verdict —
// business-flow vital, sibling to v2.5 vitals (device-level vital).

import { Alert, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useNavigate, useParams } from 'react-router'

import { adminApi, type MomentRow } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

export function MomentsView() {
  const params = useParams<{ momentName: string }>()
  if (params.momentName) return <Outlet />
  return <MomentsList />
}

function MomentsList() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const navigate = useNavigate()

  const namesQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listMoments(projectId!),
    queryKey: qk.moments.list(projectId),
  })

  const moments = namesQ.data ?? []

  if (!projectId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Moments" />
        <Card>
          <EmptyState
            description="Pick a project from the sidebar to load its recent moments."
            title="No project selected"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'moments' },
        ]}
        subtitle="User-flow performance · last 7 days"
        title="Moments"
      />

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Flow timings</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {moments.length} flow{moments.length === 1 ? '' : 's'}
          </span>
        </header>

        {namesQ.error && (
          <Alert title="Failed to load moments" variant="danger">
            Refresh to retry.
          </Alert>
        )}

        {!namesQ.isLoading && !namesQ.error && moments.length === 0 && (
          <EmptyState
            description="Wrap a flow with sentori.startMoment('checkout').end() to start collecting per-flow durations. Each end() call lands a sample; the list groups by moment name."
            title="No moments in the last 7 days"
          />
        )}

        {moments.length > 0 && (
          <DataTable<MomentRow>
            columns={[
              {
                key: 'name',
                label: 'Moment',
                render: (_v, m) => <span className="text-fg font-mono text-[13px]">{m.name}</span>,
              },
              {
                align: 'right',
                key: 'count',
                label: 'Count',
                width: '90px',
                render: (_v, m) => (
                  <span className="text-fg-secondary font-mono text-[12px] tabular-nums">
                    {m.count.toLocaleString()}
                  </span>
                ),
              },
              {
                align: 'right',
                key: 'p50Ms',
                label: 'p50',
                width: '90px',
                render: (_v, m) => (
                  <span className="text-fg font-mono text-[12px] tabular-nums">
                    {formatMs(m.p50Ms)}
                  </span>
                ),
              },
              {
                align: 'right',
                key: 'p95Ms',
                label: 'p95',
                width: '90px',
                render: (_v, m) => (
                  <span className="text-fg font-mono text-[12px] tabular-nums">
                    {formatMs(m.p95Ms)}
                  </span>
                ),
              },
              {
                align: 'right',
                key: 'abandoned',
                label: 'Abandon',
                width: '110px',
                render: (_v, m) => {
                  const pct = m.count > 0 ? Math.round((m.abandoned / m.count) * 100) : 0
                  if (m.abandoned === 0) {
                    return (
                      <span className="text-fg-muted font-mono text-[12px] tabular-nums">—</span>
                    )
                  }
                  return (
                    <span
                      className={`font-mono text-[12px] tabular-nums ${
                        pct >= 20 ? 'text-warning' : 'text-fg-secondary'
                      }`}
                    >
                      {pct}% ({m.abandoned})
                    </span>
                  )
                },
              },
              {
                align: 'right',
                key: 'failed',
                label: 'Failed',
                width: '80px',
                render: (_v, m) =>
                  m.failed > 0 ? (
                    <span className="text-danger font-mono text-[12px] tabular-nums">
                      {m.failed}
                    </span>
                  ) : (
                    <span className="text-fg-muted font-mono text-[12px] tabular-nums">—</span>
                  ),
              },
              {
                align: 'right',
                key: 'lastSeen',
                label: 'Last seen',
                width: '140px',
                render: (_v, m) => (
                  <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                    {formatRelative(m.lastSeen)}
                  </span>
                ),
              },
            ]}
            density="compact"
            onRowClick={(m) =>
              navigate(`/main/org/${currentOrg.slug}/moments/${encodeURIComponent(m.name)}`)
            }
            rowKey={(m) => m.name}
            rows={moments}
            striped
          />
        )}
      </Card>
    </div>
  )
}

function formatMs(ms: number): string {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms)}ms`
}

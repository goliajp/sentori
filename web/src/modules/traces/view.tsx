// v2.14 — Traces module (v3 GDS migration + flip visible).
//
// Two-level surface: list view (this file) + detail view at
// `:traceId` (./detail-view.tsx). The list shows root spans for
// the project's last 24 h; click-row navigates to the detail.
//
// find-slow lens fallback per docs/roadmap/hidden-modules-audit.md
// §1 — when vitals + runtime aren't enough to isolate "why is this
// route slow" the operator drills into the full trace timeline here.

import { Alert, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useNavigate, useParams } from 'react-router'

import { adminApi, type TraceRow } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

export function TracesView() {
  const params = useParams<{ traceId: string }>()
  if (params.traceId) return <Outlet />
  return <TraceList />
}

function TraceList() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const navigate = useNavigate()

  const tracesQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listTracesPage(projectId!, { limit: 100 }),
    queryKey: qk.traces.list(projectId),
  })

  const traces = tracesQ.data?.traces ?? []

  if (!projectId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Traces" />
        <Card>
          <EmptyState
            description="Pick a project from the sidebar to load its recent traces."
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
          { label: 'traces' },
        ]}
        subtitle="Distributed root spans · last 24h"
        title="Traces"
      />

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Recent traces</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {traces.length} loaded
          </span>
        </header>

        {tracesQ.error && (
          <Alert title="Failed to load traces" variant="danger">
            Refresh to retry.
          </Alert>
        )}

        {!tracesQ.isLoading && !tracesQ.error && traces.length === 0 && (
          <EmptyState
            description="No traces landed in the last 24 h. The SDK emits root spans via sentori.startTrace() — check the host has wrapped a request flow."
            title="No traces in the selected window"
          />
        )}

        {traces.length > 0 && (
          <DataTable<TraceRow>
            columns={[
              {
                key: 'rootOp',
                label: 'Trace',
                render: (_v, t) => (
                  <span className="text-fg font-mono text-[13px]">
                    {t.rootOp ?? t.rootName ?? `trace ${t.traceId.slice(0, 8)}`}
                  </span>
                ),
              },
              {
                align: 'right',
                key: 'durationMs',
                label: 'Duration',
                width: '110px',
                render: (_v, t) => (
                  <span className="text-fg font-mono text-[12px] tabular-nums">
                    {t.durationMs >= 1000
                      ? `${(t.durationMs / 1000).toFixed(2)}s`
                      : `${t.durationMs}ms`}
                  </span>
                ),
              },
              {
                align: 'right',
                key: 'spanCount',
                label: 'Spans',
                width: '80px',
                render: (_v, t) => (
                  <span className="text-fg-secondary font-mono text-[12px] tabular-nums">
                    {t.spanCount}
                  </span>
                ),
              },
              {
                key: 'rootName',
                label: 'Service',
                render: (_v, t) => (
                  <span className="text-fg-secondary font-mono text-[12px]">
                    {t.rootName ?? '—'}
                  </span>
                ),
              },
              {
                align: 'right',
                key: 'lastSeen',
                label: 'Last seen',
                width: '140px',
                render: (_v, t) => (
                  <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                    {formatRelative(t.lastSeen)}
                  </span>
                ),
              },
            ]}
            density="compact"
            onRowClick={(t) => navigate(`/main/org/${currentOrg.slug}/traces/${t.traceId}`)}
            rowKey={(t) => t.traceId}
            rows={traces}
            striped
          />
        )}
      </Card>
    </div>
  )
}

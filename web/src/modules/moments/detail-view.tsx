// v2.15 — Moment detail view (samples timeline).
//
// Per-flow samples for the selected moment name. Listed newest-first
// (the API order). Each row: when it started, how long it took,
// whether it ended in error / abandoned.

import { Alert, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { adminApi, type MomentSample } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

export function MomentDetailView() {
  const { momentName: rawName } = useParams<{ momentName: string }>()
  const momentName = rawName ? decodeURIComponent(rawName) : null
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const samplesQ = useQuery({
    enabled: !!projectId && !!momentName,
    queryFn: () => adminApi.listMomentSamples(projectId!, momentName!),
    queryKey: qk.moments.samples(projectId, momentName),
  })

  if (!projectId || !momentName) return null

  const samples = samplesQ.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          {
            label: 'moments',
            href: `/main/org/${currentOrg.slug}/moments`,
          },
          { label: momentName },
        ]}
        subtitle="Per-execution samples · last 7 days"
        title={momentName}
      />

      <div className="flex">
        <Link
          className="text-fg-muted hover:text-accent inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.08em] uppercase transition-colors"
          to={`/main/org/${currentOrg.slug}/moments`}
        >
          ← back to moments
        </Link>
      </div>

      {samplesQ.error && (
        <Alert title="Failed to load samples" variant="danger">
          Refresh to retry.
        </Alert>
      )}

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Samples</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {samples.length} sample{samples.length === 1 ? '' : 's'}
          </span>
        </header>

        {!samplesQ.isLoading && !samplesQ.error && samples.length === 0 && (
          <EmptyState
            description="The moment name exists but no executions landed in the last 7 days."
            title="No samples in the window"
          />
        )}

        {samples.length > 0 && (
          <DataTable<MomentSample>
            columns={[
              {
                key: 'startedAt',
                label: 'Started',
                width: '140px',
                render: (_v, s) => (
                  <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                    {formatRelative(s.startedAt)}
                  </span>
                ),
              },
              {
                align: 'right',
                key: 'durationMs',
                label: 'Duration',
                width: '120px',
                render: (_v, s) => (
                  <span className="text-fg font-mono text-[12px] tabular-nums">
                    {formatMs(s.durationMs)}
                  </span>
                ),
              },
              {
                key: 'status',
                label: 'Status',
                width: '100px',
                render: (_v, s) => (
                  <span
                    className={
                      s.status === 'ok'
                        ? 'text-fg-secondary font-mono text-[12px]'
                        : s.status === 'error'
                          ? 'text-danger font-mono text-[12px]'
                          : 'text-fg-muted font-mono text-[12px]'
                    }
                  >
                    {s.status}
                  </span>
                ),
              },
              {
                key: 'abandoned',
                label: 'Abandoned',
                width: '120px',
                render: (_v, s) =>
                  s.abandoned ? (
                    <span className="text-warning font-mono text-[12px]">yes</span>
                  ) : (
                    <span className="text-fg-muted font-mono text-[12px]">—</span>
                  ),
              },
              {
                key: 'id',
                label: 'Sample id',
                render: (_v, s) => (
                  <span className="text-fg-muted block max-w-[40ch] truncate font-mono text-[10px]">
                    {s.id}
                  </span>
                ),
              },
            ]}
            density="compact"
            rowKey={(s) => s.id}
            rows={samples}
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

import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'

export function TraceDetailView() {
  const { traceId } = useParams<{ traceId: string }>()
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId && !!traceId,
    queryFn: () => adminApi.getTraceDetail(projectId!, traceId!),
    queryKey: ['trace-detail', projectId, traceId],
  })

  if (!projectId || !traceId) return null

  return (
    <div className="space-y-3">
      <Link
        className="text-fg-muted hover:text-fg t-sm inline-flex items-center gap-1"
        to={`/org/${currentOrg.slug}/traces`}
      >
        ← Traces
      </Link>

      <PageHeader title={data?.trace.rootOp ?? 'Trace'} subtitle={traceId} />

      {isLoading && (
        <Pane title="Loading…">
          <div className="text-fg-muted t-md">…</div>
        </Pane>
      )}
      {error && (
        <Pane title="Error">
          <div className="text-fg-muted t-md">Failed to load.</div>
        </Pane>
      )}
      {data && (
        <>
          <Pane title="Summary">
            <div className="t-md text-fg">
              {data.spans.length} spans · {Math.round(data.trace.durationMs)}ms ·{' '}
              {data.trace.status}
            </div>
          </Pane>

          <div className="std-table border-border overflow-hidden rounded-md border">
            <table>
              <thead>
                <tr className="text-fg-muted t-sm tracking-wider uppercase">
                  <th className="text-left font-medium">Op</th>
                  <th className="text-left font-medium">Name</th>
                  <th className="w-24 text-right font-medium">Duration</th>
                  <th className="w-20 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.spans.map((s) => (
                  <tr className="hover:bg-bg-tertiary/40" key={s.id}>
                    <td className="text-fg-muted t-md font-mono">{s.op}</td>
                    <td className="text-fg t-md">{s.name}</td>
                    <td className="text-fg t-md text-right tabular-nums">{s.durationMs}ms</td>
                    <td className="text-fg-muted t-md">{s.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
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

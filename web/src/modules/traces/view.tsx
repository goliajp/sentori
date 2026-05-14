import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'

export function TracesView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listTracesPage(projectId!, { limit: 100 }),
    queryKey: ['traces', projectId],
  })

  const traces = data?.traces ?? []

  return (
    <div className="space-y-3">
      <PageHeader
        count={traces.length}
        subtitle="Distributed root spans across services"
        title="Traces"
      />

      {!projectId && <Empty hint="Select a project" title="No project" />}
      {projectId && isLoading && <Empty hint="Loading…" title="Traces" />}
      {projectId && error && <Empty hint="Failed to load traces." title="Error" />}
      {projectId && !isLoading && !error && traces.length === 0 && (
        <Empty hint="No traces in the selected window." title="No traces" />
      )}

      {traces.length > 0 && (
        <div className="std-table border-border overflow-hidden rounded-md border">
          <table>
            <thead>
              <tr className="text-fg-muted t-sm tracking-wider uppercase">
                <th className="text-left font-medium">Trace</th>
                <th className="w-24 text-right font-medium">Duration</th>
                <th className="w-20 text-right font-medium">Spans</th>
                <th className="w-32 text-left font-medium">Service</th>
                <th className="w-24 text-left font-medium">Started</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => (
                <tr className="hover:bg-bg-tertiary/40" key={t.traceId}>
                  <td>
                    <Link
                      className="text-fg t-md font-mono"
                      to={`/org/${currentOrg.slug}/traces/${t.traceId}`}
                    >
                      {t.rootOp ?? '—'}
                    </Link>
                  </td>
                  <td className="text-fg t-md text-right tabular-nums">
                    {t.durationMs >= 1000
                      ? `${(t.durationMs / 1000).toFixed(2)}s`
                      : `${t.durationMs}ms`}
                  </td>
                  <td className="text-fg t-md text-right tabular-nums">{t.spanCount}</td>
                  <td className="text-fg-muted t-md font-mono">{t.rootName ?? '—'}</td>
                  <td className="text-fg-muted t-md tabular-nums">{formatRelative(t.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Empty({ hint, title }: { hint: string; title: string }) {
  return (
    <div className="border-border bg-bg-secondary/30 rounded-md border px-6 py-12 text-center">
      <div className="text-fg-muted t-sm mb-1 font-semibold tracking-wider uppercase">{title}</div>
      <div className="text-fg t-md">{hint}</div>
    </div>
  )
}

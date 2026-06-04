import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useNavigate, useParams } from 'react-router'

import { adminApi } from '@/api/client'
import { ModuleEmpty } from '@/components/Hint'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'
import { qk } from '@/api/query-keys'

export function TracesView() {
  const params = useParams<{ traceId: string }>()
  if (params.traceId) return <Outlet />
  return <TraceList />
}

function TraceList() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const navigate = useNavigate()

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listTracesPage(projectId!, { limit: 100 }),
    queryKey: qk.traces.list(projectId),
  })

  const traces = data?.traces ?? []

  return (
    <div className="space-y-5">
      <PageHeader
        count={traces.length}
        subtitle="Distributed root spans · last 24h"
        title="Traces"
      />

      {!projectId && <ModuleEmpty eyebrow="no project">Select a project</ModuleEmpty>}
      {projectId && isLoading && <ModuleEmpty eyebrow="traces">Loading…</ModuleEmpty>}
      {projectId && error && <ModuleEmpty eyebrow="error">Failed to load traces.</ModuleEmpty>}
      {projectId && !isLoading && !error && traces.length === 0 && (
        <ModuleEmpty eyebrow="empty">No traces in the selected window.</ModuleEmpty>
      )}

      {traces.length > 0 && (
        <table className="bench">
          <thead>
            <tr>
              <th>trace</th>
              <th className="num">duration</th>
              <th className="num">spans</th>
              <th>service</th>
              <th className="num">started</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((t) => {
              const href = `/main/org/${currentOrg.slug}/traces/${t.traceId}`
              return (
                <tr
                  className="cursor-pointer"
                  key={t.traceId}
                  onClick={(e) => {
                    if (e.metaKey || e.ctrlKey || e.button === 1) return
                    navigate(href)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigate(href)
                    }
                  }}
                  role="link"
                  tabIndex={0}
                >
                  <td className="lead">
                    <Link
                      className="text-fg hover:text-accent"
                      onClick={(e) => e.stopPropagation()}
                      to={href}
                    >
                      {t.rootOp ?? t.rootName ?? `trace ${t.traceId.slice(0, 8)}`}
                    </Link>
                  </td>
                  <td className="num text-fg">
                    {t.durationMs >= 1000
                      ? `${(t.durationMs / 1000).toFixed(2)}s`
                      : `${t.durationMs}ms`}
                  </td>
                  <td className="num">{t.spanCount}</td>
                  <td>{t.rootName ?? '—'}</td>
                  <td className="num">{formatRelative(t.lastSeen)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

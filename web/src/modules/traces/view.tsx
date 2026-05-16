import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useNavigate, useParams } from 'react-router'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'
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

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listTracesPage(projectId!, { limit: 100 }),
    queryKey: ['traces', projectId],
  })

  const traces = data?.traces ?? []

  return (
    <div className="sentori-page-in space-y-5">
      <PageHeader
        count={traces.length}
        subtitle="Distributed root spans · last 24h"
        title="Traces"
      />

      {!projectId && <Empty hint="Select a project" title="no project" />}
      {projectId && isLoading && <Empty hint="Loading…" title="traces" />}
      {projectId && error && <Empty hint="Failed to load traces." title="error" />}
      {projectId && !isLoading && !error && traces.length === 0 && (
        <Empty hint="No traces in the selected window." title="empty" />
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
              const href = `/org/${currentOrg.slug}/traces/${t.traceId}`
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
                      className="text-[color:var(--ink)] hover:text-[color:var(--accent)]"
                      onClick={(e) => e.stopPropagation()}
                      to={href}
                    >
                      {t.rootOp ?? t.rootName ?? `trace ${t.traceId.slice(0, 8)}`}
                    </Link>
                  </td>
                  <td className="num text-[color:var(--ink)]">
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

function Empty({ hint, title }: { hint: string; title: string }) {
  return (
    <div className="border-t border-b border-[color:var(--rule)] px-0 py-10 text-center">
      <div className="mb-2 font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
        {title}
      </div>
      <div className="text-[13px] text-[color:var(--ink-soft)]">{hint}</div>
    </div>
  )
}

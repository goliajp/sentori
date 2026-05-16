import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'

export function ReleasesView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listReleases(projectId!),
    queryKey: ['releases', projectId],
  })

  const rows = data ?? []

  return (
    <div className="sentori-page-in">
      <PageHeader count={rows.length} subtitle="deploys · sourcemaps · symbols" title="Releases" />

      {!projectId && <Empty hint="Select a project to see its releases." />}
      {projectId && isLoading && <Empty hint="Loading…" />}
      {projectId && error && <Empty hint="Failed to load releases — retry." />}
      {projectId && !isLoading && !error && rows.length === 0 && (
        <Empty hint="No releases yet. Push an event or run sentori-cli upload." />
      )}

      {rows.length > 0 && (
        <table className="bench">
          <thead>
            <tr>
              <th>release</th>
              <th className="num">events</th>
              <th className="num">js maps</th>
              <th className="num">dsym</th>
              <th className="num">proguard</th>
              <th className="num">deployed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const deployStamp = r.deployAt ?? r.firstSeen ?? r.createdAt
              return (
                <tr key={r.id}>
                  <td className="lead">
                    <Link
                      className="text-[color:var(--ink)] hover:text-[color:var(--accent)]"
                      to={`/org/${currentOrg.slug}/releases/${encodeURIComponent(r.name)}`}
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="num">{r.eventCount.toLocaleString()}</td>
                  <td
                    className={`num ${
                      r.sourcemapCount === 0 ? 'text-[color:var(--ink-muted)]' : ''
                    }`}
                  >
                    {r.sourcemapCount}
                  </td>
                  <td className={`num ${r.dsymCount === 0 ? 'text-[color:var(--ink-muted)]' : ''}`}>
                    {r.dsymCount}
                  </td>
                  <td
                    className={`num ${r.mappingCount === 0 ? 'text-[color:var(--ink-muted)]' : ''}`}
                  >
                    {r.mappingCount}
                  </td>
                  <td className="num">{formatRelative(deployStamp)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Empty({ hint }: { hint: string }) {
  return (
    <p className="border-y border-[color:var(--rule)] py-6 text-center text-[13px] text-[color:var(--ink-soft)]">
      {hint}
    </p>
  )
}

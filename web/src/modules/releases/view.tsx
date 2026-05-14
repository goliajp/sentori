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
    <div className="space-y-3">
      <PageHeader
        count={rows.length}
        subtitle="Deploys with event counts and artifact uploads"
        title="Releases"
      />

      {!projectId && <Empty hint="Select a project" title="No project" />}
      {projectId && isLoading && <Empty hint="Loading…" title="Releases" />}
      {projectId && error && <Empty hint="Failed to load releases." title="Error" />}
      {projectId && !isLoading && !error && rows.length === 0 && (
        <Empty
          hint="No releases yet — push an event or run sentori-cli upload."
          title="No releases"
        />
      )}

      {rows.length > 0 && (
        <div className="std-table border-border overflow-hidden rounded-md border">
          <table>
            <thead>
              <tr className="text-fg-muted t-sm tracking-wider uppercase">
                <th className="text-left font-medium">Release</th>
                <th className="w-24 text-right font-medium">Events</th>
                <th className="w-24 text-right font-medium">Sourcemaps</th>
                <th className="w-24 text-right font-medium">dSYMs</th>
                <th className="w-24 text-right font-medium">Proguard</th>
                <th className="w-32 text-left font-medium">Deployed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const deployStamp = r.deployAt ?? r.firstSeen ?? r.createdAt
                return (
                  <tr className="hover:bg-bg-tertiary/40" key={r.id}>
                    <td>
                      <Link
                        className="text-fg t-md font-mono font-semibold"
                        to={`/org/${currentOrg.slug}/releases/${encodeURIComponent(r.name)}`}
                      >
                        {r.name}
                      </Link>
                    </td>
                    <td className="text-fg t-md text-right tabular-nums">
                      {r.eventCount.toLocaleString()}
                    </td>
                    <td
                      className={`t-md text-right tabular-nums ${r.sourcemapCount === 0 ? 'text-fg-muted' : 'text-fg'}`}
                    >
                      {r.sourcemapCount}
                    </td>
                    <td
                      className={`t-md text-right tabular-nums ${r.dsymCount === 0 ? 'text-fg-muted' : 'text-fg'}`}
                    >
                      {r.dsymCount}
                    </td>
                    <td
                      className={`t-md text-right tabular-nums ${r.mappingCount === 0 ? 'text-fg-muted' : 'text-fg'}`}
                    >
                      {r.mappingCount}
                    </td>
                    <td className="text-fg-muted t-md tabular-nums">
                      {formatRelative(deployStamp)}
                    </td>
                  </tr>
                )
              })}
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

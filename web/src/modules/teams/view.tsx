import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { teamsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'

export function TeamsView() {
  const { currentOrg } = useOrg()
  const { data, error, isLoading } = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => teamsApi.list(currentOrg.slug),
    queryKey: ['teams', currentOrg.slug],
  })

  const teams = data ?? []

  return (
    <div className="space-y-3">
      <PageHeader
        count={teams.length}
        subtitle="Groups that own projects and receive alerts"
        title="Teams"
      />

      {isLoading && <Empty hint="Loading…" title="Teams" />}
      {error && <Empty hint="Failed to load teams." title="Error" />}
      {!isLoading && !error && teams.length === 0 && (
        <Empty hint="No teams yet — create one in org settings." title="No teams" />
      )}

      {teams.length > 0 && (
        <div className="std-table border-border overflow-hidden rounded-md border">
          <table>
            <thead>
              <tr className="text-fg-muted t-sm tracking-wider uppercase">
                <th className="text-left font-medium">Team</th>
                <th className="w-32 text-left font-medium">Slug</th>
                <th className="text-left font-medium">Description</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr className="hover:bg-bg-tertiary/40" key={t.id}>
                  <td>
                    <Link
                      className="text-fg t-md font-semibold"
                      to={`/org/${currentOrg.slug}/teams/${t.slug}`}
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="text-fg-muted t-md font-mono">{t.slug}</td>
                  <td className="text-fg-muted t-md">{t.description ?? '—'}</td>
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

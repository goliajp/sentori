import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { teamsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { EmptyState } from '@/components/Hint'
import { RowSkeleton } from '@/components/Skeleton'
import { PageHeader } from '@/layout/page-header'
import { qk } from '@/api/query-keys'

export function TeamsView() {
  const { currentOrg } = useOrg()
  const { data, error, isLoading } = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => teamsApi.list(currentOrg.slug),
    queryKey: qk.orgs.teams(currentOrg.slug),
  })

  const teams = data ?? []

  return (
    <div className="sentori-page-in">
      <PageHeader count={teams.length} subtitle="own projects · receive alerts" title="Teams" />

      {isLoading && <RowSkeleton count={3} height="44px" />}
      {error && <EmptyState>Failed to load teams.</EmptyState>}
      {!isLoading && !error && teams.length === 0 && (
        <EmptyState>No teams yet — create one in org settings.</EmptyState>
      )}

      {teams.length > 0 && (
        <table className="bench">
          <thead>
            <tr>
              <th>team</th>
              <th>slug</th>
              <th>description</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <td className="lead">
                  <Link
                    className="text-fg hover:text-accent"
                    to={`/main/org/${currentOrg.slug}/teams/${t.slug}`}
                  >
                    {t.name}
                  </Link>
                </td>
                <td>{t.slug}</td>
                <td className="text-fg-secondary">{t.description ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

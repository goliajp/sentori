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
    <div className="sentori-page-in">
      <PageHeader count={teams.length} subtitle="own projects · receive alerts" title="Teams" />

      {isLoading && <Hint>Loading…</Hint>}
      {error && <Hint>Failed to load teams.</Hint>}
      {!isLoading && !error && teams.length === 0 && (
        <Hint>No teams yet — create one in org settings.</Hint>
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
                    className="text-[color:var(--ink)] hover:text-[color:var(--accent)]"
                    to={`/org/${currentOrg.slug}/teams/${t.slug}`}
                  >
                    {t.name}
                  </Link>
                </td>
                <td>{t.slug}</td>
                <td className="text-[color:var(--ink-soft)]">{t.description ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-y border-[color:var(--rule)] py-6 text-center text-[13px] text-[color:var(--ink-soft)]">
      {children}
    </p>
  )
}

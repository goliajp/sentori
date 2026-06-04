import { Alert, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { teamsApi } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'

type Team = {
  id: string
  slug: string
  name: string
  description: null | string
}

export function TeamsView() {
  const { currentOrg } = useOrg()
  const { data, error, isLoading } = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => teamsApi.list(currentOrg.slug),
    queryKey: qk.orgs.teams(currentOrg.slug),
  })

  const teams = (data ?? []) as Team[]

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'teams' },
        ]}
        subtitle={`${teams.length.toLocaleString()} teams · own projects, receive alerts`}
        title="Teams"
      />

      {error && (
        <Alert title="Failed to load teams" variant="danger">
          Refresh to retry.
        </Alert>
      )}

      {!isLoading && !error && teams.length === 0 && (
        <Card>
          <EmptyState
            description="Create a team in org settings to start collecting alerts."
            title="No teams yet"
          />
        </Card>
      )}

      {(isLoading || teams.length > 0) && (
        <DataTable<Team>
          columns={[
            {
              key: 'name',
              label: 'Team',
              render: (_v, t) => (
                <Link
                  className="text-fg hover:text-accent font-mono text-[13px]"
                  to={`/main/org/${currentOrg.slug}/teams/${t.slug}`}
                >
                  {t.name}
                </Link>
              ),
            },
            {
              key: 'slug',
              label: 'Slug',
              width: '180px',
              render: (_v, t) => (
                <span className="text-fg-muted font-mono text-[12px]">{t.slug}</span>
              ),
            },
            {
              key: 'description',
              label: 'Description',
              render: (_v, t) => (
                <span className="text-fg-secondary text-[12px]">{t.description ?? '—'}</span>
              ),
            },
          ]}
          density="compact"
          loading={isLoading}
          loadingRows={3}
          rowKey="id"
          rows={teams}
          stickyHeader
          striped
        />
      )}
    </div>
  )
}

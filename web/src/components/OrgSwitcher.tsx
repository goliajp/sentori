import { useNavigate, useSearchParams } from 'react-router'

import type { OrgRow, TeamRow } from '@/api/client'

type Props = {
  current: null | OrgRow
  currentTeamSlug?: null | string
  orgs: OrgRow[]
  teams?: TeamRow[]
}

export function OrgSwitcher({ current, currentTeamSlug, orgs, teams = [] }: Props) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const onChangeOrg = (orgSlug: string) => {
    // Drop the team filter when switching orgs — the slugs are org-scoped.
    navigate(`/org/${orgSlug}/issues`)
  }

  const onChangeTeam = (teamSlug: string) => {
    if (!current) return
    const next = new URLSearchParams(searchParams)
    if (teamSlug === '') {
      next.delete('team')
    } else {
      next.set('team', teamSlug)
    }
    const qs = next.toString()
    navigate(`/org/${current.slug}/issues${qs ? `?${qs}` : ''}`)
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className="border-border bg-bg-tertiary text-fg hover:border-accent/50 focus:ring-accent rounded-md border px-2 py-1 text-[13px] focus:ring-1 focus:outline-none"
        onChange={(e) => onChangeOrg(e.target.value)}
        value={current?.slug ?? ''}
      >
        {orgs.map((o) => (
          <option key={o.id} value={o.slug}>
            {o.name}
          </option>
        ))}
      </select>
      {teams.length > 0 && (
        <>
          <span className="text-fg-muted text-[12px]">/</span>
          <select
            className="border-border bg-bg-tertiary text-fg hover:border-accent/50 focus:ring-accent rounded-md border px-2 py-1 text-[13px] focus:ring-1 focus:outline-none"
            onChange={(e) => onChangeTeam(e.target.value)}
            value={currentTeamSlug ?? ''}
          >
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.slug}>
                {t.name}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}

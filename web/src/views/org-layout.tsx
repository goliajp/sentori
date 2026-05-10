import { useQueries, useQuery } from '@tanstack/react-query'
import { Link, Navigate, Outlet, useLocation, useParams, useSearchParams } from 'react-router'

import { adminApi, orgsApi, teamsApi } from '@/api/client'
import { OrgCtx } from '@/auth/orgContext'
import { useAuth } from '@/auth/state'
import { OnboardingBadge } from '@/components/OnboardingBadge'
import { OrgSwitcher } from '@/components/OrgSwitcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { useThemeEffect } from '@/components/theme'
import { UsageBanner } from '@/components/UsageBanner'

const NAV = [
  { label: 'Issues', path: 'issues' },
  { label: 'Teams', path: 'teams' },
  { label: 'Settings', path: 'settings' },
]

export function OrgLayout() {
  useThemeEffect()
  const { slug } = useParams()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { logout, user } = useAuth()

  const { data: orgs, isLoading: loadingOrgs } = useQuery({
    queryFn: orgsApi.listMine,
    queryKey: ['orgs'],
  })
  const { data: projects, isLoading: loadingProjects } = useQuery({
    queryFn: adminApi.listProjects,
    queryKey: ['projects'],
  })
  const { data: teams } = useQuery({
    enabled: !!slug,
    queryFn: () => teamsApi.list(slug!),
    queryKey: ['teams', slug],
  })

  // Project ↔ team binding to filter the project list when a team is
  // selected. One request per team; cheap for small N (<= ~10) and only
  // needed when teams exist at all.
  const projectTeamsQueries = useQueries({
    queries: (projects ?? []).map((p) => ({
      enabled: !!teams && teams.length > 0,
      queryFn: () => teamsApi.listProjectTeams(p.id),
      queryKey: ['project-teams', p.id] as const,
    })),
  })

  if (loadingOrgs || loadingProjects) {
    return (
      <div className="text-fg-muted flex h-full items-center justify-center text-sm">Loading…</div>
    )
  }
  const currentOrg = orgs?.find((o) => o.slug === slug) ?? null
  if (!currentOrg) {
    // Either the slug doesn't exist or the user isn't a member.
    return <Navigate replace to="/" />
  }
  const orgProjects = projects?.filter((p) => p.orgSlug === slug) ?? []

  const teamSlugFromUrl = searchParams.get('team')
  const currentTeamSlug =
    teamSlugFromUrl && (teams ?? []).some((t) => t.slug === teamSlugFromUrl)
      ? teamSlugFromUrl
      : null

  // When a team is selected, filter projects to those bound to it. Projects
  // with no binding stay visible to org admins; team-only members already
  // hit the server-side gate (Phase 18 sub-B middleware).
  const filteredProjects = currentTeamSlug
    ? orgProjects.filter((p) => {
        const idx = (projects ?? []).findIndex((q) => q.id === p.id)
        const bound = projectTeamsQueries[idx]?.data ?? []
        return bound.some((t) => t.slug === currentTeamSlug)
      })
    : orgProjects

  const currentProject = filteredProjects[0] ?? null

  const isActive = (path: string) => location.pathname.startsWith(`/org/${currentOrg.slug}/${path}`)

  return (
    <OrgCtx.Provider
      value={{
        currentOrg,
        currentProject,
        currentTeamSlug,
        orgs: orgs ?? [],
        projects: filteredProjects,
        teams: teams ?? [],
      }}
    >
      <div className="flex h-full flex-col">
        <header className="border-border bg-bg/80 flex h-12 shrink-0 items-center justify-between border-b px-6 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <Link className="text-fg text-sm font-semibold" to="/">
              Sentori
            </Link>
            <OrgSwitcher
              current={currentOrg}
              currentTeamSlug={currentTeamSlug}
              orgs={orgs ?? []}
              teams={teams ?? []}
            />
            <nav className="flex items-center gap-1">
              {NAV.map((item) => (
                <Link
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive(item.path)
                      ? 'bg-accent/10 text-accent'
                      : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
                  }`}
                  key={item.path}
                  to={`/org/${currentOrg.slug}/${item.path}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <OnboardingBadge project={currentProject} />
            <span className="text-fg-muted hidden text-xs sm:inline">{user?.email}</span>
            <ThemeToggle />
            <button
              className="text-fg-muted hover:bg-bg-tertiary hover:text-fg rounded-md px-3 py-1.5 text-sm transition-colors"
              onClick={() => void logout()}
              type="button"
            >
              Sign out
            </button>
          </div>
        </header>
        <UsageBanner org={currentOrg} />
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </OrgCtx.Provider>
  )
}

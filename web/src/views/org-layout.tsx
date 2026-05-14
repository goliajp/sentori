import { useQueries, useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, useParams, useSearchParams } from 'react-router'

import { adminApi, orgsApi, teamsApi } from '@/api/client'
import { OrgCtx } from '@/auth/orgContext'
import { useAuth } from '@/auth/state'
import { CmdK } from '@/components/CmdK'
import { KeyboardCheatsheet } from '@/components/KeyboardCheatsheet'
import { Sidebar } from '@/components/sidebar'
import { StatusBar } from '@/components/status-bar'
import { useThemeEffect } from '@/components/theme'
import { Toolbar } from '@/components/toolbar'
import { UsageBanner } from '@/components/UsageBanner'
import { useGoToShortcuts } from '@/lib/go-to-shortcuts'

export function OrgLayout() {
  useThemeEffect()
  const { slug } = useParams()
  useGoToShortcuts(slug ?? '')
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
      {/*
       * Five-region shell — tasks.golia.jp shape:
       *   Toolbar (h-12, brand + search + theme)
       *   Sidebar + main (flex row)
       *   StatusBar (h-8, version + health + user/clock)
       */}
      <div className="flex h-full flex-col">
        <a className="skip-to-content" href="#sentori-main">
          Skip to content
        </a>
        <Toolbar />
        <div className="flex min-h-0 flex-1">
          <Sidebar
            currentOrg={currentOrg}
            currentProject={currentProject}
            currentTeamSlug={currentTeamSlug}
            onLogout={() => void logout()}
            orgs={orgs ?? []}
            teams={teams ?? []}
            user={user}
          />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            <UsageBanner org={currentOrg} />
            <main className="flex-1 overflow-y-auto" id="sentori-main">
              <Outlet />
            </main>
          </div>
        </div>
        <StatusBar />
      </div>
      <CmdK />
      <KeyboardCheatsheet />
    </OrgCtx.Provider>
  )
}

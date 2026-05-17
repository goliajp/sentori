import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams, useSearchParams } from 'react-router'

import { adminApi, orgsApi, teamsApi } from '@/api/client'
import { OrgCtx } from '@/auth/orgContext'
import { AppShell } from '@/layout/app-shell'

/**
 * Org-scoped layout — wraps every /org/:slug/* route. Loads the user's
 * orgs + projects + teams, resolves the current slug + the active
 * project (from the `?project=` query param), and serves `OrgCtx` to
 * all descendants. The actual chrome (Toolbar + Sidebar + StatusBar)
 * lives in <AppShell />.
 *
 * Project selection lives in the URL so:
 *   • the sidebar's project switcher's value follows the page
 *     (otherwise the <select> reverts to projects[0] on every render
 *     — the bug Insight saw where "the last three projects couldn't
 *     be selected")
 *   • a refresh / shared link keeps the same scope
 *   • per-page filters (Issues, Traces, Vitals, etc) auto-flow from
 *     the same source of truth
 */
export function OrgLayout() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()

  const orgsQ = useQuery({ queryFn: orgsApi.listMine, queryKey: ['orgs'] })
  const projectsQ = useQuery({ queryFn: adminApi.listProjects, queryKey: ['projects'] })
  const teamsQ = useQuery({
    enabled: !!slug,
    queryFn: () => teamsApi.list(slug!),
    queryKey: ['teams', slug],
  })

  if (orgsQ.isLoading || projectsQ.isLoading) {
    return (
      <div className="text-fg-muted t-md flex h-full items-center justify-center">Loading…</div>
    )
  }
  const currentOrg = orgsQ.data?.find((o) => o.slug === slug) ?? null
  if (!currentOrg) return <Navigate replace to="/" />
  const orgProjects = (projectsQ.data ?? []).filter((p) => p.orgSlug === slug)

  // Project selection: URL `?project=ID` is authoritative; falls back
  // to the first project when no query param or when the query points
  // at a project not in this org (e.g. user copied a link from a
  // different org).
  const wantedProjectId = searchParams.get('project')
  const currentProject =
    (wantedProjectId && orgProjects.find((p) => p.id === wantedProjectId)) || orgProjects[0] || null

  return (
    <OrgCtx.Provider
      value={{
        currentOrg,
        currentProject,
        currentTeamSlug: null,
        orgs: orgsQ.data ?? [],
        projects: orgProjects,
        teams: teamsQ.data ?? [],
      }}
    >
      <AppShell />
    </OrgCtx.Provider>
  )
}

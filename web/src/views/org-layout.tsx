import { useQuery } from '@tanstack/react-query'
import { Navigate, useParams } from 'react-router'

import { adminApi, orgsApi, teamsApi } from '@/api/client'
import { OrgCtx } from '@/auth/orgContext'
import { AppShell } from '@/layout/app-shell'

/**
 * Org-scoped layout — wraps every /org/:slug/* route. Loads the user's
 * orgs + projects + teams, resolves the current slug, and serves
 * `OrgCtx` to all descendants. The actual chrome (Toolbar + Sidebar +
 * StatusBar) lives in <AppShell />.
 */
export function OrgLayout() {
  const { slug } = useParams()

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
  const currentProject = orgProjects[0] ?? null

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

import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router'

import { adminApi, orgsApi } from '@/api/client'

/**
 * Authenticated landing page. Routing rules, in order:
 *   - no orgs              → /onboarding (create org)
 *   - first org no project → /onboarding (create project + SDK install)
 *   - otherwise            → /org/{firstSlug}/issues
 */
export function RootRedirect() {
  const orgsQuery = useQuery({ queryFn: orgsApi.listMine, queryKey: ['orgs'] })
  const projectsQuery = useQuery({
    queryFn: adminApi.listProjects,
    queryKey: ['projects'],
  })

  if (orgsQuery.isLoading || projectsQuery.isLoading) {
    return (
      <div className="text-fg-muted flex h-full items-center justify-center text-sm">Loading…</div>
    )
  }
  const orgs = orgsQuery.data ?? []
  if (orgs.length === 0) {
    return <Navigate replace to="/onboarding" />
  }
  const firstOrg = orgs[0]
  const orgProjects = (projectsQuery.data ?? []).filter((p) => p.orgSlug === firstOrg.slug)
  if (orgProjects.length === 0) {
    return <Navigate replace to="/onboarding" />
  }
  return <Navigate replace to={`/org/${firstOrg.slug}/issues`} />
}

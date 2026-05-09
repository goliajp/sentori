import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router'

import { orgsApi } from '@/api/client'

/**
 * Authenticated landing page. Looks up the user's first org and redirects
 * to its issues view; sends users with no orgs to the onboarding stub.
 */
export function RootRedirect() {
  const { data: orgs, isLoading } = useQuery({
    queryFn: orgsApi.listMine,
    queryKey: ['orgs'],
  })

  if (isLoading) {
    return (
      <div className="text-fg-muted flex h-full items-center justify-center text-sm">Loading…</div>
    )
  }
  if (!orgs || orgs.length === 0) {
    return <Navigate replace to="/onboarding" />
  }
  return <Navigate replace to={`/org/${orgs[0].slug}/issues`} />
}

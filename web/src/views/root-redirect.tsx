import { useQuery } from '@tanstack/react-query'
import { Navigate } from 'react-router'

import { orgsApi } from '@/api/client'

/**
 * After login, the root route redirects to the user's first org's
 * Overview. If they're in no org yet, send them to /onboarding.
 */
export function RootRedirect() {
  const { data, error, isLoading } = useQuery({
    queryFn: orgsApi.listMine,
    queryKey: ['orgs'],
  })

  if (isLoading) {
    return (
      <div className="text-fg-muted t-md flex h-full items-center justify-center">Loading…</div>
    )
  }
  if (error) return <Navigate replace to="/login" />

  const first = (data ?? [])[0]
  if (!first) return <Navigate replace to="/onboarding" />
  return <Navigate replace to={`/org/${first.slug}/overview`} />
}

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { adminApi, type ProjectRow } from '@/api/client'

/**
 * Phase 14 sub-C: red dot in the top nav when the active org's
 * onboarding isn't complete (no project, or project hasn't received
 * any events yet). Click → /onboarding picks back up.
 *
 * "Has the project received events" is approximated as
 * `listIssues(project, status:'any', limit:1).length > 0`. The
 * `status:'any'` is load-bearing — the server defaults to `'active'`,
 * which would make the badge re-appear the moment the user resolves
 * the only issue they have. Issues are only created by the ingest
 * path, so the existence of any issue (regardless of status) is a
 * stable "this project has been wired up" signal.
 */
export function OnboardingBadge({ project }: { project: null | ProjectRow }) {
  const { data: issues } = useQuery({
    enabled: !!project,
    queryFn: () => adminApi.listIssues(project!.id, { limit: 1, status: 'any' }),
    queryKey: ['onboarding-check', project?.id],
    refetchInterval: 60_000,
    staleTime: 60_000,
  })

  const noProject = !project
  const noEvents = !!project && (issues?.length ?? 0) === 0
  const pending = noProject || noEvents
  if (!pending) return null

  return (
    <Link
      className="border-border hover:border-accent/60 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px]"
      title={noProject ? 'Create your first project' : 'Send your first event'}
      to="/onboarding"
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-red-500" />
      <span className="text-fg-muted">Onboarding pending</span>
    </Link>
  )
}

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { adminApi, type RelatedIssue } from '@/api/client'

/**
 * Phase 47.01 — sibling issues likely to share root cause.
 *
 * Endpoint: same project, same `error_type`, ordered by `last_seen
 * DESC`, capped at 5. Rendered as a slim row underneath the issue
 * header so the user has one click to "is this the same bug?" without
 * leaving the page. Empty / loading states render nothing — no
 * skeletons because the panel sits adjacent to the StackTab and any
 * filler would push the actual content down.
 */
export function RelatedIssuesPanel({
  issueId,
  orgSlug,
  projectId,
}: {
  issueId: string
  orgSlug: string
  projectId: string
}) {
  const { data } = useQuery({
    enabled: !!issueId && !!projectId,
    queryFn: () => adminApi.listRelatedIssues(projectId, issueId),
    queryKey: ['related-issues', projectId, issueId],
    staleTime: 60_000,
  })

  if (!data || data.length === 0) return null

  return (
    <aside
      aria-label="Related issues"
      className="border-border bg-bg-tertiary/20 flex items-center gap-2 overflow-x-auto border-b px-6 py-2 text-[11px]"
    >
      <span className="text-fg-muted shrink-0 tracking-wider uppercase">Related</span>
      <ul className="flex shrink-0 flex-wrap gap-2">
        {data.map((it) => (
          <li key={it.id}>
            <RelatedIssueChip issue={it} orgSlug={orgSlug} />
          </li>
        ))}
      </ul>
    </aside>
  )
}

function RelatedIssueChip({ issue, orgSlug }: { issue: RelatedIssue; orgSlug: string }) {
  const muted =
    issue.status === 'resolved' || issue.status === 'closed' || issue.status === 'silenced'
  return (
    <Link
      className={`border-border hover:border-accent/60 inline-flex items-center gap-2 rounded-md border px-2 py-1 font-mono transition-colors ${
        muted ? 'text-fg-muted' : 'text-fg'
      }`}
      title={`${issue.errorType}: ${issue.messageSample} (${issue.status}, ${issue.eventCount} events)`}
      to={`/org/${orgSlug}/issues/${issue.id}`}
    >
      <span className="max-w-[260px] truncate">{issue.messageSample || issue.errorType}</span>
      <span className="text-fg-muted">·</span>
      <span className="text-fg-muted">{issue.eventCount}</span>
      {muted && (
        <span className="bg-bg-tertiary text-fg-muted ml-1 rounded px-1 py-[1px] text-[9px] uppercase">
          {issue.status}
        </span>
      )}
    </Link>
  )
}

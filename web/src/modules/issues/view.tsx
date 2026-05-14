import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { adminApi, type IssueRow, type IssueStatus } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { Tag } from '@/components/Tag'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'

const STATUS_TABS: { key: IssueStatus | 'all'; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'regressed', label: 'Regressed' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'silenced', label: 'Silenced' },
  { key: 'all', label: 'All' },
]

/**
 * Issues — real adminApi-backed list view, v2 design.
 *
 * Tabular layout via `.std-table` (single outer frame + hairline grid +
 * unified padding). Per row: level dot + plain mono short-id + truncated
 * title + colored status text + tabular event/user counts + mono release
 * + relative last-seen + @assignee.
 */
export function IssuesView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [tab, setTab] = useState<IssueStatus | 'all'>('active')

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    queryFn: () =>
      adminApi.listIssuesPage(projectId!, { limit: 100, status: tab === 'all' ? undefined : tab }),
    queryKey: ['issues', projectId, tab],
  })

  const issues = data?.issues ?? []
  const total = issues.length

  return (
    <div className="space-y-3">
      <PageHeader count={total} subtitle="Live error stream across projects" title="Issues" />

      <FilterBar current={tab} onChange={setTab} />

      {!projectId && (
        <Empty hint="Create a project in org settings to start ingesting." title="No project" />
      )}
      {projectId && isLoading && <SkeletonTable />}
      {projectId && error && (
        <Empty hint="Failed to load issues — check your network." title="Error" />
      )}
      {projectId && !isLoading && !error && issues.length === 0 && (
        <Empty
          hint={
            tab === 'active'
              ? 'Quiet right now. Fire an event from your SDK to see it here.'
              : 'No issues match this filter.'
          }
          title={`No ${tab} issues`}
        />
      )}

      {issues.length > 0 && (
        <div className="std-table border-border overflow-hidden rounded-md border">
          <table>
            <thead>
              <tr className="text-fg-muted t-sm tracking-wider uppercase">
                <th className="text-left font-medium">Issue</th>
                <th className="w-24 text-left font-medium">Status</th>
                <th className="w-20 text-right font-medium">Events</th>
                <th className="w-20 text-right font-medium">Users</th>
                <th className="w-40 text-left font-medium">Release</th>
                <th className="w-24 text-left font-medium">Last seen</th>
                <th className="w-32 text-left font-medium">Assignee</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((row) => (
                <IssueRowItem key={row.id} orgSlug={currentOrg.slug} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function IssueRowItem({ orgSlug, row }: { orgSlug: string; row: IssueRow }) {
  return (
    <tr className="hover:bg-bg-tertiary/40">
      <td>
        <Link className="flex min-w-0 items-center gap-2.5" to={`/org/${orgSlug}/issues/${row.id}`}>
          <LevelDot status={row.status} />
          <span className="text-fg-muted t-sm shrink-0 font-mono">{shortId(row.id)}</span>
          <span className="text-fg t-md min-w-0 flex-1 truncate font-semibold">
            {row.errorType}
            <span className="text-fg-muted ml-2 font-normal">{row.messageSample}</span>
          </span>
        </Link>
      </td>
      <td>
        <StatusText status={row.status} />
      </td>
      <td className="text-fg t-md text-right tabular-nums">{row.eventCount.toLocaleString()}</td>
      <td className="text-fg t-md text-right tabular-nums">
        {/* user_count not in IssueRow yet; backend will surface — fallback dash */}—
      </td>
      <td>
        {row.lastRelease ? (
          <span className="text-fg-muted t-md font-mono">{row.lastRelease}</span>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
      <td className="text-fg-muted t-md tabular-nums">{formatRelative(row.lastSeen)}</td>
      <td>
        {row.assigneeEmail ? (
          <span className="text-accent t-md">@{row.assigneeEmail.split('@')[0]}</span>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </td>
    </tr>
  )
}

function FilterBar({
  current,
  onChange,
}: {
  current: IssueStatus | 'all'
  onChange: (k: IssueStatus | 'all') => void
}) {
  return (
    <div className="border-border bg-bg-tertiary/40 t-md flex flex-wrap items-center gap-2 rounded-md border px-3 py-2">
      <span className="text-fg-muted">视图</span>
      <div className="flex items-center gap-1">
        {STATUS_TABS.map((t) => {
          const active = t.key === current
          return (
            <button
              className="cursor-pointer"
              key={t.key}
              onClick={() => onChange(t.key)}
              type="button"
            >
              <Tag variant={active ? 'accent' : 'default'}>
                <span className={active ? 'text-fg' : ''}>{t.label}</span>
              </Tag>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StatusText({ status }: { status: IssueStatus }) {
  const cls =
    status === 'active'
      ? 'text-success font-medium'
      : status === 'regressed'
        ? 'text-danger font-medium'
        : status === 'closed'
          ? 'text-fg'
          : 'text-fg-muted'
  return <span className={`t-md ${cls}`}>{status}</span>
}

function LevelDot({ status }: { status: IssueStatus }) {
  const cls =
    status === 'regressed'
      ? 'bg-danger'
      : status === 'active'
        ? 'bg-danger/70'
        : status === 'resolved'
          ? 'bg-success'
          : 'bg-fg-muted/50'
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${cls}`} title={status} />
}

function Empty({ hint, title }: { hint: string; title: string }) {
  return (
    <div className="border-border bg-bg-secondary/30 rounded-md border px-6 py-12 text-center">
      <div className="text-fg-muted t-sm mb-1 font-semibold tracking-wider uppercase">{title}</div>
      <div className="text-fg t-md">{hint}</div>
    </div>
  )
}

function SkeletonTable() {
  return (
    <div className="std-table border-border overflow-hidden rounded-md border">
      <div className="bg-bg-secondary/30 h-9" />
      {Array.from({ length: 6 }).map((_, i) => (
        <div className="border-border/60 h-10 animate-pulse border-t" key={i} />
      ))}
    </div>
  )
}

function shortId(id: string): string {
  // Server ids are uuids; trim to 8 chars for the row prefix.
  return id.replace(/-/g, '').slice(0, 8).toUpperCase()
}

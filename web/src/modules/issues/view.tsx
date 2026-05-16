import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useParams } from 'react-router'

import { adminApi, type IssueRow, type IssueStatus } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { Tag } from '@/components/Tag'
import { formatRelative } from '@/lib/format'
import { useUrlParam } from '@/lib/url-state'

type Tab = IssueStatus | 'all'

const STATUS_TABS: { key: Tab; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'regressed', label: 'Regressed' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'silenced', label: 'Silenced' },
  { key: 'all', label: 'All' },
]
const TAB_KEYS = new Set<Tab>(['active', 'regressed', 'resolved', 'silenced', 'all'])

/**
 * Issues — master/detail layout.
 *
 *   ┌──────────┬─────────────────────────────────┐
 *   │ rail     │  detail (Outlet)                │
 *   │ filter   │                                 │
 *   │ ───────  │  • If `:issueId` → IssueDetail  │
 *   │ ▪ row    │  • Else            → placeholder │
 *   │ ▪ row    │                                 │
 *   │ …        │                                 │
 *   └──────────┴─────────────────────────────────┘
 *
 * The rail width is fixed (w-96, ~24rem). Rows are 1-3 visual lines
 * so the rail reads like a mail client — title row + message row +
 * optional meta row. Selected row is highlighted with the accent.
 *
 * URL state:
 *   `?status=` — active filter tab (default 'active')
 *   `:issueId` — selected issue. When present the detail pane
 *                renders via `<Outlet />`; otherwise the rail-empty
 *                placeholder shows.
 */
export function IssuesView() {
  const { currentProject } = useOrg()
  const { issueId } = useParams<{ issueId?: string }>()
  const projectId = currentProject?.id ?? null
  const [tab, setTab] = useUrlParam<Tab>('status', 'active', (raw) =>
    TAB_KEYS.has(raw as Tab) ? (raw as Tab) : null
  )

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    queryFn: () =>
      adminApi.listIssuesPage(projectId!, { limit: 100, status: tab === 'all' ? undefined : tab }),
    queryKey: ['issues', projectId, tab],
  })

  const issues = data?.issues ?? []

  return (
    // -mx-4 -my-3 + h-[calc(100%+1.5rem)] reach past <main>'s
    // px-4 py-3 wrapper so the rail bleeds into the sidebar column
    // and the detail panel reaches the right viewport edge. Single
    // vertical divider between them, no gap, no rounded corners —
    // matches the "tasks.golia.jp"-style fixed master-detail shape.
    <div className="-mx-4 -my-3 flex h-[calc(100%+1.5rem)] min-h-0 overflow-hidden">
      <aside className="border-border bg-bg-secondary/20 flex w-96 shrink-0 flex-col overflow-hidden border-r">
        <RailHeader count={issues.length} current={tab} onChange={setTab} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!projectId && <RailEmpty hint="Create a project in org settings to start ingesting." />}
          {projectId && isLoading && <RailSkeleton />}
          {projectId && error && <RailEmpty hint="Failed to load — check your network." />}
          {projectId && !isLoading && !error && issues.length === 0 && (
            <RailEmpty
              hint={
                tab === 'active'
                  ? 'Quiet right now. Fire an event from your SDK to see it here.'
                  : 'No issues match this filter.'
              }
            />
          )}
          {issues.map((row) => (
            <RailRow key={row.id} row={row} selected={row.id === issueId} />
          ))}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto">
        {issueId ? (
          <div className="p-4">
            <Outlet />
          </div>
        ) : (
          <DetailPlaceholder />
        )}
      </section>
    </div>
  )
}

function RailHeader({
  count,
  current,
  onChange,
}: {
  count: number
  current: Tab
  onChange: (k: Tab) => void
}) {
  return (
    <header className="border-border shrink-0 border-b p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h1 className="text-fg t-lg font-semibold">Issues</h1>
        <span className="text-fg-muted t-sm tabular-nums">{count}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
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
    </header>
  )
}

function RailRow({ row, selected }: { row: IssueRow; selected: boolean }) {
  const { currentOrg } = useOrg()
  return (
    <Link
      className={`border-border/40 block border-b px-3 py-2 transition-colors ${
        selected ? 'bg-accent/10' : 'hover:bg-bg-tertiary/50'
      }`}
      to={`/org/${currentOrg.slug}/issues/${row.id}`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <LevelDot status={row.status} />
        <span className="text-fg t-md min-w-0 flex-1 truncate font-semibold">{row.errorType}</span>
        <StatusText status={row.status} />
      </div>
      <div className="text-fg-muted t-md mt-0.5 line-clamp-1">
        {displayMessage(row.messageSample)}
      </div>
      <div className="text-fg-muted t-sm mt-1 flex items-center gap-2">
        <span className="tabular-nums">{row.eventCount.toLocaleString()} ev</span>
        <span className="opacity-40">·</span>
        <span className="tabular-nums">{formatRelative(row.lastSeen)}</span>
        {row.lastRelease && (
          <>
            <span className="opacity-40">·</span>
            <span className="truncate font-mono">{row.lastRelease}</span>
          </>
        )}
        {row.assigneeEmail && (
          <span className="text-accent ml-auto shrink-0">@{row.assigneeEmail.split('@')[0]}</span>
        )}
      </div>
    </Link>
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
  return <span className={`t-sm shrink-0 ${cls}`}>{status}</span>
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

function RailEmpty({ hint }: { hint: string }) {
  return (
    <div className="text-fg-muted t-md p-6 text-center">
      <div className="t-sm mb-1 font-semibold tracking-wider uppercase">Empty</div>
      <div>{hint}</div>
    </div>
  )
}

function RailSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div className="border-border/40 h-16 animate-pulse border-b" key={i} />
      ))}
    </div>
  )
}

function DetailPlaceholder() {
  return (
    <div className="text-fg-muted flex h-full items-center justify-center">
      <div className="t-md text-center">
        <div className="t-sm mb-1 font-semibold tracking-wider uppercase">No issue selected</div>
        <div>Pick a row on the left to see its stack, events and breadcrumbs here.</div>
      </div>
    </div>
  )
}

/**
 * Pre-coerceError events (shipped before the SDK fix) carry the literal
 * string `[object Object]` as their message. Replace it with a more
 * honest placeholder so the row reads sensibly. New events go through
 * `coerceError` in the SDK and never look like this.
 */
function displayMessage(message: string): string {
  if (message === '[object Object]') return '(non-Error thrown — SDK upgrade required)'
  return message
}

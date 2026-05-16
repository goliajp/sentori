import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useParams } from 'react-router'

import { adminApi, type IssueRow, type IssueStatus } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'
import { useUrlParam } from '@/lib/url-state'

type Tab = IssueStatus | 'all'

const STATUS_TABS: { key: Tab; label: string }[] = [
  { key: 'active', label: 'active' },
  { key: 'regressed', label: 'regressed' },
  { key: 'resolved', label: 'resolved' },
  { key: 'silenced', label: 'silenced' },
  { key: 'all', label: 'all' },
]
const TAB_KEYS = new Set<Tab>(['active', 'regressed', 'resolved', 'silenced', 'all'])

/**
 * Issues — master/detail layout, editorial chrome.
 *
 *   ┌──────────┬─────────────────────────────────┐
 *   │ rail     │  detail (Outlet)                │
 *   │ filter   │                                 │
 *   │ ◾ row    │  • If `:issueId` → IssueDetail  │
 *   │ ◾ row    │  • Else            → splash     │
 *   └──────────┴─────────────────────────────────┘
 *
 * Rail uses paper-2 surface + hairline border-r against the main pane
 * (no card frame). Rows are rule-soft separated, hover paints
 * accent-soft. Selected row carries a left tora strip.
 *
 * URL state:
 *   `?status=`  active filter tab (default 'active')
 *   `:issueId`  selected issue. When present the detail pane renders
 *               via `<Outlet />`; otherwise the rail-empty placeholder.
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
    <div className="-mx-4 -my-3 flex h-[calc(100%+1.5rem)] min-h-0 overflow-hidden bg-[color:var(--paper)]">
      <aside className="flex w-[22rem] shrink-0 flex-col overflow-hidden border-r border-[color:var(--rule)] bg-[color:var(--paper-2)]">
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

      <section className="min-w-0 flex-1 overflow-y-auto bg-[color:var(--paper)]">
        {issueId ? (
          <div className="p-6">
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
    <header className="shrink-0 border-b border-[color:var(--rule)] px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h1
          className="text-[color:var(--ink)]"
          style={{
            fontFamily: 'var(--font-sans)',
            fontVariationSettings: "'wdth' 95, 'opsz' 24, 'wght' 550",
            fontSize: '17px',
            letterSpacing: '-0.01em',
          }}
        >
          Issues
        </h1>
        <span className="font-mono text-[11px] text-[color:var(--ink-muted)] tabular-nums">
          {count.toLocaleString()}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {STATUS_TABS.map((t) => {
          const active = t.key === current
          return (
            <button
              className={`cursor-pointer font-mono text-[11px] tracking-[0.08em] uppercase transition-colors ${
                active
                  ? 'text-[color:var(--accent)]'
                  : 'text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]'
              }`}
              key={t.key}
              onClick={() => onChange(t.key)}
              type="button"
            >
              {t.label}
              {active && <span className="ml-1 text-[color:var(--accent)]">·</span>}
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
      className={`group relative block border-b border-[color:var(--rule-soft)] px-4 py-3 transition-colors ${
        selected ? 'bg-[color:var(--accent-soft)]' : 'hover:bg-[color:var(--paper)]'
      }`}
      to={`/org/${currentOrg.slug}/issues/${row.id}`}
    >
      {/* Active left accent strip. */}
      <span
        aria-hidden
        className={`absolute top-0 bottom-0 left-0 w-[2px] ${
          selected ? 'bg-[color:var(--accent)]' : 'bg-transparent'
        }`}
      />
      <div className="flex min-w-0 items-baseline gap-2">
        <span
          className="min-w-0 flex-1 truncate font-sans text-[13px] text-[color:var(--ink)]"
          style={{ fontVariationSettings: "'wdth' 100, 'opsz' 14, 'wght' 550" }}
        >
          {row.errorType}
        </span>
        <StatusTag status={row.status} />
      </div>
      <div className="mt-0.5 line-clamp-1 text-[12px] text-[color:var(--ink-soft)]">
        {displayMessage(row.messageSample)}
      </div>
      <div className="mt-2 flex items-center gap-2.5 font-mono text-[10px] tracking-[0.05em] text-[color:var(--ink-muted)]">
        <span className="tabular-nums">{row.eventCount.toLocaleString()} ev</span>
        <span aria-hidden className="opacity-40">
          /
        </span>
        <span className="tabular-nums">{formatRelative(row.lastSeen)}</span>
        {row.lastRelease && (
          <>
            <span aria-hidden className="opacity-40">
              /
            </span>
            <span className="truncate">{row.lastRelease}</span>
          </>
        )}
        {row.assigneeEmail && (
          <span className="ml-auto shrink-0 text-[color:var(--accent)]">
            @{row.assigneeEmail.split('@')[0]}
          </span>
        )}
      </div>
    </Link>
  )
}

function StatusTag({ status }: { status: IssueStatus }) {
  // Status maps to ink-scale + accent for regressed (the one that
  // wants the eye). active = mid ink, resolved = muted, silenced =
  // muted. The accent is reserved for the only "this is hot" state.
  const cls =
    status === 'regressed'
      ? 'text-[color:var(--accent)]'
      : status === 'active'
        ? 'text-[color:var(--ink)]'
        : 'text-[color:var(--ink-muted)]'
  return (
    <span className={`shrink-0 font-mono text-[10px] tracking-[0.18em] uppercase ${cls}`}>
      {status}
    </span>
  )
}

function RailEmpty({ hint }: { hint: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <div className="mb-2 font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
        empty
      </div>
      <div className="mx-auto max-w-[28ch] text-[13px] leading-relaxed text-[color:var(--ink-soft)]">
        {hint}
      </div>
    </div>
  )
}

function RailSkeleton() {
  return (
    <div>
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          className="sentori-skeleton h-[68px] border-b border-[color:var(--rule-soft)]"
          key={i}
        />
      ))}
    </div>
  )
}

function DetailPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mb-3 font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
          no issue selected
        </div>
        <div
          className="mb-3 text-[color:var(--ink)]"
          style={{
            fontFamily: 'var(--font-sans)',
            fontVariationSettings: "'wdth' 95, 'opsz' 24, 'wght' 550",
            fontSize: '22px',
            letterSpacing: '-0.01em',
          }}
        >
          Pick a row on the left.
        </div>
        <div className="text-[13px] text-[color:var(--ink-soft)]">
          Stack trace, events, breadcrumbs and the screenshot debug center live in this pane.
        </div>
      </div>
    </div>
  )
}

/**
 * Pre-coerceError events (shipped before the SDK fix) carry the
 * literal `[object Object]` as their message. Surface that as an
 * actionable hint rather than a confusing placeholder.
 */
function displayMessage(message: string): string {
  if (message === '[object Object]') return '(non-Error thrown — SDK upgrade required)'
  return message
}

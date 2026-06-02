import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useParams } from 'react-router'

import { adminApi, type IssueRow, type IssueStatus } from '@/api/client'
import { RailEmpty } from '@/components/Hint'
import { LabelChip, PriorityChip } from './triage-chips'
// `qk` import removed in v2.2 W5 — IssuesView's query key is now
// an inline literal that includes all the filter params. Other
// modules still use the central `qk` registry.
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'
import { useUrlParam } from '@/lib/url-state'

type Tab = IssueStatus | 'all'

const STATUS_TABS: { key: Tab; label: string }[] = [
  { key: 'active', label: 'active' },
  { key: 'regressed', label: 'regressed' },
  { key: 'muted', label: 'muted' },
  { key: 'resolved', label: 'resolved' },
  { key: 'silenced', label: 'silenced' },
  { key: 'all', label: 'all' },
]
const TAB_KEYS = new Set<Tab>(['active', 'regressed', 'muted', 'resolved', 'silenced', 'all'])

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
  // v2.2 — Issues is the universal "filter-able list of issues"
  // view. Other modules (Releases, Related-across-releases) deep-
  // link in via these URL params; refreshing / sharing preserves
  // the slice. Each filter has a clear "× remove" chip at the top
  // of the rail so the operator can see + zero them out.
  const [releaseFilter, setReleaseFilter] = useUrlParam<string>('release', '')
  const [errorTypeFilter, setErrorTypeFilter] = useUrlParam<string>('errorType', '')
  const [envFilter, setEnvFilter] = useUrlParam<string>('env', '')
  const [searchFilter, setSearchFilter] = useUrlParam<string>('q', '')

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    queryFn: () =>
      adminApi.listIssuesPage(projectId!, {
        limit: 100,
        status: tab === 'all' ? undefined : tab,
        ...(releaseFilter ? { release: releaseFilter } : {}),
        ...(errorTypeFilter ? { errorType: errorTypeFilter } : {}),
        ...(envFilter ? { env: envFilter } : {}),
        ...(searchFilter ? { search: searchFilter } : {}),
      }),
    queryKey: [
      'issues-list',
      projectId,
      tab,
      releaseFilter,
      errorTypeFilter,
      envFilter,
      searchFilter,
    ],
  })

  const issues = data?.issues ?? []

  const activeFilters: FilterChip[] = []
  if (releaseFilter)
    activeFilters.push({
      label: 'release',
      onClear: () => setReleaseFilter(''),
      value: releaseFilter,
    })
  if (errorTypeFilter)
    activeFilters.push({
      label: 'type',
      onClear: () => setErrorTypeFilter(''),
      value: errorTypeFilter,
    })
  if (envFilter)
    activeFilters.push({
      label: 'env',
      onClear: () => setEnvFilter(''),
      value: envFilter,
    })
  if (searchFilter)
    activeFilters.push({
      label: 'search',
      onClear: () => setSearchFilter(''),
      value: searchFilter,
    })

  return (
    <div className="-mx-4 -my-3 flex h-[calc(100%+1.5rem)] min-h-0 overflow-hidden bg-[color:var(--paper)]">
      <aside className="flex w-[22rem] shrink-0 flex-col overflow-hidden border-r border-[color:var(--rule)] bg-[color:var(--paper-2)]">
        <RailHeader count={issues.length} current={tab} onChange={setTab} />
        {activeFilters.length > 0 && <FilterChips filters={activeFilters} />}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!projectId && (
            <RailEmpty>Create a project in org settings to start ingesting.</RailEmpty>
          )}
          {projectId && isLoading && <RailSkeleton />}
          {projectId && error && <RailEmpty>Failed to load — check your network.</RailEmpty>}
          {projectId && !isLoading && !error && issues.length === 0 && (
            <RailEmpty>
              {activeFilters.length > 0
                ? 'No issues match these filters. Try clearing one or more.'
                : tab === 'active'
                  ? 'Quiet right now. Fire an event from your SDK to see it here.'
                  : 'No issues match this filter.'}
            </RailEmpty>
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

type FilterChip = { label: string; value: string; onClear: () => void }

/**
 * v2.2 — active filter chips at the rail top. Each chip shows
 * "label: value × " and removes that filter on click. Hidden when
 * no filters are active.
 */
function FilterChips({ filters }: { filters: FilterChip[] }) {
  return (
    <div className="shrink-0 border-b border-[color:var(--rule-soft)] px-4 py-2">
      <div className="mb-1 font-mono text-[9px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
        filters
      </div>
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <span
            className="inline-flex items-center gap-1.5 border border-[color:var(--rule)] bg-[color:var(--paper)] px-2 py-0.5 font-mono text-[10px] text-[color:var(--ink-soft)]"
            key={f.label + f.value}
          >
            <span className="text-[color:var(--ink-muted)]">{f.label}:</span>
            <span className="max-w-[14em] truncate text-[color:var(--ink)]">{f.value}</span>
            <button
              aria-label={`clear ${f.label} filter`}
              className="text-[color:var(--ink-muted)] hover:text-[color:var(--danger)]"
              onClick={f.onClear}
              type="button"
            >
              ×
            </button>
          </span>
        ))}
      </div>
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
      to={`/main/org/${currentOrg.slug}/issues/${row.id}`}
    >
      {/* Active left accent strip. */}
      <span
        aria-hidden
        className={`absolute top-0 bottom-0 left-0 w-[2px] ${
          selected ? 'bg-[color:var(--accent)]' : 'bg-transparent'
        }`}
      />
      <div className="flex min-w-0 items-baseline gap-2">
        {row.priority !== 'p3' && <PriorityChip priority={row.priority} />}
        {/* v2.0 — distinguish manual `captureMessage` events from
         *  error/anr/nearCrash events. The server synthesises
         *  `errorType = 'Message'` for kind=message issues, so the
         *  client can render a different icon without a new field. */}
        {row.errorType === 'Message' && (
          <span
            aria-hidden
            className="text-[12px] text-[color:var(--ink-muted)]"
            title="Manual report (captureMessage)"
          >
            💬
          </span>
        )}
        <span
          className="min-w-0 flex-1 truncate font-sans text-[13px] text-[color:var(--ink)]"
          style={{ fontVariationSettings: "'wdth' 100, 'opsz' 14, 'wght' 550" }}
        >
          {row.errorType === 'Message' ? displayMessage(row.messageSample) : row.errorType}
        </span>
        <StatusTag status={row.status} />
      </div>
      {/* Subtitle: the message body. For manual `captureMessage`
       *  events the title already shows the body, so skip the
       *  redundant subtitle to keep the row compact. */}
      {row.errorType !== 'Message' && (
        <div className="mt-0.5 line-clamp-1 text-[12px] text-[color:var(--ink-soft)]">
          {displayMessage(row.messageSample)}
        </div>
      )}
      {row.labels.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {row.labels.slice(0, 3).map((l) => (
            <LabelChip key={l} label={l} />
          ))}
          {row.labels.length > 3 && (
            <span className="font-mono text-[10px] tracking-wider text-[color:var(--ink-muted)] uppercase">
              +{row.labels.length - 3}
            </span>
          )}
        </div>
      )}
      {/* Compact meta row — each atomic unit (`25 ev`, `14h`, assignee)
       *  is non-breakable so the rail's narrow column can't split a
       *  number off its unit ("25" \n "ev"). */}
      <div className="mt-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.05em] whitespace-nowrap text-[color:var(--ink-muted)]">
        <span className="tabular-nums">{row.eventCount.toLocaleString()} ev</span>
        <span aria-hidden className="opacity-40">
          ·
        </span>
        <span className="tabular-nums">{formatRelative(row.lastSeen)}</span>
        {row.assigneeEmail && (
          <span className="ml-auto truncate text-[color:var(--accent)]">
            @{row.assigneeEmail.split('@')[0]}
          </span>
        )}
      </div>
      {/* Release on its own line — it's the longest field and the most
       *  expendable; let it own a full-width truncation row so it
       *  never elbows the meta numbers into pieces. */}
      {row.lastRelease && (
        <div className="mt-0.5 truncate font-mono text-[10px] tracking-[0.05em] text-[color:var(--ink-muted)] opacity-80">
          {row.lastRelease}
        </div>
      )}
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

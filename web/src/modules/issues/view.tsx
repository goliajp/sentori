import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useParams } from 'react-router'

import {
  type ExploreReq,
  type ExploreResp,
  type ExploreRow,
  type IssueStatus,
  adminApi,
} from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { RailEmpty } from '@/components/Hint'
import { Sparkline } from '@/components/Sparkline'
import { formatRelative } from '@/lib/format'
import { useUrlParam } from '@/lib/url-state'

import { LabelChip, PriorityChip } from './triage-chips'

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

// v2.2 W3 — measure picker for the /explore consumer path.
type Measure = 'event_count' | 'first_seen' | 'last_seen' | 'unique_users'
const MEASURES: { key: Measure; label: string }[] = [
  { key: 'event_count', label: 'events' },
  { key: 'unique_users', label: 'users' },
  { key: 'last_seen', label: 'last seen' },
  { key: 'first_seen', label: 'first seen' },
]
const MEASURE_KEYS = new Set<Measure>(['event_count', 'unique_users', 'last_seen', 'first_seen'])

type WindowKey = '1d' | '7d' | '30d' | 'all'
const WINDOWS: WindowKey[] = ['1d', '7d', '30d', 'all']
const WINDOW_KEYS = new Set<WindowKey>(['1d', '7d', '30d', 'all'])

function windowGteRfc3339(w: WindowKey): string | undefined {
  if (w === 'all') return undefined
  const days = w === '1d' ? 1 : w === '7d' ? 7 : 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

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
 *   `?status=`    active filter tab (default 'active')
 *   `?measure=`   v2.2 sort dim (default 'event_count')
 *   `?window=`    v2.2 time window (default '7d')
 *   `?release=`   slice by release
 *   `?errorType=` slice by error type (Sentori kind)
 *   `?env=`       slice by environment
 *   `?q=`         client-side search across error_type + message_sample
 *   `:issueId`    selected issue. When present the detail pane renders
 *                 via `<Outlet />`; otherwise the rail-empty placeholder.
 */
export function IssuesView() {
  const { currentProject } = useOrg()
  const { issueId } = useParams<{ issueId?: string }>()
  const projectId = currentProject?.id ?? null

  const [tab, setTab] = useUrlParam<Tab>('status', 'active', (raw) =>
    TAB_KEYS.has(raw as Tab) ? (raw as Tab) : null
  )
  const [measure, setMeasure] = useUrlParam<Measure>('measure', 'event_count', (raw) =>
    MEASURE_KEYS.has(raw as Measure) ? (raw as Measure) : null
  )
  const [windowKey, setWindowKey] = useUrlParam<WindowKey>('window', '7d', (raw) =>
    WINDOW_KEYS.has(raw as WindowKey) ? (raw as WindowKey) : null
  )

  // Cross-module deep-link filters. Other modules (Releases, Related)
  // link in via these URL params; refreshing / sharing preserves the
  // slice. Each filter has a clear "× remove" chip at the top of the
  // rail so the operator can see + zero them out.
  const [releaseFilter, setReleaseFilter] = useUrlParam<string>('release', '')
  const [errorTypeFilter, setErrorTypeFilter] = useUrlParam<string>('errorType', '')
  const [envFilter, setEnvFilter] = useUrlParam<string>('env', '')
  const [searchFilter, setSearchFilter] = useUrlParam<string>('q', '')

  const { error, isLoading, meta, rows } = useIssuesRail({
    envFilter,
    errorTypeFilter,
    measure,
    projectId,
    releaseFilter,
    searchFilter,
    tab,
    windowKey,
  })

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
        <RailHeader
          count={rows.length}
          current={tab}
          measure={measure}
          meta={meta}
          onChangeMeasure={setMeasure}
          onChangeTab={setTab}
          onChangeWindow={setWindowKey}
          windowKey={windowKey}
        />
        {activeFilters.length > 0 && <FilterChips filters={activeFilters} />}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {!projectId && (
            <RailEmpty>Create a project in org settings to start ingesting.</RailEmpty>
          )}
          {projectId && isLoading && <RailSkeleton />}
          {projectId && !!error && <RailEmpty>Failed to load — check your network.</RailEmpty>}
          {projectId && !isLoading && !error && rows.length === 0 && (
            <RailEmpty>
              {activeFilters.length > 0
                ? 'No issues match these filters. Try clearing one or more.'
                : tab === 'active'
                  ? 'Quiet right now. Fire an event from your SDK to see it here.'
                  : 'No issues match this filter.'}
            </RailEmpty>
          )}
          {rows.map((row) => (
            <RailRow
              key={row.id}
              projectId={projectId}
              row={row}
              selected={row.id === issueId}
              windowKey={windowKey}
            />
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

// ── data hook ───────────────────────────────────────────────────────────────

/**
 * Normalised row shape rendered by `RailRow`. Maps onto the v2.2
 * `/explore` `dim=issue` projection (`issue_id` / `error_type` /
 * `message_sample` / `last_release` / `status` + the requested
 * measures). Fields not in that projection (`priority`, `labels`,
 * `assigneeEmail`) stay typed optional — the row component
 * gracefully omits them — so adding them to `/explore` later is
 * additive without touching the UI.
 *
 * Issue detail (`detail-view.tsx`) re-fetches the full `IssueRow`
 * via `adminApi.issueDetail`, so this slim shape only has to drive
 * the rail row, not power the detail screen.
 */
type RailIssueRow = {
  id: string
  errorType: string
  messageSample: string
  status: IssueStatus
  eventCount: number
  lastSeen: string
  lastRelease: null | string
  priority?: 'p0' | 'p1' | 'p2' | 'p3'
  labels?: string[]
  assigneeEmail?: null | string
}

type RailMeta = null | {
  tookMs?: number
  windowGte?: string
}

function useIssuesRail(params: {
  envFilter: string
  errorTypeFilter: string
  measure: Measure
  projectId: null | string
  releaseFilter: string
  searchFilter: string
  tab: Tab
  windowKey: WindowKey
}): {
  error: unknown
  isLoading: boolean
  meta: RailMeta
  rows: RailIssueRow[]
} {
  const {
    envFilter,
    errorTypeFilter,
    measure,
    projectId,
    releaseFilter,
    searchFilter,
    tab,
    windowKey,
  } = params

  const windowGte = windowGteRfc3339(windowKey)
  const exploreReq: ExploreReq = {
    dim: 'issue',
    filters: {
      ...(envFilter ? { environmentEq: envFilter } : {}),
      ...(errorTypeFilter ? { kindIn: [errorTypeFilter] } : {}),
      ...(releaseFilter ? { releaseEq: releaseFilter } : {}),
      ...(tab === 'all' ? {} : { statusIn: [tab] }),
      ...(windowGte ? { receivedAtGte: windowGte } : {}),
      // v2.3 — server-side fuzzy match against issues.error_type +
      // issues.message_sample. Replaces the v2.2 W3 client-side
      // search stub. Empty string acts as no filter.
      ...(searchFilter ? { search: searchFilter } : {}),
    },
    limit: 100,
    measures: ['event_count', 'unique_users', 'first_seen', 'last_seen'],
    orderBy: measure,
    orderDir: 'desc',
  }
  const exploreQ = useQuery<ExploreResp>({
    enabled: !!projectId,
    queryFn: () => adminApi.explore(projectId!, exploreReq),
    queryKey: qk.exploreIssues(
      projectId,
      measure,
      windowKey,
      tab,
      releaseFilter,
      errorTypeFilter,
      envFilter,
      searchFilter
    ),
  })

  const exploreRows = exploreQ.data?.rows ?? []
  const rows = exploreRows.map(normaliseExplore).filter(Boolean) as RailIssueRow[]
  return {
    error: exploreQ.error,
    isLoading: exploreQ.isLoading,
    meta: {
      tookMs: exploreQ.data?.meta.tookMs,
      windowGte,
    },
    rows,
  }
}

/** Project one /explore `dim=issue` row into the rail shape. Falls
 *  back to safe defaults on missing fields — the server always emits
 *  `issue_id`, `error_type`, `message_sample`, `last_release`,
 *  `status` and the requested measures (see explore.rs
 *  `project_issue_row`), so the only nulls are absent timestamps. */
function normaliseExplore(r: ExploreRow): null | RailIssueRow {
  const id = pickString(r.issue_id)
  if (!id) return null
  return {
    errorType: pickString(r.error_type) ?? '',
    eventCount: pickNumber(r.event_count),
    id,
    lastRelease: pickString(r.last_release) || null,
    lastSeen: pickString(r.last_seen) ?? '',
    messageSample: pickString(r.message_sample) ?? '',
    status: (pickString(r.status) as IssueStatus) ?? 'active',
  }
}

function pickString(v: ExploreRow[string]): null | string {
  return typeof v === 'string' ? v : null
}
function pickNumber(v: ExploreRow[string]): number {
  return typeof v === 'number' ? v : 0
}

/**
 * v2.3 — per-row sparkline. Issues the same `/explore` endpoint with
 * `dim=time_bucket` + `issueEq=<issueId>` so the result is the row's
 * event count bucketed inside the active window. The sparkline data
 * is `staleTime: 30_000` so navigating around the dashboard doesn't
 * re-fetch every visible row's chart on each render.
 *
 * Returns the values array directly (empty during load) so the
 * caller can hand it straight to `<Sparkline values={...} />`. Per
 * RailRow uses one of these hooks — React Query batches the calls
 * naturally; with `limit=100` rows in the rail and ~50 ms server
 * latency the full batch typically lands < 500 ms wall-clock.
 */
function useIssueSparkline(
  projectId: null | string,
  issueId: string,
  windowKey: WindowKey
): number[] {
  const windowGte = windowGteRfc3339(windowKey)
  const sparkReq: ExploreReq = {
    dim: 'time_bucket',
    filters: {
      issueEq: issueId,
      ...(windowGte ? { receivedAtGte: windowGte } : {}),
    },
    limit: 200,
    measures: ['event_count'],
  }
  const q = useQuery<ExploreResp>({
    enabled: !!projectId,
    queryFn: () => adminApi.explore(projectId!, sparkReq),
    queryKey: qk.exploreIssueSparkline(projectId, issueId, windowKey),
    staleTime: 30_000,
  })
  if (!q.data) return []
  return q.data.rows.map((r) => pickNumber(r.event_count))
}

// ── rail components ─────────────────────────────────────────────────────────

type FilterChip = { label: string; onClear: () => void; value: string }

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
  measure,
  meta,
  onChangeMeasure,
  onChangeTab,
  onChangeWindow,
  windowKey,
}: {
  count: number
  current: Tab
  measure: Measure
  meta: RailMeta
  onChangeMeasure: (m: Measure) => void
  onChangeTab: (k: Tab) => void
  onChangeWindow: (w: WindowKey) => void
  windowKey: WindowKey
}) {
  return (
    <header className="shrink-0 border-b border-[color:var(--rule)] px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h1
          className="text-[color:var(--ink)]"
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '17px',
            fontVariationSettings: "'wdth' 95, 'opsz' 24, 'wght' 550",
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
              onClick={() => onChangeTab(t.key)}
              type="button"
            >
              {t.label}
              {active && <span className="ml-1 text-[color:var(--accent)]">·</span>}
            </button>
          )
        })}
      </div>
      {/* v2.2 picker bar — measure + window. */}
      <div className="mt-3 flex flex-wrap items-baseline gap-3 font-mono text-[10px] tracking-[0.1em] uppercase">
        <span className="text-[color:var(--ink-muted)]">sort</span>
        <div className="flex flex-wrap items-baseline gap-2">
          {MEASURES.map((m, i) => (
            <span className="flex items-baseline gap-2" key={m.key}>
              {i > 0 && <span className="text-[color:var(--rule)]">/</span>}
              <button
                className={
                  m.key === measure
                    ? 'text-[color:var(--accent)]'
                    : 'text-[color:var(--ink-muted)] hover:text-[color:var(--ink-soft)]'
                }
                onClick={() => onChangeMeasure(m.key)}
                type="button"
              >
                {m.label}
              </button>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-3 font-mono text-[10px] tracking-[0.1em] uppercase">
        <span className="text-[color:var(--ink-muted)]">window</span>
        <div className="flex flex-wrap items-baseline gap-2">
          {WINDOWS.map((w, i) => (
            <span className="flex items-baseline gap-2" key={w}>
              {i > 0 && <span className="text-[color:var(--rule)]">/</span>}
              <button
                className={
                  w === windowKey
                    ? 'text-[color:var(--accent)]'
                    : 'text-[color:var(--ink-muted)] hover:text-[color:var(--ink-soft)]'
                }
                onClick={() => onChangeWindow(w)}
                type="button"
              >
                {w}
              </button>
            </span>
          ))}
        </div>
      </div>
      {/* Footer — explore round-trip latency, useful for spotting a
          query that needs an index. */}
      <div className="mt-2 font-mono text-[9px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
        {typeof meta?.tookMs === 'number' ? `/explore · ${meta.tookMs} ms` : '/explore'}
      </div>
    </header>
  )
}

function RailRow({
  projectId,
  row,
  selected,
  windowKey,
}: {
  projectId: null | string
  row: RailIssueRow
  selected: boolean
  windowKey: WindowKey
}) {
  const { currentOrg } = useOrg()
  const sparkValues = useIssueSparkline(projectId, row.id, windowKey)
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
        {row.priority && row.priority !== 'p3' && <PriorityChip priority={row.priority} />}
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
      {row.errorType !== 'Message' && (
        <div className="mt-0.5 line-clamp-1 text-[12px] text-[color:var(--ink-soft)]">
          {displayMessage(row.messageSample)}
        </div>
      )}
      {row.labels && row.labels.length > 0 && (
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
      <div className="mt-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.05em] whitespace-nowrap text-[color:var(--ink-muted)]">
        <span className="tabular-nums">{row.eventCount.toLocaleString()} ev</span>
        <span aria-hidden className="opacity-40">
          ·
        </span>
        <span className="tabular-nums">{row.lastSeen ? formatRelative(row.lastSeen) : '—'}</span>
        {/* v2.3 — per-row sparkline. Uses /explore dim=time_bucket +
         *   issueEq=row.id; one query per visible row (React Query
         *   caches by issueId+windowKey). Renders empty SVG while
         *   loading so layout doesn't reflow. */}
        <span aria-hidden className="ml-auto opacity-70">
          <Sparkline
            ariaLabel={`Event trend for ${row.errorType}`}
            height={16}
            stroke="var(--ink-muted)"
            strokeWidth={1}
            values={sparkValues}
            width={64}
          />
        </span>
        {row.assigneeEmail && (
          <span className="ml-2 truncate text-[color:var(--accent)]">
            @{row.assigneeEmail.split('@')[0]}
          </span>
        )}
      </div>
      {row.lastRelease && (
        <div className="mt-0.5 truncate font-mono text-[10px] tracking-[0.05em] text-[color:var(--ink-muted)] opacity-80">
          {row.lastRelease}
        </div>
      )}
    </Link>
  )
}

function StatusTag({ status }: { status: IssueStatus }) {
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
            fontSize: '22px',
            fontVariationSettings: "'wdth' 95, 'opsz' 24, 'wght' 550",
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

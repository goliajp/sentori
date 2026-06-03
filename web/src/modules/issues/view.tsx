import {
  Alert,
  Badge,
  Chip,
  EmptyState,
  Tabs as GdsTabs,
  Skeleton,
  ToggleGroup,
} from '@goliapkg/gds'
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
import { Sparkline } from '@/components/Sparkline'
import { formatRelative } from '@/lib/format'
import { useUrlParam } from '@/lib/url-state'

import { LabelChip, PriorityChip } from './triage-chips'

type Tab = IssueStatus | 'all'

const STATUS_TABS: { id: Tab; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'regressed', label: 'Regressed' },
  { id: 'muted', label: 'Muted' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'silenced', label: 'Silenced' },
  { id: 'all', label: 'All' },
]
const TAB_KEYS = new Set<Tab>(['active', 'regressed', 'muted', 'resolved', 'silenced', 'all'])

type Measure = 'event_count' | 'first_seen' | 'last_seen' | 'unique_users'
const MEASURES: { value: Measure; label: string }[] = [
  { value: 'event_count', label: 'Events' },
  { value: 'unique_users', label: 'Users' },
  { value: 'last_seen', label: 'Last seen' },
  { value: 'first_seen', label: 'First seen' },
]
const MEASURE_KEYS = new Set<Measure>(['event_count', 'unique_users', 'last_seen', 'first_seen'])

type WindowKey = '1d' | '7d' | '30d' | 'all'
const WINDOWS: { value: WindowKey; label: string }[] = [
  { value: '1d', label: '1d' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: 'all', label: 'All' },
]
const WINDOW_KEYS = new Set<WindowKey>(['1d', '7d', '30d', 'all'])

function windowGteRfc3339(w: WindowKey): string | undefined {
  if (w === 'all') return undefined
  const days = w === '1d' ? 1 : w === '7d' ? 7 : 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Issues — master/detail layout.
 *
 *   ┌──────────┬─────────────────────────────────┐
 *   │ rail     │  detail (Outlet)                │
 *   │ filter   │                                 │
 *   │ ◾ row    │  • If `:issueId` → IssueDetail  │
 *   │ ◾ row    │  • Else            → empty pane │
 *   └──────────┴─────────────────────────────────┘
 *
 * URL state:
 *   ?status=     active filter tab (default 'active')
 *   ?measure=    sort dim (default 'event_count')
 *   ?window=     time window (default '7d')
 *   ?release=    slice by release (deep-link from Releases)
 *   ?errorType=  slice by Sentori error kind
 *   ?env=        slice by environment
 *   ?q=          server-side fuzzy match on error_type + message_sample
 *   :issueId     selected issue → detail pane via <Outlet />
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

  // Cross-module deep-link filters. Other modules (Releases, Users)
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
    <div className="bg-bg -mx-4 -my-3 flex h-[calc(100%+1.5rem)] min-h-0 overflow-hidden">
      <aside className="bg-bg-secondary border-border flex w-[22rem] shrink-0 flex-col overflow-hidden border-r">
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
            <div className="p-4">
              <EmptyState
                title="No project selected"
                description="Create a project in org settings to start ingesting."
              />
            </div>
          )}
          {projectId && isLoading && <RailSkeleton />}
          {projectId && !!error && (
            <div className="p-4">
              <Alert title="Failed to load issues" variant="danger">
                Check your network connection or try again later.
              </Alert>
            </div>
          )}
          {projectId && !isLoading && !error && rows.length === 0 && (
            <div className="p-4">
              <EmptyState
                title={
                  activeFilters.length > 0
                    ? 'No issues match these filters'
                    : tab === 'active'
                      ? 'Quiet right now'
                      : 'No issues match'
                }
                description={
                  activeFilters.length > 0
                    ? 'Try clearing one or more filters.'
                    : tab === 'active'
                      ? 'Fire an event from your SDK to see it here.'
                      : 'Switch to another status tab to see more.'
                }
              />
            </div>
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

      <section className="bg-bg min-w-0 flex-1 overflow-y-auto">
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
 * Per-row sparkline. Issues `/explore` with `dim=time_bucket` +
 * `issueEq=<issueId>` so the result is the row's event count
 * bucketed inside the active window. `staleTime: 30_000` keeps
 * navigation cheap.
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
    <div className="border-border shrink-0 border-b px-4 py-2">
      <div className="text-fg-muted mb-1 font-mono text-[9px] tracking-[0.22em] uppercase">
        filters
      </div>
      <div className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Chip
            key={f.label + f.value}
            label={`${f.label}: ${f.value}`}
            onRemove={f.onClear}
            variant="default"
          />
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
    <header className="border-border shrink-0 border-b px-4 py-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-fg text-[17px] font-semibold tracking-tight">Issues</h1>
        <span className="text-fg-muted font-mono text-[11px] tabular-nums">
          {count.toLocaleString()}
        </span>
      </div>
      <div className="mt-3">
        <GdsTabs
          active={current}
          onChange={(id) => onChangeTab(id as Tab)}
          scrollable
          size="sm"
          tabs={STATUS_TABS}
          variant="underline"
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.1em] uppercase">sort</span>
        <ToggleGroup
          aria-label="Sort issues by"
          exclusive
          items={MEASURES}
          onChange={(v) => {
            const next = v[0] as Measure | undefined
            if (next) onChangeMeasure(next)
          }}
          size="sm"
          value={[measure]}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.1em] uppercase">
          window
        </span>
        <ToggleGroup
          aria-label="Time window"
          exclusive
          items={WINDOWS}
          onChange={(v) => {
            const next = v[0] as WindowKey | undefined
            if (next) onChangeWindow(next)
          }}
          size="sm"
          value={[windowKey]}
        />
      </div>
      <div className="text-fg-muted mt-2 font-mono text-[9px] tracking-[0.18em] uppercase">
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
      className={`border-border-muted group relative block border-b px-4 py-3 transition-colors ${
        selected ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary/60'
      }`}
      to={`/main/org/${currentOrg.slug}/issues/${row.id}`}
    >
      <span
        aria-hidden
        className={`absolute top-0 bottom-0 left-0 w-[2px] ${selected ? 'bg-accent' : 'bg-transparent'}`}
      />
      <div className="flex min-w-0 items-baseline gap-2">
        {row.priority && row.priority !== 'p3' && <PriorityChip priority={row.priority} />}
        {/* Distinguish manual captureMessage events from real errors —
         *  server synthesises `errorType = 'Message'` for kind=message
         *  so the row can render a different glyph without a new field. */}
        {row.errorType === 'Message' && (
          <span
            aria-hidden
            className="text-fg-muted text-[12px]"
            title="Manual report (captureMessage)"
          >
            💬
          </span>
        )}
        <span className="text-fg min-w-0 flex-1 truncate text-[13px] font-medium">
          {row.errorType === 'Message' ? displayMessage(row.messageSample) : row.errorType}
        </span>
        <IssueStatusBadge status={row.status} />
      </div>
      {row.errorType !== 'Message' && (
        <div className="text-fg-secondary mt-0.5 line-clamp-1 text-[12px]">
          {displayMessage(row.messageSample)}
        </div>
      )}
      {row.labels && row.labels.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {row.labels.slice(0, 3).map((l) => (
            <LabelChip key={l} label={l} />
          ))}
          {row.labels.length > 3 && (
            <span className="text-fg-muted font-mono text-[10px] tracking-wider uppercase">
              +{row.labels.length - 3}
            </span>
          )}
        </div>
      )}
      <div className="text-fg-muted mt-2 flex items-center gap-2 font-mono text-[10px] tracking-[0.05em] whitespace-nowrap">
        <span className="tabular-nums">{row.eventCount.toLocaleString()} ev</span>
        <span aria-hidden className="opacity-40">
          ·
        </span>
        <span className="tabular-nums">{row.lastSeen ? formatRelative(row.lastSeen) : '—'}</span>
        <span aria-hidden className="ml-auto opacity-70">
          <Sparkline
            ariaLabel={`Event trend for ${row.errorType}`}
            height={16}
            stroke="currentColor"
            strokeWidth={1}
            values={sparkValues}
            width={64}
          />
        </span>
        {row.assigneeEmail && (
          <span className="text-accent ml-2 truncate">@{row.assigneeEmail.split('@')[0]}</span>
        )}
      </div>
      {row.lastRelease && (
        <div className="text-fg-muted mt-0.5 truncate font-mono text-[10px] tracking-[0.05em] opacity-80">
          {row.lastRelease}
        </div>
      )}
    </Link>
  )
}

/** Map Sentori IssueStatus onto GDS Badge variants. Sentori has more
 *  states than GDS StatusBadge's enum, so Badge + variant + manual
 *  label gives the right semantics. */
function IssueStatusBadge({ status }: { status: IssueStatus }) {
  const variant =
    status === 'regressed'
      ? 'warning'
      : status === 'active'
        ? 'info'
        : status === 'resolved'
          ? 'success'
          : 'default'
  return (
    <Badge className="shrink-0 font-mono text-[10px] tracking-[0.18em] uppercase" variant={variant}>
      {status}
    </Badge>
  )
}

function RailSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 8 }).map((_, i) => (
        <div className="border-border-muted border-b px-4 py-3" key={i}>
          <Skeleton className="mb-2" height={14} variant="rect" width="70%" />
          <Skeleton className="mb-2" height={11} variant="rect" width="90%" />
          <Skeleton height={10} variant="rect" width="40%" />
        </div>
      ))}
    </div>
  )
}

function DetailPlaceholder() {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <EmptyState
        title="Pick a row on the left"
        description="Stack trace, events, breadcrumbs and replays show up here."
      />
    </div>
  )
}

/** Pre-coerceError events (shipped before the SDK fix) carry the
 *  literal `[object Object]` as their message. Surface it as a hint. */
function displayMessage(message: string): string {
  if (message === '[object Object]') return '(non-Error thrown — SDK upgrade required)'
  return message
}

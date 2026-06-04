import {
  Alert,
  Badge,
  Card,
  Chip,
  DataTable,
  EmptyState,
  PageHeader,
  ToggleGroup,
} from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useNavigate, useParams } from 'react-router'

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

const STATUS_TABS: { value: Tab; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'regressed', label: 'Regressed' },
  { value: 'muted', label: 'Muted' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'silenced', label: 'Silenced' },
  { value: 'all', label: 'All' },
]
const TAB_KEYS = new Set<Tab>(['active', 'regressed', 'muted', 'resolved', 'silenced', 'all'])

type Measure = 'event_count' | 'first_seen' | 'last_seen' | 'unique_users'
const MEASURE_KEYS = new Set<Measure>(['event_count', 'unique_users', 'last_seen', 'first_seen'])

type WindowKey = '1d' | '7d' | '30d' | 'all'
const WINDOWS: { value: WindowKey; label: string }[] = [
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
]
const WINDOW_KEYS = new Set<WindowKey>(['1d', '7d', '30d', 'all'])

function windowGteRfc3339(w: WindowKey): string | undefined {
  if (w === 'all') return undefined
  const days = w === '1d' ? 1 : w === '7d' ? 7 : 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Issues — single full-width DataTable, click-row navigates to a
 * dedicated detail page (Linear / GitHub Issues idiom). Filters live
 * above the table as ToggleGroups (status / window) + Chip stack
 * (cross-module deep-link filters from Releases, Users etc.).
 *
 * URL state:
 *   ?status=     active filter tab (default 'active')
 *   ?measure=    sort dim (default 'event_count')
 *   ?window=     time window (default '7d')
 *   ?release=    slice by release (deep-link from Releases)
 *   ?errorType=  slice by Sentori error kind
 *   ?env=        slice by environment
 *   ?q=          server-side fuzzy match on error_type + message_sample
 *   :issueId     → renders the detail child via <Outlet />, this view
 *                  steps aside entirely
 */
export function IssuesView() {
  const { issueId } = useParams<{ issueId?: string }>()
  if (issueId) return <Outlet />
  return <IssueListPage />
}

function IssueListPage() {
  const { currentOrg, currentProject } = useOrg()
  const navigate = useNavigate()
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
    activeFilters.push({ label: 'env', onClear: () => setEnvFilter(''), value: envFilter })

  if (!projectId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Issues" />
        <Card>
          <EmptyState
            description="Create a project in org settings to start ingesting events."
            title="No project selected"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'issues' },
        ]}
        subtitle={
          typeof meta?.tookMs === 'number'
            ? `${rows.length.toLocaleString()} match · /explore ${meta.tookMs} ms`
            : `${rows.length.toLocaleString()} match`
        }
        title="Issues"
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          status
        </span>
        <ToggleGroup
          aria-label="Issue status"
          exclusive
          items={STATUS_TABS}
          onChange={(v) => {
            const next = v[0] as Tab | undefined
            if (next) setTab(next)
          }}
          size="sm"
          value={[tab]}
        />
        <span aria-hidden className="text-border">
          |
        </span>
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          window
        </span>
        <ToggleGroup
          aria-label="Time window"
          exclusive
          items={WINDOWS}
          onChange={(v) => {
            const next = v[0] as WindowKey | undefined
            if (next) setWindowKey(next)
          }}
          size="sm"
          value={[windowKey]}
        />
      </div>

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-fg-muted font-mono text-[9px] tracking-[0.22em] uppercase">
            filters
          </span>
          {activeFilters.map((f) => (
            <Chip
              key={f.label + f.value}
              label={`${f.label}: ${f.value}`}
              onRemove={f.onClear}
              variant="default"
            />
          ))}
        </div>
      )}

      {error ? (
        <Alert title="Failed to load issues" variant="danger">
          Check your network or try a different time window.
        </Alert>
      ) : (
        <DataTable
          columns={ISSUE_COLUMNS}
          density="compact"
          error={null}
          globalFilter
          globalFilterPlaceholder="Search by type or message…"
          globalFilterValue={searchFilter}
          highlightOnHover
          loading={isLoading}
          loadingRows={8}
          onGlobalFilterChange={setSearchFilter}
          onRowClick={(row) => navigate(`/main/org/${currentOrg.slug}/issues/${row.id}`)}
          onSort={(key) => {
            if (key === 'eventCount') setMeasure('event_count')
            else if (key === 'uniqueUsers') setMeasure('unique_users')
            else if (key === 'lastSeen') setMeasure('last_seen')
            else if (key === 'firstSeen') setMeasure('first_seen')
          }}
          rowKey="id"
          rows={rows}
          sortDir="desc"
          sortKey={
            measure === 'event_count'
              ? 'eventCount'
              : measure === 'unique_users'
                ? 'uniqueUsers'
                : measure === 'last_seen'
                  ? 'lastSeen'
                  : 'firstSeen'
          }
          stickyHeader
          striped
        />
      )}
    </div>
  )
}

// ── columns ───────────────────────────────────────────────────────────────

const ISSUE_COLUMNS = [
  {
    key: 'status',
    label: 'Status',
    width: '110px',
    render: (_v: unknown, r: RailIssueRow) => {
      const variant =
        r.status === 'regressed'
          ? 'warning'
          : r.status === 'active'
            ? 'info'
            : r.status === 'resolved'
              ? 'success'
              : 'default'
      return (
        <Badge className="font-mono text-[10px] tracking-[0.18em] uppercase" variant={variant}>
          {r.status}
        </Badge>
      )
    },
  },
  {
    key: 'errorType',
    label: 'Type',
    width: '180px',
    render: (_v: unknown, r: RailIssueRow) => (
      <span className="text-fg flex items-center gap-1.5 font-mono text-[12px]">
        {r.priority && r.priority !== 'p3' && <PriorityChip priority={r.priority} />}
        {r.errorType === 'Message' && (
          <span aria-hidden className="text-fg-muted text-[12px]" title="captureMessage">
            💬
          </span>
        )}
        <span className="truncate">{r.errorType}</span>
      </span>
    ),
  },
  {
    key: 'messageSample',
    label: 'Message',
    minWidth: '300px',
    render: (_v: unknown, r: RailIssueRow) => (
      <div className="space-y-0.5">
        <div className="text-fg-secondary line-clamp-1 text-[13px]">
          {displayMessage(r.messageSample)}
        </div>
        {r.labels && r.labels.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {r.labels.slice(0, 3).map((l) => (
              <LabelChip key={l} label={l} />
            ))}
            {r.labels.length > 3 && (
              <span className="text-fg-muted font-mono text-[10px] tracking-wider uppercase">
                +{r.labels.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    ),
  },
  {
    align: 'right' as const,
    key: 'eventCount',
    label: 'Events',
    sortable: true,
    width: '90px',
    render: (_v: unknown, r: RailIssueRow) => (
      <span className="text-fg font-mono text-[12px] tabular-nums">
        {r.eventCount.toLocaleString()}
      </span>
    ),
  },
  {
    align: 'right' as const,
    key: 'lastSeen',
    label: 'Last seen',
    sortable: true,
    width: '110px',
    render: (_v: unknown, r: RailIssueRow) => (
      <span className="text-fg-muted font-mono text-[11px] tabular-nums">
        {r.lastSeen ? formatRelative(r.lastSeen) : '—'}
      </span>
    ),
  },
  {
    align: 'right' as const,
    key: 'sparkline',
    label: 'Trend',
    width: '90px',
    render: (_v: unknown, r: RailIssueRow) => <RowSparkline issueId={r.id} />,
  },
  {
    key: 'lastRelease',
    label: 'Release',
    width: '180px',
    render: (_v: unknown, r: RailIssueRow) => (
      <span className="text-fg-muted truncate font-mono text-[11px]">{r.lastRelease ?? '—'}</span>
    ),
  },
]

function RowSparkline({ issueId }: { issueId: string }) {
  const { currentProject } = useOrg()
  const values = useIssueSparkline(currentProject?.id ?? null, issueId, '7d')
  return (
    <span aria-hidden className="text-fg-muted inline-block opacity-70">
      <Sparkline
        ariaLabel="Event trend"
        height={20}
        stroke="currentColor"
        strokeWidth={1}
        values={values}
        width={72}
      />
    </span>
  )
}

// ── data hook ───────────────────────────────────────────────────────────────

type RailIssueRow = {
  id: string
  errorType: string
  messageSample: string
  status: IssueStatus
  eventCount: number
  uniqueUsers: number
  lastSeen: string
  firstSeen: string
  lastRelease: null | string
  priority?: 'p0' | 'p1' | 'p2' | 'p3'
  labels?: string[]
  assigneeEmail?: null | string
}

type RailMeta = null | { tookMs?: number; windowGte?: string }

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
    meta: { tookMs: exploreQ.data?.meta.tookMs, windowGte },
    rows,
  }
}

function normaliseExplore(r: ExploreRow): null | RailIssueRow {
  const id = pickString(r.issue_id)
  if (!id) return null
  return {
    errorType: pickString(r.error_type) ?? '',
    eventCount: pickNumber(r.event_count),
    firstSeen: pickString(r.first_seen) ?? '',
    id,
    lastRelease: pickString(r.last_release) || null,
    lastSeen: pickString(r.last_seen) ?? '',
    messageSample: pickString(r.message_sample) ?? '',
    status: (pickString(r.status) as IssueStatus) ?? 'active',
    uniqueUsers: pickNumber(r.unique_users),
  }
}

function pickString(v: ExploreRow[string]): null | string {
  return typeof v === 'string' ? v : null
}
function pickNumber(v: ExploreRow[string]): number {
  return typeof v === 'number' ? v : 0
}

function useIssueSparkline(
  projectId: null | string,
  issueId: string,
  windowKey: WindowKey
): number[] {
  const windowGte = windowGteRfc3339(windowKey)
  const sparkReq: ExploreReq = {
    dim: 'time_bucket',
    filters: { issueEq: issueId, ...(windowGte ? { receivedAtGte: windowGte } : {}) },
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

type FilterChip = { label: string; onClear: () => void; value: string }

function displayMessage(message: string): string {
  if (message === '[object Object]') return '(non-Error thrown — SDK upgrade required)'
  return message
}

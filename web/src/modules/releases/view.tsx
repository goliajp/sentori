import { Alert, Card, DataTable, EmptyState, PageHeader, ToggleGroup } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useParams } from 'react-router'

import {
  adminApi,
  type ExploreMeasure,
  type ExploreReq,
  type ExploreResp,
  type ExploreRow,
} from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { Sparkline } from '@/components/Sparkline'
import { formatRelative } from '@/lib/format'
import { useUrlParam } from '@/lib/url-state'

/**
 * v2.2 — Releases under the "find-bug" lens. Backed by /explore with
 * `dim=release` + preset measures (event_count, issue_count,
 * resolved_count, unique_users, last_seen). The URL ?window= state
 * mirrors the agent-callable API so a screenshot link and an LLM
 * query land on the same data.
 */

const PRESET_MEASURES: ExploreMeasure[] = [
  'event_count',
  'issue_count',
  'resolved_count',
  'unique_users',
  'first_seen',
  'last_seen',
]

type WindowKey = '1d' | '7d' | '30d' | 'all'
const WINDOWS: { value: WindowKey; label: string }[] = [
  { value: '1d', label: '1 day' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
]
const WINDOW_KEY_SET = new Set<WindowKey>(['1d', '7d', '30d', 'all'])

function windowGteRfc3339(w: WindowKey): string | undefined {
  if (w === 'all') return undefined
  const days = w === '1d' ? 1 : w === '7d' ? 7 : 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

export function ReleasesView() {
  const params = useParams<{ release?: string }>()
  if (params.release !== undefined) return <Outlet />
  return <ReleaseListPage />
}

function ReleaseListPage() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const [windowKey, setWindowKey] = useUrlParam<WindowKey>('window', '7d', (raw) =>
    WINDOW_KEY_SET.has(raw as WindowKey) ? (raw as WindowKey) : null
  )

  const windowGte = windowGteRfc3339(windowKey)
  const reqBody: ExploreReq = {
    dim: 'release',
    measures: PRESET_MEASURES,
    filters: windowGte ? { receivedAtGte: windowGte } : {},
    orderBy: 'last_seen',
    orderDir: 'desc',
    limit: 200,
  }

  const exploreQ = useQuery<ExploreResp>({
    enabled: !!projectId,
    queryFn: () => adminApi.explore(projectId!, reqBody),
    queryKey: qk.releases(projectId, windowKey),
  })

  const trendReq: ExploreReq = {
    dim: 'time_bucket',
    measures: ['event_count'],
    filters: windowGte ? { receivedAtGte: windowGte } : {},
    limit: 200,
  }
  const trendQ = useQuery<ExploreResp>({
    enabled: !!projectId,
    queryFn: () => adminApi.explore(projectId!, trendReq),
    queryKey: ['explore', 'release-trend', projectId, windowKey],
  })

  const rows: ExploreRow[] = exploreQ.data?.rows ?? []
  const meta = exploreQ.data?.meta
  const trendValues =
    trendQ.data?.rows.map((r) => Number(r.event_count ?? 0)).filter((n) => !Number.isNaN(n)) ?? []
  const totalEvents = trendValues.reduce((s, n) => s + n, 0)

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'releases' },
        ]}
        subtitle={
          meta
            ? `find-bug lens · /explore ${meta.tookMs} ms · ${rows.length.toLocaleString()} releases`
            : 'find-bug lens'
        }
        title="Releases"
      />

      <div className="flex flex-wrap items-center gap-3">
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

      {trendValues.length > 1 && (
        <Card>
          <div className="flex items-end justify-between gap-4">
            <div>
              <div className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
                events over {windowKey}
              </div>
              <div className="text-fg text-[24px] font-semibold tabular-nums">
                {totalEvents.toLocaleString()}
              </div>
            </div>
            <Sparkline
              ariaLabel={`event count over ${windowKey}`}
              height={48}
              stroke="var(--color-accent)"
              strokeWidth={1.5}
              values={trendValues}
              width={300}
            />
          </div>
        </Card>
      )}

      {!projectId && (
        <Card>
          <EmptyState
            description="Pick one from the sidebar context to see its releases."
            title="No project selected"
          />
        </Card>
      )}

      {projectId && exploreQ.isError && (
        <Alert title="Failed to load releases" variant="danger">
          Refresh to retry.
        </Alert>
      )}

      {projectId && !exploreQ.isLoading && rows.length === 0 && (
        <Card>
          <EmptyState
            description="Try a longer window or ingest some events from the SDK."
            title="No events in this window"
          />
        </Card>
      )}

      {projectId && rows.length > 0 && (
        <DataTable<ExploreRow & { release: string }>
          columns={[
            {
              key: 'release',
              label: 'Release',
              render: (_v, r) => (
                <Link
                  className="text-fg hover:text-accent font-mono text-[12px]"
                  to={`/main/org/${currentOrg.slug}/releases/${encodeURIComponent(String(r.release ?? ''))}`}
                >
                  {String(r.release ?? '(unknown)')}
                </Link>
              ),
            },
            {
              align: 'right',
              key: 'event_count',
              label: 'Events',
              sortable: true,
              width: '110px',
              render: (_v, r) => (
                <span className="text-fg font-mono text-[12px] tabular-nums">
                  {Number(r.event_count ?? 0).toLocaleString()}
                </span>
              ),
            },
            {
              align: 'right',
              key: 'issue_count',
              label: 'Active issues',
              sortable: true,
              width: '110px',
              render: (_v, r) => {
                const n = Number(r.issue_count ?? 0)
                return (
                  <span
                    className={`font-mono text-[12px] tabular-nums ${n > 0 ? 'text-warning' : 'text-fg-muted'}`}
                  >
                    {n.toLocaleString()}
                  </span>
                )
              },
            },
            {
              align: 'right',
              key: 'resolved_count',
              label: 'Resolved',
              sortable: true,
              width: '100px',
              render: (_v, r) => {
                const n = Number(r.resolved_count ?? 0)
                return (
                  <span
                    className={`font-mono text-[12px] tabular-nums ${n > 0 ? 'text-success' : 'text-fg-muted'}`}
                  >
                    {n.toLocaleString()}
                  </span>
                )
              },
            },
            {
              align: 'right',
              key: 'unique_users',
              label: 'Users',
              sortable: true,
              width: '90px',
              render: (_v, r) => (
                <span className="text-fg font-mono text-[12px] tabular-nums">
                  {Number(r.unique_users ?? 0).toLocaleString()}
                </span>
              ),
            },
            {
              align: 'right',
              key: 'last_seen',
              label: 'Last seen',
              width: '120px',
              render: (_v, r) => (
                <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                  {typeof r.last_seen === 'string' ? formatRelative(r.last_seen) : '—'}
                </span>
              ),
            },
          ]}
          density="compact"
          highlightOnHover
          loading={exploreQ.isLoading}
          loadingRows={8}
          rowKey={(r) => String(r.release ?? '')}
          rows={rows as (ExploreRow & { release: string })[]}
          stickyHeader
          striped
        />
      )}
    </div>
  )
}

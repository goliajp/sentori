import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useParams } from 'react-router'

import {
  adminApi,
  type ExploreMeasure,
  type ExploreReq,
  type ExploreResp,
  type ExploreRow,
} from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { EmptyState } from '@/components/Hint'
import { RowSkeleton } from '@/components/Skeleton'
import { Sparkline } from '@/components/Sparkline'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'
import { qk } from '@/api/query-keys'
import { useUrlParam } from '@/lib/url-state'

/**
 * v2.2 — Releases module rebuilt under the "find-bug" lens.
 *
 * Old (pre-v2.2): listed every release with sourcemap / dsym /
 * proguard counts — that's the "engineering hygiene" lens, not
 * find-bug. Moved to the detail page; index now answers the
 * question the operator actually has on Monday morning:
 *
 *   "Which release introduced the most new pain in the last X
 *    days, and which release fixed the most?"
 *
 * Data fetch goes through the v2.2 `/admin/api/.../explore` single
 * query endpoint with a preset query — same shape an LLM agent
 * would call. The dashboard is a UI consumer; the API is the
 * primitive. See `server/src/api/admin/explore.rs` + the v2.2
 * design memory for the architecture.
 *
 * Query shape rendered here:
 *
 *   dim:      release
 *   measures: event_count, issue_count, resolved_count,
 *             unique_users, first_seen, last_seen
 *   window:   `?window=7d` URL param (1d/7d/30d/all)
 *
 * The URL state means an operator can share `/releases?window=30d`
 * and both the dashboard view AND an LLM agent calling /explore
 * with the same params see the same data.
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
const WINDOW_KEYS: WindowKey[] = ['1d', '7d', '30d', 'all']

function windowGteRfc3339(w: WindowKey): string | undefined {
  if (w === 'all') return undefined
  const days = w === '1d' ? 1 : w === '7d' ? 7 : 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

export function ReleasesView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const params = useParams<{ release?: string }>()
  const isDetail = params.release !== undefined

  const [windowKey, setWindowKey] = useUrlParam<WindowKey>('window', '7d', (raw) =>
    WINDOW_KEYS.includes(raw as WindowKey) ? (raw as WindowKey) : null
  )

  const reqBody: ExploreReq = {
    dim: 'release',
    measures: PRESET_MEASURES,
    filters: {
      ...(windowGteRfc3339(windowKey) ? { receivedAtGte: windowGteRfc3339(windowKey) } : {}),
    },
    orderBy: 'last_seen',
    orderDir: 'desc',
    limit: 200,
  }

  const exploreQ = useQuery<ExploreResp>({
    enabled: !!projectId && !isDetail,
    queryFn: () => adminApi.explore(projectId!, reqBody),
    queryKey: qk.releases(projectId, windowKey),
  })

  // Time-series sparkline at the page header — total event rhythm
  // over the same window. Uses the v2.2 `dim=time_bucket` shape.
  const trendReq: ExploreReq = {
    dim: 'time_bucket',
    measures: ['event_count'],
    filters: {
      ...(windowGteRfc3339(windowKey) ? { receivedAtGte: windowGteRfc3339(windowKey) } : {}),
    },
    limit: 200,
  }
  const trendQ = useQuery<ExploreResp>({
    enabled: !!projectId && !isDetail,
    queryFn: () => adminApi.explore(projectId!, trendReq),
    queryKey: ['explore', 'release-trend', projectId, windowKey],
  })

  if (isDetail) {
    return <Outlet />
  }

  const rows: ExploreRow[] = exploreQ.data?.rows ?? []
  const meta = exploreQ.data?.meta
  const trendValues =
    trendQ.data?.rows.map((r) => Number(r.event_count ?? 0)).filter((n) => !Number.isNaN(n)) ?? []

  return (
    <div className="sentori-page-in">
      <PageHeader
        actions={<WindowPicker active={windowKey} onChange={setWindowKey} />}
        count={rows.length}
        subtitle={meta ? `${meta.tookMs} ms · ${meta.measures.length} measures` : 'preset query'}
        title="Releases"
      />

      {trendValues.length > 1 && (
        <div className="border-border mb-6 flex items-end justify-between gap-4 border-b pb-3">
          <div>
            <div className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
              events over {windowKey}
            </div>
            <div className="text-fg font-mono text-[20px] tabular-nums">
              {trendValues.reduce((s, n) => s + n, 0).toLocaleString()}
            </div>
          </div>
          <Sparkline ariaLabel={`event count over ${windowKey}`} values={trendValues} />
        </div>
      )}

      {!projectId && <EmptyState>Select a project to see its releases.</EmptyState>}
      {projectId && exploreQ.isLoading && <RowSkeleton count={5} height="52px" />}
      {projectId && exploreQ.isError && (
        <EmptyState>Failed to load releases. Refresh to retry.</EmptyState>
      )}
      {projectId && !exploreQ.isLoading && !exploreQ.isError && rows.length === 0 && (
        <EmptyState>
          No events in this window. Try a longer window or ingest some events.
        </EmptyState>
      )}

      {rows.length > 0 && (
        <table className="bench">
          <thead>
            <tr>
              <th>release</th>
              <th className="num">events</th>
              <th className="num">active issues</th>
              <th className="num">resolved</th>
              <th className="num">users</th>
              <th className="num">last seen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const release = String(r.release ?? '')
              return (
                <tr key={release}>
                  <td className="lead">
                    <Link
                      className="text-fg hover:text-accent"
                      to={`/main/org/${currentOrg.slug}/releases/${encodeURIComponent(release)}`}
                    >
                      {release || '(unknown)'}
                    </Link>
                  </td>
                  <td className="num tabular-nums">
                    {Number(r.event_count ?? 0).toLocaleString()}
                  </td>
                  <td
                    className={`num tabular-nums ${
                      Number(r.issue_count ?? 0) > 0 ? 'text-warning' : 'text-fg-muted'
                    }`}
                  >
                    {Number(r.issue_count ?? 0).toLocaleString()}
                  </td>
                  <td
                    className={`num tabular-nums ${
                      Number(r.resolved_count ?? 0) > 0 ? 'text-success' : 'text-fg-muted'
                    }`}
                  >
                    {Number(r.resolved_count ?? 0).toLocaleString()}
                  </td>
                  <td className="num tabular-nums">
                    {Number(r.unique_users ?? 0).toLocaleString()}
                  </td>
                  <td className="num">
                    {typeof r.last_seen === 'string' ? formatRelative(r.last_seen) : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}

function WindowPicker({
  active,
  onChange,
}: {
  active: WindowKey
  onChange: (w: WindowKey) => void
}) {
  return (
    <div className="flex items-baseline gap-2 font-mono text-[10px] tracking-[0.18em] uppercase">
      {WINDOW_KEYS.map((k, i) => (
        <span key={k} className="flex items-baseline gap-2">
          {i > 0 && <span className="text-border">/</span>}
          <button
            className={k === active ? 'text-accent' : 'text-fg-muted hover:text-fg-secondary'}
            onClick={() => onChange(k)}
            type="button"
          >
            {k}
          </button>
        </span>
      ))}
    </div>
  )
}

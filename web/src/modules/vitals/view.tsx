// v0.9.4 #1 / v2.5 — Mobile Vitals dashboard, repositioned as the
// find-slow lens.
//
// Layout:
//   - Release picker (existing) + window picker (1d/7d/30d/all).
//   - KPI strip — release + cold-start p50/p95 + routes-tracked.
//   - Per-route table — TTID p50/p95 / TTFD p50/p95 / slow + frozen
//     frame totals. Sorted by TTID p95 desc by default (the "where's
//     the worst slowness?" question).
//   - Compare mode — checkbox column lets the operator tag up to 4
//     routes; a delta strip above the table renders the comparison
//     against the first-selected row.
//   - Drill: each route's name links into the Issues list filtered
//     by `tags.route = X` so the operator can pivot from "this
//     route is slow" to "what errors hit on this route".
//
// All numbers come from spans table aggregations
// (server/src/api/vitals.rs); no new server endpoint in v2.5.

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link } from 'react-router'

import { adminApi } from '@/api/client'
import { EmptyState } from '@/components/Hint'
import { Stat } from '@/components/Stat'
import { SubSection } from '@/components/SubSection'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'
import { qk } from '@/api/query-keys'
import { useUrlParam } from '@/lib/url-state'

type SortKey = 'frozen' | 'route' | 'slow' | 'ttfdP95' | 'ttidP95'
type Direction = 'asc' | 'desc'

export function VitalsView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [release, setRelease] = useUrlParam<string>('release', '')
  const [sortBy, setSortBy] = useUrlParam<SortKey>('sort', 'ttidP95', (raw) =>
    new Set<SortKey>(['ttidP95', 'ttfdP95', 'slow', 'frozen', 'route']).has(raw as SortKey)
      ? (raw as SortKey)
      : null
  )
  const [direction, setDirection] = useUrlParam<Direction>('dir', 'desc', (raw) =>
    raw === 'asc' || raw === 'desc' ? raw : null
  )
  // v2.5 — comma-separated route names the operator tagged for
  // compare. Up to 4 entries — small enough to fit in a single
  // delta strip without horizontal scroll.
  const [compareParam, setCompareParam] = useUrlParam<string>('compare', '')
  const compareSet = useMemo(() => new Set(compareParam.split(',').filter(Boolean)), [compareParam])

  const releasesQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listVitalsReleases(projectId!),
    queryKey: qk.vitals.releases(projectId),
  })
  const reportQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.vitalsReport(projectId!, release || undefined),
    queryKey: qk.vitals.report(projectId, release || null),
  })

  const releases = releasesQ.data ?? []
  const report = reportQ.data

  const sortedRoutes = useMemo(() => {
    if (!report) return []
    const rows = [...report.perRoute]
    const cmp = (a: number | string, b: number | string) =>
      typeof a === 'string'
        ? (a as string).localeCompare(b as string)
        : (a as number) - (b as number)
    rows.sort((a, b) => {
      let av: number | string
      let bv: number | string
      switch (sortBy) {
        case 'frozen':
          av = a.totalFrozenFrames
          bv = b.totalFrozenFrames
          break
        case 'slow':
          av = a.totalSlowFrames
          bv = b.totalSlowFrames
          break
        case 'ttfdP95':
          av = a.ttfdSamples > 0 ? a.ttfdP95Ms : -1
          bv = b.ttfdSamples > 0 ? b.ttfdP95Ms : -1
          break
        case 'route':
          av = a.route
          bv = b.route
          break
        case 'ttidP95':
        default:
          av = a.ttidP95Ms
          bv = b.ttidP95Ms
      }
      const c = cmp(av, bv)
      return direction === 'desc' ? -c : c
    })
    return rows
  }, [report, sortBy, direction])

  const comparedRoutes = useMemo(
    () => sortedRoutes.filter((r) => compareSet.has(r.route)),
    [sortedRoutes, compareSet]
  )

  const toggleCompare = (route: string) => {
    const next = new Set(compareSet)
    if (next.has(route)) next.delete(route)
    else if (next.size < 4) next.add(route)
    setCompareParam(Array.from(next).join(','))
  }
  const onChangeSort = (key: SortKey) => {
    if (key === sortBy) {
      setDirection(direction === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      // Numeric columns default to desc (worst-first); route name
      // defaults to asc.
      setDirection(key === 'route' ? 'asc' : 'desc')
    }
  }

  return (
    <div className="sentori-page-in">
      <PageHeader
        actions={
          <select
            aria-label="Release"
            className="border-border bg-bg-secondary text-fg focus:border-accent border px-2 py-1 font-mono text-[12px] focus:outline-none"
            onChange={(e) => setRelease(e.target.value)}
            value={release}
          >
            <option value="">— pick release —</option>
            {releases.map((r) => (
              <option key={r.release} value={r.release}>
                {r.release} · {r.eventCount} ev · {formatRelative(r.lastSeen)}
              </option>
            ))}
          </select>
        }
        subtitle="find-slow lens · per-route p50/p95"
        title="Vitals"
      />

      {(releasesQ.isError || reportQ.isError) && (
        <p className="border-border text-danger border-y py-6 text-center text-[13px]">
          Failed to load vitals. Refresh to retry.
        </p>
      )}
      {!report && !releasesQ.isError && !reportQ.isError && reportQ.isLoading && (
        <p className="border-border text-fg-secondary border-y py-6 text-center text-[13px]">
          Loading…
        </p>
      )}
      {!report &&
        !releasesQ.isError &&
        !reportQ.isError &&
        !reportQ.isLoading &&
        releases.length === 0 && (
          <p className="border-border text-fg-secondary border-y py-6 text-center text-[13px]">
            No releases with vitals data yet. The SDK starts populating after the first cold-start
            measurement on a build with `mobile-vitals` enabled.
          </p>
        )}

      {report && (
        <div className="rule-grid grid-cols-1 sm:grid-cols-3">
          <Stat label="release" value={<span className="font-mono">{report.release}</span>} />
          <Stat
            label="cold start"
            sub={
              report.coldStart.samples > 0
                ? `p95 ${report.coldStart.p95Ms}ms · ${report.coldStart.samples} samples`
                : 'no samples'
            }
            value={
              report.coldStart.samples > 0 ? (
                <>
                  <span className="tabular-nums">{report.coldStart.p50Ms}</span>
                  <span className="text-fg-muted ml-1 text-[14px]">ms p50</span>
                </>
              ) : (
                <span className="text-fg-muted text-[16px]">SDK ≥ 0.8.6 needed</span>
              )
            }
          />
          <Stat
            label="routes tracked"
            value={<span className="tabular-nums">{report.perRoute.length}</span>}
          />
        </div>
      )}

      {comparedRoutes.length >= 2 && (
        <CompareStrip
          baseline={comparedRoutes[0]!}
          rows={comparedRoutes.slice(1)}
          onClear={() => setCompareParam('')}
        />
      )}

      <SubSection sub={`${report?.perRoute.length ?? 0} routes`} title="Per-route vitals">
        {!report || report.perRoute.length === 0 ? (
          <EmptyState>
            No route vitals yet. Mount{' '}
            <code className="text-fg font-mono">useTraceNavigation(navigationRef)</code> in your app
            and pick a release with traffic.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="bench min-w-[860px]">
              <thead>
                <tr>
                  <th className="w-[34px]">cmp</th>
                  <SortableTh
                    direction={direction}
                    label="route"
                    name="route"
                    onClick={() => onChangeSort('route')}
                    sortBy={sortBy}
                  />
                  <th className="num">nav</th>
                  <th className="num">ttid p50</th>
                  <SortableTh
                    direction={direction}
                    label="ttid p95"
                    name="ttidP95"
                    numeric
                    onClick={() => onChangeSort('ttidP95')}
                    sortBy={sortBy}
                  />
                  <th className="num">ttfd p50</th>
                  <SortableTh
                    direction={direction}
                    label="ttfd p95"
                    name="ttfdP95"
                    numeric
                    onClick={() => onChangeSort('ttfdP95')}
                    sortBy={sortBy}
                  />
                  <SortableTh
                    direction={direction}
                    label="slow"
                    name="slow"
                    numeric
                    onClick={() => onChangeSort('slow')}
                    sortBy={sortBy}
                  />
                  <SortableTh
                    direction={direction}
                    label="frozen"
                    name="frozen"
                    numeric
                    onClick={() => onChangeSort('frozen')}
                    sortBy={sortBy}
                  />
                </tr>
              </thead>
              <tbody>
                {sortedRoutes.map((r) => {
                  const isCompared = compareSet.has(r.route)
                  const canAdd = compareSet.size < 4 || isCompared
                  return (
                    <tr key={r.route} className={isCompared ? 'bg-accent/10' : ''}>
                      <td className="num">
                        <input
                          aria-label={`compare ${r.route}`}
                          checked={isCompared}
                          disabled={!canAdd}
                          onChange={() => toggleCompare(r.route)}
                          type="checkbox"
                        />
                      </td>
                      <td className="lead">
                        {/* Drill: route → Issues list filtered by tag.route */}
                        <Link
                          className="text-fg hover:text-accent"
                          to={`/main/org/${currentOrg.slug}/issues?tag=route:${encodeURIComponent(r.route)}`}
                        >
                          {r.route}
                        </Link>
                      </td>
                      <td className="num">{r.navigations.toLocaleString()}</td>
                      <td className="num">{r.ttidP50Ms}ms</td>
                      <td className="num">{r.ttidP95Ms}ms</td>
                      <td className="num">{r.ttfdSamples > 0 ? `${r.ttfdP50Ms}ms` : '—'}</td>
                      <td className="num">{r.ttfdSamples > 0 ? `${r.ttfdP95Ms}ms` : '—'}</td>
                      <td className={`num ${r.totalSlowFrames > 0 ? 'text-warning' : ''}`}>
                        {r.totalSlowFrames}
                      </td>
                      <td className={`num ${r.totalFrozenFrames > 0 ? 'text-danger' : ''}`}>
                        {r.totalFrozenFrames}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SubSection>
    </div>
  )
}

function SortableTh({
  direction,
  label,
  name,
  numeric,
  onClick,
  sortBy,
}: {
  direction: Direction
  label: string
  name: SortKey
  numeric?: boolean
  onClick: () => void
  sortBy: SortKey
}) {
  const active = sortBy === name
  return (
    <th className={numeric ? 'num' : undefined}>
      <button
        className={`hover:text-accent cursor-pointer font-mono text-[10px] tracking-[0.18em] uppercase ${
          active ? 'text-accent' : 'text-fg-muted'
        }`}
        onClick={onClick}
        type="button"
      >
        {label}
        {active && <span aria-hidden> {direction === 'desc' ? '↓' : '↑'}</span>}
      </button>
    </th>
  )
}

/** v2.5 — compare mode. Shows numeric deltas of each subsequent
 *  selected row against the baseline (first-selected). Bold +
 *  coloured when the delta crosses a meaningful threshold for
 *  the measure (TTID p95 ±10%, slow frames any difference). */
function CompareStrip({
  baseline,
  onClear,
  rows,
}: {
  baseline: { route: string; ttidP50Ms: number; ttidP95Ms: number; totalSlowFrames: number }
  onClear: () => void
  rows: {
    route: string
    ttidP50Ms: number
    ttidP95Ms: number
    totalSlowFrames: number
  }[]
}) {
  return (
    <section className="border-border mt-6 border-y py-3">
      <header className="mb-2 flex items-baseline justify-between">
        <span className="text-accent font-mono text-[10px] tracking-[0.22em] uppercase">
          compare · baseline {baseline.route}
        </span>
        <button
          className="text-fg-muted hover:text-danger cursor-pointer font-mono text-[10px] tracking-[0.18em] uppercase"
          onClick={onClear}
          type="button"
        >
          clear
        </button>
      </header>
      <table className="bench">
        <thead>
          <tr>
            <th>route</th>
            <th className="num">ttid p50 Δ</th>
            <th className="num">ttid p95 Δ</th>
            <th className="num">slow Δ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.route}>
              <td className="lead">{r.route}</td>
              <td className="num">{deltaMs(r.ttidP50Ms, baseline.ttidP50Ms)}</td>
              <td className="num">
                {deltaMs(r.ttidP95Ms, baseline.ttidP95Ms, /* threshold */ 0.1)}
              </td>
              <td className="num">{deltaCount(r.totalSlowFrames, baseline.totalSlowFrames)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

function deltaMs(actual: number, baseline: number, threshold = 0.05) {
  const diff = actual - baseline
  const pct = baseline > 0 ? diff / baseline : 0
  const text = `${diff >= 0 ? '+' : ''}${diff}ms (${(pct * 100).toFixed(0)}%)`
  if (Math.abs(pct) >= threshold) {
    const cls = diff > 0 ? 'text-danger' : 'text-success'
    return <span className={`font-bold ${cls}`}>{text}</span>
  }
  return <span>{text}</span>
}

function deltaCount(actual: number, baseline: number) {
  const diff = actual - baseline
  if (diff === 0) return '—'
  const cls = diff > 0 ? 'text-warning' : 'text-success'
  return <span className={`font-bold ${cls}`}>{diff > 0 ? `+${diff}` : diff}</span>
}

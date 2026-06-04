import { Alert, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { Link } from 'react-router'

import { adminApi } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'
import { useUrlParam } from '@/lib/url-state'

type SortKey = 'frozen' | 'route' | 'slow' | 'ttfdP95' | 'ttidP95'
type Direction = 'asc' | 'desc'

type RouteRow = {
  route: string
  navigations: number
  ttidP50Ms: number
  ttidP95Ms: number
  ttfdP50Ms: number
  ttfdP95Ms: number
  ttfdSamples: number
  totalSlowFrames: number
  totalFrozenFrames: number
}

/**
 * Vitals — find-slow lens. KPI strip + per-route DataTable + an
 * inline compare panel (up to 4 routes, shown when ≥ 2 selected).
 * Drill: route name links into Issues filtered by `?tag=route:<x>`.
 */
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

  const sortedRoutes = useMemo<RouteRow[]>(() => {
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

  const comparedRoutes = sortedRoutes.filter((r) => compareSet.has(r.route))

  const toggleCompare = (route: string) => {
    const next = new Set(compareSet)
    if (next.has(route)) next.delete(route)
    else if (next.size < 4) next.add(route)
    setCompareParam(Array.from(next).join(','))
  }

  return (
    <div className="space-y-4">
      <PageHeader
        actions={<ReleaseSelect onChange={setRelease} releases={releases} value={release} />}
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'vitals' },
        ]}
        subtitle="find-slow lens · per-route p50 / p95"
        title="Vitals"
      />

      {(releasesQ.isError || reportQ.isError) && (
        <Alert title="Failed to load vitals" variant="danger">
          Refresh to retry. If this persists, check the dashboard&apos;s connection to the server.
        </Alert>
      )}

      {report && (
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard label="release">
            <span className="text-fg font-mono text-[15px]">{report.release}</span>
          </StatCard>
          <StatCard
            label="cold start"
            sublabel={
              report.coldStart.samples > 0
                ? `p95 ${report.coldStart.p95Ms} ms · ${report.coldStart.samples} samples`
                : 'no samples'
            }
          >
            {report.coldStart.samples > 0 ? (
              <span className="text-fg">
                <span className="text-[22px] font-semibold tabular-nums">
                  {report.coldStart.p50Ms}
                </span>
                <span className="text-fg-muted ml-1 text-[13px]">ms p50</span>
              </span>
            ) : (
              <span className="text-fg-muted text-[14px]">SDK ≥ 0.8.6 needed</span>
            )}
          </StatCard>
          <StatCard label="routes tracked">
            <span className="text-fg text-[22px] font-semibold tabular-nums">
              {report.perRoute.length}
            </span>
          </StatCard>
        </div>
      )}

      {comparedRoutes.length >= 2 && (
        <CompareCard
          baseline={comparedRoutes[0]!}
          onClear={() => setCompareParam('')}
          rows={comparedRoutes.slice(1)}
        />
      )}

      {!report && reportQ.isLoading && (
        <Card>
          <EmptyState description="Fetching route vitals…" title="Loading" />
        </Card>
      )}

      {report && report.perRoute.length === 0 && (
        <Card>
          <EmptyState
            description="Mount useTraceNavigation(navigationRef) in your app and pick a release with traffic."
            title="No route vitals yet"
          />
        </Card>
      )}

      {report && report.perRoute.length > 0 && (
        <DataTable
          columns={routeColumns(currentOrg.slug, compareSet, toggleCompare)}
          density="compact"
          highlightOnHover
          onSort={(key) => {
            const k = key as SortKey
            if (k === sortBy) setDirection(direction === 'asc' ? 'desc' : 'asc')
            else {
              setSortBy(k)
              setDirection(k === 'route' ? 'asc' : 'desc')
            }
          }}
          rowKey="route"
          rows={sortedRoutes}
          sortDir={direction}
          sortKey={sortBy}
          stickyHeader
          striped
        />
      )}
    </div>
  )
}

/**
 * Generic KPI card — GDS `MetricCard` only supports `value:
 * string | number`, so the dashboard's mixed-content KPI strip
 * (label tag + big value + optional sublabel + JSX content) gets
 * its own Card composition. Same density as GDS's MetricCard via
 * `gds-pad` + `gds-gap`.
 */
function StatCard({
  children,
  label,
  sublabel,
}: {
  children: React.ReactNode
  label: string
  sublabel?: string
}) {
  return (
    <Card>
      <div className="flex flex-col gap-1.5">
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.22em] uppercase">
          {label}
        </span>
        <span>{children}</span>
        {sublabel && (
          <span className="text-fg-muted font-mono text-[10px] tabular-nums">{sublabel}</span>
        )}
      </div>
    </Card>
  )
}

function routeColumns(
  orgSlug: string,
  compareSet: Set<string>,
  toggleCompare: (route: string) => void
) {
  return [
    {
      key: 'compare',
      label: '',
      width: '40px',
      render: (_v: unknown, r: RouteRow) => {
        const isCompared = compareSet.has(r.route)
        const canAdd = compareSet.size < 4 || isCompared
        return (
          <input
            aria-label={`compare ${r.route}`}
            checked={isCompared}
            disabled={!canAdd}
            onChange={() => toggleCompare(r.route)}
            type="checkbox"
          />
        )
      },
    },
    {
      key: 'route',
      label: 'Route',
      sortable: true,
      render: (_v: unknown, r: RouteRow) => (
        <Link
          className="text-fg hover:text-accent font-mono text-[12px]"
          to={`/main/org/${orgSlug}/issues?tag=route:${encodeURIComponent(r.route)}`}
        >
          {r.route}
        </Link>
      ),
    },
    {
      align: 'right' as const,
      key: 'navigations',
      label: 'Nav',
      width: '70px',
      render: (_v: unknown, r: RouteRow) => (
        <span className="font-mono text-[12px] tabular-nums">{r.navigations.toLocaleString()}</span>
      ),
    },
    {
      align: 'right' as const,
      key: 'ttidP50',
      label: 'TTID p50',
      width: '90px',
      render: (_v: unknown, r: RouteRow) => (
        <span className="font-mono text-[12px] tabular-nums">{r.ttidP50Ms}ms</span>
      ),
    },
    {
      align: 'right' as const,
      key: 'ttidP95',
      label: 'TTID p95',
      sortable: true,
      width: '90px',
      render: (_v: unknown, r: RouteRow) => (
        <span className="font-mono text-[12px] tabular-nums">{r.ttidP95Ms}ms</span>
      ),
    },
    {
      align: 'right' as const,
      key: 'ttfdP50',
      label: 'TTFD p50',
      width: '90px',
      render: (_v: unknown, r: RouteRow) => (
        <span className="text-fg-muted font-mono text-[12px] tabular-nums">
          {r.ttfdSamples > 0 ? `${r.ttfdP50Ms}ms` : '—'}
        </span>
      ),
    },
    {
      align: 'right' as const,
      key: 'ttfdP95',
      label: 'TTFD p95',
      sortable: true,
      width: '90px',
      render: (_v: unknown, r: RouteRow) => (
        <span className="text-fg-muted font-mono text-[12px] tabular-nums">
          {r.ttfdSamples > 0 ? `${r.ttfdP95Ms}ms` : '—'}
        </span>
      ),
    },
    {
      align: 'right' as const,
      key: 'slow',
      label: 'Slow',
      sortable: true,
      width: '70px',
      render: (_v: unknown, r: RouteRow) => (
        <span
          className={`font-mono text-[12px] tabular-nums ${r.totalSlowFrames > 0 ? 'text-warning' : 'text-fg-muted'}`}
        >
          {r.totalSlowFrames}
        </span>
      ),
    },
    {
      align: 'right' as const,
      key: 'frozen',
      label: 'Frozen',
      sortable: true,
      width: '70px',
      render: (_v: unknown, r: RouteRow) => (
        <span
          className={`font-mono text-[12px] tabular-nums ${r.totalFrozenFrames > 0 ? 'text-danger' : 'text-fg-muted'}`}
        >
          {r.totalFrozenFrames}
        </span>
      ),
    },
  ]
}

function ReleaseSelect({
  onChange,
  releases,
  value,
}: {
  onChange: (v: string) => void
  releases: { release: string; eventCount: number; lastSeen: string }[]
  value: string
}) {
  return (
    <select
      aria-label="Release"
      className="border-border bg-bg-secondary text-fg focus:border-accent gds-h-sm gds-pad-x-sm border font-mono text-[12px] focus:outline-none"
      onChange={(e) => onChange(e.target.value)}
      value={value}
    >
      <option value="">— pick release —</option>
      {releases.map((r) => (
        <option key={r.release} value={r.release}>
          {r.release} · {r.eventCount} ev · {formatRelative(r.lastSeen)}
        </option>
      ))}
    </select>
  )
}

/**
 * Compare panel — `comparedRoutes[0]` is the baseline, subsequent
 * rows render p50 / p95 / slow deltas. Bold + danger when the delta
 * crosses a meaningful threshold (p95 ±10%, slow ≠ 0).
 */
function CompareCard({
  baseline,
  onClear,
  rows,
}: {
  baseline: RouteRow
  onClear: () => void
  rows: RouteRow[]
}) {
  return (
    <Card>
      <header className="mb-3 flex items-baseline justify-between">
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
      <table className="w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-border border-b">
            <th className="text-fg-muted py-2 text-left font-mono text-[10px] font-medium tracking-[0.15em] uppercase">
              Route
            </th>
            <th className="text-fg-muted py-2 text-right font-mono text-[10px] font-medium tracking-[0.15em] uppercase">
              TTID p50 Δ
            </th>
            <th className="text-fg-muted py-2 text-right font-mono text-[10px] font-medium tracking-[0.15em] uppercase">
              TTID p95 Δ
            </th>
            <th className="text-fg-muted py-2 text-right font-mono text-[10px] font-medium tracking-[0.15em] uppercase">
              Slow Δ
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr className="border-border-muted border-b last:border-0" key={r.route}>
              <td className="text-fg py-1.5 font-mono">{r.route}</td>
              <td className="py-1.5 text-right font-mono tabular-nums">
                {deltaMs(r.ttidP50Ms, baseline.ttidP50Ms)}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums">
                {deltaMs(r.ttidP95Ms, baseline.ttidP95Ms, 0.1)}
              </td>
              <td className="py-1.5 text-right font-mono tabular-nums">
                {deltaCount(r.totalSlowFrames, baseline.totalSlowFrames)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
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
  return <span className="text-fg-secondary">{text}</span>
}

function deltaCount(actual: number, baseline: number) {
  const diff = actual - baseline
  if (diff === 0) return <span className="text-fg-muted">—</span>
  const cls = diff > 0 ? 'text-warning' : 'text-success'
  return <span className={`font-bold ${cls}`}>{diff > 0 ? `+${diff}` : diff}</span>
}

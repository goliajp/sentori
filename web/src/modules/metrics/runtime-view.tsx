// v2.1 W3 — runtime metrics dashboard.
//
// Six hero cards (FPS / Heap / Cold-start / Network sent /
// Network received / Route nav) showing the most recent
// 24 h p95 with a delta vs the previous 24 h. Below them, a
// BI panel: dim × measure × bucket pickers driving a single
// time-series chart for the currently-selected hero.
//
// Server endpoint: GET /admin/api/projects/<p>/runtime-metrics/query.
// Picks the rollup tier (raw / _1m / _1h / _1d) per
// docs/design/v2-metrics.md. UI surfaces the picked tier as a
// resolution badge below the chart.

import { Card, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { CenteredEmpty } from '@/components/Hint'
import { RowSkeleton } from '@/components/Skeleton'
import { qk } from '@/api/query-keys'

type MetricSpec = {
  /** The canonical metric name as written by the SDK auto-instrument. */
  name: string
  /** Display label on the hero card. */
  label: string
  /** Default measure for the hero — what the BI panel starts on. */
  measure: 'avg' | 'count' | 'p50' | 'p95' | 'p99' | 'sum'
  /** Unit suffix for the rendered number ("ms" / "fps" / etc.). */
  unit: string
  /** Higher-is-better? Drives the delta-chip color. */
  higherIsBetter: boolean
}

const METRICS: MetricSpec[] = [
  { name: 'runtime.fps.p50', label: 'FPS p50', measure: 'avg', unit: 'fps', higherIsBetter: true },
  {
    name: 'runtime.heap.used_bytes',
    label: 'JS heap p95',
    measure: 'p95',
    unit: 'MB',
    higherIsBetter: false,
  },
  {
    name: 'runtime.cold_start_ms',
    label: 'Cold start p95',
    measure: 'p95',
    unit: 'ms',
    higherIsBetter: false,
  },
  {
    name: 'runtime.network.bytes_sent',
    label: 'Network sent',
    measure: 'sum',
    unit: 'KB/m',
    higherIsBetter: false,
  },
  {
    name: 'runtime.network.bytes_received',
    label: 'Network received',
    measure: 'sum',
    unit: 'KB/m',
    higherIsBetter: false,
  },
  {
    name: 'runtime.route_nav_ms',
    label: 'Route dwell p95',
    measure: 'p95',
    unit: 'ms',
    higherIsBetter: false,
  },
]

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * ONE_DAY_MS).toISOString()
}

function isoNow(): string {
  return new Date().toISOString()
}

/** Width in ms of one bucket, used by the drill modal to size the
 *  "issues in this window" query around the clicked point. */
function bucketMs(bucket: '1d' | '1h' | '1m' | '5m' | '15m'): number {
  switch (bucket) {
    case '1m':
      return 60_000
    case '5m':
      return 5 * 60_000
    case '15m':
      return 15 * 60_000
    case '1h':
      return 60 * 60_000
    case '1d':
      return 24 * 60 * 60_000
  }
}

/** Format a raw metric value for hero card display. */
function formatHero(value: number, unit: string): string {
  if (unit === 'MB') return (value / 1_000_000).toFixed(1)
  if (unit === 'KB/m') return (value / 1000 / 60).toFixed(1)
  if (unit === 'fps' || unit === 'ms') {
    return Number.isInteger(value) ? value.toString() : value.toFixed(0)
  }
  return value.toString()
}

export function RuntimeMetricsView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const [selected, setSelected] = useState<string>(METRICS[0]!.name)
  const selectedSpec = METRICS.find((m) => m.name === selected) ?? METRICS[0]!

  const [dim, setDim] = useState<'device_class' | 'environment' | 'none' | 'release'>('none')
  const [measure, setMeasure] = useState<'avg' | 'count' | 'p50' | 'p95' | 'p99' | 'sum'>(
    selectedSpec.measure
  )
  const [bucket, setBucket] = useState<'1d' | '1h' | '1m' | '5m' | '15m'>('5m')

  const [drill, setDrill] = useState<null | {
    ts: string
    value: number
    seriesLabel: string
  }>(null)

  const window = useMemo(
    () => ({ from: isoDaysAgo(1), to: isoNow() }),
    // intentionally empty — pin the window for the page lifetime so
    // every chart query hits the same cache key

    []
  )

  const chartQ = useQuery({
    enabled: !!projectId,
    queryFn: () =>
      adminApi.queryRuntimeMetrics(projectId!, {
        bucket,
        dim,
        from: window.from,
        measure,
        name: selected,
        to: window.to,
      }),
    queryKey: qk.metrics.runtime(
      projectId ?? '',
      selected,
      dim,
      measure,
      bucket,
      window.from,
      window.to
    ),
  })

  if (!projectId) return null

  return (
    <div className="space-y-5">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'runtime' },
        ]}
        subtitle="Auto-instrumented FPS, heap, cold-start, route nav, network. Last 24 h."
        title="Runtime"
      />

      {/* Hero cards. Click a card to drive the chart below. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {METRICS.map((m) => (
          <HeroCard
            isSelected={m.name === selected}
            key={m.name}
            onSelect={() => {
              setSelected(m.name)
              setMeasure(m.measure)
            }}
            projectId={projectId}
            spec={m}
            window={window}
          />
        ))}
      </div>

      <Card>
        <header className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
          <h2 className="text-fg text-[16px] font-semibold tracking-tight">{selectedSpec.label}</h2>
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.12em] uppercase">
            {selected}
          </span>
        </header>

        {/* Pickers */}
        <div className="flex flex-wrap gap-2">
          <Picker
            label="dim"
            options={[
              { label: 'none', value: 'none' },
              { label: 'release', value: 'release' },
              { label: 'environment', value: 'environment' },
              { label: 'device class', value: 'device_class' },
            ]}
            value={dim}
            onChange={(v) => setDim(v as 'device_class' | 'environment' | 'none' | 'release')}
          />
          <Picker
            label="measure"
            options={[
              { label: 'avg', value: 'avg' },
              { label: 'p50', value: 'p50' },
              { label: 'p95', value: 'p95' },
              { label: 'p99', value: 'p99' },
              { label: 'sum', value: 'sum' },
              { label: 'count', value: 'count' },
            ]}
            value={measure}
            onChange={(v) => setMeasure(v as 'avg' | 'count' | 'p50' | 'p95' | 'p99' | 'sum')}
          />
          <Picker
            label="bucket"
            options={[
              { label: '1m', value: '1m' },
              { label: '5m', value: '5m' },
              { label: '15m', value: '15m' },
              { label: '1h', value: '1h' },
              { label: '1d', value: '1d' },
            ]}
            value={bucket}
            onChange={(v) => setBucket(v as '1d' | '1h' | '1m' | '5m' | '15m')}
          />
        </div>

        {/* Chart */}
        <div className="border-border/40 bg-bg mt-3 border p-4">
          {chartQ.isLoading && <RowSkeleton count={3} height="60px" />}
          {chartQ.error && <CenteredEmpty>Failed to load this metric.</CenteredEmpty>}
          {chartQ.data && chartQ.data.series.every((s) => s.points.length === 0) && (
            <CenteredEmpty>
              No data in the last 24 h.
              <br />
              Make sure the host SDK is on @goliapkg/sentori-react-native ≥ 2.1.0 and
              <br />
              <code className="text-[11px]">capture.runtimeMetrics: true</code> is set.
            </CenteredEmpty>
          )}
          {chartQ.data && chartQ.data.series.some((s) => s.points.length > 0) && (
            <>
              <TimeseriesSvg
                series={chartQ.data.series}
                unit={selectedSpec.unit}
                onPointClick={(ts, value, seriesLabel) => setDrill({ seriesLabel, ts, value })}
              />
              <div className="text-fg-muted mt-2 flex items-center justify-between font-mono text-[10px] tracking-[0.08em] uppercase">
                <span>
                  resolution: <code>{chartQ.data.tier}</code>
                </span>
                <span>{chartQ.data.series.length} series · click a point to drill</span>
              </div>
            </>
          )}
        </div>
      </Card>

      {drill && projectId && currentOrg && (
        <DrillModal
          bucket={bucket}
          metricLabel={selectedSpec.label}
          onClose={() => setDrill(null)}
          orgSlug={currentOrg.slug}
          point={drill}
          projectId={projectId}
          unit={selectedSpec.unit}
        />
      )}
    </div>
  )
}

type DrillModalProps = {
  bucket: '1d' | '1h' | '1m' | '5m' | '15m'
  metricLabel: string
  onClose: () => void
  orgSlug: string
  point: { ts: string; value: number; seriesLabel: string }
  projectId: string
  unit: string
}

/** Drill from a chart point → issues active in that bucket window.
 *  Listing is a thin wrapper around `listIssuesPage(..., {
 *  lastSeenAfter })`; the bucket-end is the floor for "still active
 *  here" since the issues endpoint has no upper-bound filter. Each
 *  row links to the canonical issue detail page so the drill is a
 *  one-click step into the existing triage flow.
 *
 *  Modeled on the CmdK overlay (no Dialog library — backdrop click +
 *  Escape close, mirroring `CmdK.tsx`'s pattern). */
function DrillModal({
  bucket,
  metricLabel,
  onClose,
  orgSlug,
  point,
  projectId,
  unit,
}: DrillModalProps) {
  const tsMs = new Date(point.ts).getTime()
  const halfMs = bucketMs(bucket) / 2
  const windowFromIso = new Date(tsMs - halfMs).toISOString()

  const issuesQ = useQuery({
    queryFn: () => adminApi.listIssuesPage(projectId, { lastSeenAfter: windowFromIso, limit: 10 }),
    // Carve out a distinct key namespace so the drill panel's
    // narrowly-filtered list doesn't collide with the main Issues
    // page cache (which keys off `qk.issue.list(projectId, tab)`).
    queryKey: ['runtime-drill-issues', projectId, windowFromIso] as const,
  })

  // Escape-to-close, matching CmdK.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const formattedTs = new Date(point.ts).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  })
  const formattedValue = formatHero(point.value, unit)
  const issues = issuesQ.data?.issues ?? []

  return (
    <div
      aria-modal
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="dialog"
      style={{ background: 'rgb(from var(--color-fg) r g b / 0.32)' }}
    >
      <div
        className="border-border bg-bg w-[36rem] max-w-[92vw] overflow-hidden border"
        style={{ boxShadow: '0 24px 64px -16px rgb(from var(--color-fg) r g b / 0.5)' }}
      >
        <div className="border-border border-b px-5 py-3">
          <div className="text-accent font-mono text-[10px] tracking-[0.18em] uppercase">drill</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span
              className="text-fg"
              style={{
                fontVariationSettings: "'wdth' 95, 'opsz' 32, 'wght' 580",
                fontSize: '16px',
              }}
            >
              {metricLabel}
            </span>
            <span className="text-fg-muted font-mono text-[11px]">
              {point.seriesLabel || '—'} · {formattedValue} {unit}
            </span>
          </div>
          <div className="text-fg-muted mt-1 font-mono text-[10px]">
            {formattedTs} (± {bucket})
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {issuesQ.isLoading && (
            <div className="px-5 py-3">
              <RowSkeleton count={4} height="44px" />
            </div>
          )}
          {issuesQ.error && (
            <p className="text-fg-muted px-5 py-4 text-[12px]">Failed to load issues.</p>
          )}
          {issuesQ.data && issues.length === 0 && (
            <p className="text-fg-muted px-5 py-4 text-[12px]">No issues active in this window.</p>
          )}
          {issues.length > 0 && (
            <ul>
              {issues.map((iss) => (
                <li key={iss.id}>
                  <Link
                    className="border-border/40 hover:bg-bg-secondary block border-b px-5 py-2 transition-colors"
                    onClick={onClose}
                    to={`/main/org/${orgSlug}/issues/${iss.id}`}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-fg truncate text-[13px]">{iss.errorType}</span>
                      <span className="text-fg-muted shrink-0 font-mono text-[10px] tabular-nums">
                        {iss.eventCount}×
                      </span>
                    </div>
                    <div className="text-fg-muted truncate font-mono text-[11px]">
                      {iss.messageSample}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-border bg-bg-secondary text-fg-muted flex items-center gap-3 border-t px-5 py-2 font-mono text-[10px] tracking-[0.15em] uppercase">
          <span>esc to close</span>
          <Link
            className="text-accent ml-auto hover:underline"
            onClick={onClose}
            to={`/main/org/${orgSlug}/issues`}
          >
            all issues →
          </Link>
        </div>
      </div>
    </div>
  )
}

type HeroCardProps = {
  isSelected: boolean
  onSelect: () => void
  projectId: string
  spec: MetricSpec
  window: { from: string; to: string }
}

function HeroCard({ isSelected, onSelect, projectId, spec, window }: HeroCardProps) {
  // Pull the last 24 h aggregated to one bucket — that's the
  // hero number. Server picks the right tier for a 24 h window
  // automatically (lands on _1m).
  const q = useQuery({
    queryFn: () =>
      adminApi.queryRuntimeMetrics(projectId, {
        bucket: '1d',
        dim: 'none',
        from: window.from,
        measure: spec.measure,
        name: spec.name,
        to: window.to,
      }),
    queryKey: qk.metrics.runtime(
      projectId,
      spec.name,
      'none',
      spec.measure,
      '1d',
      window.from,
      window.to
    ),
  })
  const point = q.data?.series[0]?.points[0]
  const value = point?.value
  const displayValue = value !== undefined ? formatHero(value, spec.unit) : '—'

  return (
    <button
      className={`group flex flex-col items-start gap-1 rounded border p-3 text-left transition-colors ${
        isSelected ? 'border-accent bg-bg-secondary' : 'border-border hover:border-fg-muted'
      }`}
      onClick={onSelect}
      type="button"
    >
      <div className="text-fg-muted font-mono text-[10px] tracking-[0.12em] uppercase">
        {spec.label}
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className="text-fg tabular-nums"
          style={{
            fontVariationSettings: "'wdth' 90, 'opsz' 48, 'wght' 500",
            fontSize: '26px',
            letterSpacing: '-0.02em',
            lineHeight: 1.0,
          }}
        >
          {displayValue}
        </span>
        <span className="text-fg-muted text-[11px]">{spec.unit}</span>
      </div>
      <div className="text-fg-muted font-mono text-[9px] tracking-[0.1em] uppercase">
        24 h {spec.measure}
      </div>
    </button>
  )
}

type PickerProps<T extends string> = {
  label: string
  onChange: (v: string) => void
  options: { label: string; value: T }[]
  value: string
}

function Picker<T extends string>({ label, onChange, options, value }: PickerProps<T>) {
  return (
    <label className="text-fg-muted inline-flex items-center gap-1.5 text-[11px]">
      <span className="font-mono tracking-[0.1em] uppercase">{label}</span>
      <select
        className="border-border bg-bg text-fg rounded border px-1.5 py-0.5 text-[11px]"
        onChange={(e) => onChange(e.target.value)}
        value={value}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

// Minimal SVG timeseries chart. Renders every series as a polyline;
// the BI panel doesn't need per-point markers because the bucket
// picker already controls resolution. No external dep — keeps the
// dashboard bundle slim.
//
// v2.1.2 — per-point invisible hit targets (`r=8` transparent
// circles) feed `onPointClick` so the parent can open a drill modal
// scoped to that timestamp.
function TimeseriesSvg({
  onPointClick,
  series,
  unit,
}: {
  onPointClick?: (ts: string, value: number, seriesLabel: string) => void
  series: { label: string; points: { ts: string; value: number }[] }[]
  unit: string
}) {
  const W = 800
  const H = 200
  const PAD_L = 36
  const PAD_R = 8
  const PAD_T = 8
  const PAD_B = 22

  const points = series.flatMap((s) => s.points)
  if (points.length === 0) return null
  const tsMin = Math.min(...points.map((p) => new Date(p.ts).getTime()))
  const tsMax = Math.max(...points.map((p) => new Date(p.ts).getTime()))
  const tsSpan = Math.max(1, tsMax - tsMin)
  const vMin = Math.min(...points.map((p) => p.value))
  const vMax = Math.max(...points.map((p) => p.value))
  const vSpan = Math.max(1e-9, vMax - vMin)

  const xOf = (ts: string) =>
    PAD_L + ((new Date(ts).getTime() - tsMin) / tsSpan) * (W - PAD_L - PAD_R)
  const yOf = (v: number) => H - PAD_B - ((v - vMin) / vSpan) * (H - PAD_T - PAD_B)

  // Color palette — series N uses palette[N % palette.length].
  const palette = ['var(--color-accent)', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4']

  return (
    <svg className="w-full" height={H} viewBox={`0 0 ${W} ${H}`}>
      {/* Y axis gridlines + labels */}
      {[0, 0.5, 1].map((q) => {
        const v = vMin + (vMax - vMin) * (1 - q)
        const y = PAD_T + q * (H - PAD_T - PAD_B)
        return (
          <g key={q}>
            <line
              stroke="var(--color-border)"
              strokeDasharray="2 3"
              x1={PAD_L}
              x2={W - PAD_R}
              y1={y}
              y2={y}
            />
            <text
              fill="var(--color-fg-muted)"
              fontSize="10"
              textAnchor="end"
              x={PAD_L - 4}
              y={y + 3}
            >
              {v.toFixed(v < 10 ? 1 : 0)}
            </text>
          </g>
        )
      })}
      {/* Series polylines */}
      {series.map((s, i) =>
        s.points.length > 0 ? (
          <polyline
            fill="none"
            key={s.label || `s${i}`}
            points={s.points
              .map((p) => `${xOf(p.ts).toFixed(1)},${yOf(p.value).toFixed(1)}`)
              .join(' ')}
            stroke={palette[i % palette.length]}
            strokeWidth="1.5"
          />
        ) : null
      )}
      {/* Per-point hit targets. Transparent circles sized larger than
       *  the stroke so the cursor doesn't have to land on a 1.5 px
       *  line. Visible feedback is just the cursor change (pointer)
       *  + opacity bump on hover, no fixed markers — that keeps the
       *  chart visually clean. */}
      {onPointClick &&
        series.map((s, i) =>
          s.points.map((p, j) => (
            <circle
              cx={xOf(p.ts)}
              cy={yOf(p.value)}
              fill={palette[i % palette.length]}
              fillOpacity={0}
              key={`hit-${i}-${j}`}
              onClick={() => onPointClick(p.ts, p.value, s.label)}
              onMouseEnter={(e) => {
                e.currentTarget.setAttribute('fill-opacity', '0.7')
              }}
              onMouseLeave={(e) => {
                e.currentTarget.setAttribute('fill-opacity', '0')
              }}
              r={8}
              style={{ cursor: 'pointer' }}
            >
              <title>{`${s.label || 'series'} · ${p.value.toFixed(2)} ${unit} · ${new Date(p.ts).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`}</title>
            </circle>
          ))
        )}
      {/* X axis label — just the unit, time scale is implied (24 h). */}
      <text fill="var(--color-fg-muted)" fontSize="10" x={PAD_L} y={H - 6}>
        {unit}
      </text>
    </svg>
  )
}

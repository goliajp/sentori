import { useMemo, useState } from 'react'

/**
 * Phase 50 sub-A2 — multi-series line chart for time-series metrics.
 *
 * Hand-rolled SVG, no external dep. Renders:
 *   - axis baseline (subtle hairline)
 *   - one line per series with smooth area fill under it
 *   - x-axis ticks at the first / midpoint / last bucket
 *   - y-axis labels at top + bottom
 *   - hover crosshair + per-series readout
 *
 * Designed for the dashboard's existing health-bucket shape (an
 * array of `{ts, ...values}` records), but the `series` prop is
 * deliberately generic — pass any list of named numeric extractors.
 *
 * Use cases:
 *   - Overview "Sessions over time" (multi-line: total / crashed / errored)
 *   - Crash-free rate trends
 *   - Event-count vs time
 */

export type LineChartPoint = { ts: number | string } & Record<string, number | string>

export type LineChartSeries = {
  /** Color CSS value (var(--color-...) or hex). */
  color: string
  /** Label rendered in legend / tooltip. */
  label: string
  /** Field key to read from each data point. */
  key: string
}

export function LineChart({
  data,
  format = (v) => v.toLocaleString(),
  height = 160,
  series,
}: {
  data: LineChartPoint[]
  format?: (v: number) => string
  height?: number
  series: LineChartSeries[]
}) {
  const [hover, setHover] = useState<null | number>(null)

  const { domain, paths } = useMemo(() => {
    if (data.length === 0) return { domain: { max: 0, min: 0 }, paths: [] }
    let max = 0
    for (const p of data) {
      for (const s of series) {
        const v = numAt(p, s.key)
        if (v > max) max = v
      }
    }
    if (max === 0) max = 1
    return {
      domain: { max, min: 0 },
      paths: series.map((s) => buildPath(data, s.key, max, height)),
    }
  }, [data, series, height])

  if (data.length === 0) {
    return (
      <div
        className="text-fg-muted bg-bg-secondary border-border flex items-center justify-center rounded-md border text-[12px]"
        style={{ height }}
      >
        No data in this window.
      </div>
    )
  }

  const w = 1000
  const colW = w / Math.max(1, data.length - 1)

  return (
    <div className="border-border bg-bg-secondary relative rounded-md border">
      <svg
        height={height}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const x = ((e.clientX - rect.left) / rect.width) * w
          const idx = Math.round(x / colW)
          setHover(Math.max(0, Math.min(data.length - 1, idx)))
        }}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${w} ${height}`}
        width="100%"
      >
        {/* Hairline gridlines at the 50% and 100% marks. */}
        <line
          stroke="var(--color-border)"
          strokeDasharray="2 4"
          x1={0}
          x2={w}
          y1={height * 0.5}
          y2={height * 0.5}
        />
        {paths.map((p, i) => (
          <g key={series[i]!.key}>
            <path d={p.area} fill={series[i]!.color} opacity={0.12} />
            <path d={p.line} fill="none" stroke={series[i]!.color} strokeWidth={1.5} />
          </g>
        ))}
        {hover !== null && (
          <line
            stroke="var(--color-accent)"
            strokeOpacity={0.5}
            strokeWidth={1}
            x1={hover * colW}
            x2={hover * colW}
            y1={0}
            y2={height}
          />
        )}
      </svg>
      <div className="text-fg-muted absolute top-1 right-2 font-mono text-[10px] tabular-nums">
        {format(domain.max)}
      </div>
      <div className="text-fg-muted absolute bottom-1 left-2 font-mono text-[10px]">
        {formatTs(data[0]!.ts)}
      </div>
      <div className="text-fg-muted absolute right-2 bottom-1 font-mono text-[10px]">
        {formatTs(data[data.length - 1]!.ts)}
      </div>
      {hover !== null && (
        <div
          className="border-border bg-bg-tertiary text-fg pointer-events-none absolute rounded-md border px-2 py-1 text-[11px] shadow-lg"
          style={{
            left: `min(calc(100% - 12rem), ${(hover / Math.max(1, data.length - 1)) * 100}%)`,
            top: 4,
          }}
        >
          <div className="text-fg-muted mb-0.5 font-mono text-[10px]">
            {formatTs(data[hover]!.ts)}
          </div>
          {series.map((s) => (
            <div className="flex items-center gap-1.5" key={s.key}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              <span className="text-fg-muted">{s.label}</span>
              <span className="text-fg ml-auto font-mono tabular-nums">
                {format(numAt(data[hover]!, s.key))}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function numAt(p: LineChartPoint, key: string): number {
  const v = p[key]
  return typeof v === 'number' ? v : 0
}

function buildPath(
  data: LineChartPoint[],
  key: string,
  max: number,
  height: number
): { area: string; line: string } {
  const w = 1000
  const colW = w / Math.max(1, data.length - 1)
  const pad = 8
  const h = height - pad * 2
  const y = (v: number) => pad + h - (v / max) * h
  let line = ''
  let area = ''
  for (let i = 0; i < data.length; i++) {
    const x = i * colW
    const v = numAt(data[i]!, key)
    line += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y(v).toFixed(1)} `
  }
  if (data.length > 0) {
    area = `${line}L${((data.length - 1) * colW).toFixed(1)},${height} L0,${height} Z`
  }
  return { area, line }
}

function formatTs(ts: number | string): string {
  if (typeof ts === 'number') return new Date(ts).toLocaleTimeString([], { hour: '2-digit' })
  const d = new Date(ts)
  if (Number.isNaN(d.valueOf())) return String(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

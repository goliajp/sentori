import { useMemo, useState } from 'react'

/**
 * Phase 50 sub-A3 — issue impact bubble chart.
 *
 * X = event count (log scale; events span 1 → 1M)
 * Y = unique users / impact dimension
 * Size = "cost" weight passed in (event_count by default)
 *
 * Hand-rolled SVG with smooth hover. Designed for ≤ 500 bubbles —
 * past that the SVG path count gets heavy. For larger sets the caller
 * should pre-cap (top-N by cost) before passing in.
 */

export type BubblePoint = {
  /** Cost / size dimension. */
  cost: number
  id: string
  label: string
  onClick?: () => void
  x: number
  y: number
}

export function BubbleChart({
  height = 280,
  points,
  xLabel = 'x',
  yLabel = 'y',
}: {
  height?: number
  points: BubblePoint[]
  xLabel?: string
  yLabel?: string
}) {
  const [hover, setHover] = useState<null | string>(null)

  const items = useMemo(() => {
    if (points.length === 0) return []
    const xs = points.map((p) => Math.max(1, p.x))
    const ys = points.map((p) => Math.max(0, p.y))
    const cs = points.map((p) => Math.max(1, p.cost))
    const xMinL = Math.log10(Math.min(...xs))
    const xMaxL = Math.log10(Math.max(...xs))
    const yMin = Math.min(...ys)
    const yMax = Math.max(...ys, 1)
    const maxCost = Math.max(...cs)
    return points.map((p) => {
      const lx = Math.log10(Math.max(1, p.x))
      const fx = xMaxL === xMinL ? 0.5 : (lx - xMinL) / (xMaxL - xMinL)
      const fy = yMax === yMin ? 0.5 : (p.y - yMin) / (yMax - yMin)
      const fr = Math.max(0.05, Math.min(1, p.cost / maxCost))
      return { ...p, fr, fx, fy }
    })
  }, [points])
  const w = 1000

  if (points.length === 0) {
    return (
      <div
        className="text-fg-muted bg-bg-secondary border-border flex items-center justify-center rounded-md border text-[12px]"
        style={{ height }}
      >
        No issues to compare.
      </div>
    )
  }

  const pad = 24
  const ih = height - pad * 2

  return (
    <div className="border-border bg-bg-secondary relative rounded-md border p-3">
      <svg
        height={height}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${w} ${height}`}
        width="100%"
      >
        {/* Axes */}
        <line
          stroke="var(--color-border)"
          x1={pad}
          x2={w - pad}
          y1={height - pad}
          y2={height - pad}
        />
        <line stroke="var(--color-border)" x1={pad} x2={pad} y1={pad} y2={height - pad} />
        {items.map((p) => {
          const cx = pad + p.fx * (w - pad * 2)
          const cy = pad + (1 - p.fy) * ih
          const r = 4 + p.fr * 22
          const focused = hover === p.id
          return (
            <g
              key={p.id}
              onClick={p.onClick}
              onMouseEnter={() => setHover(p.id)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: p.onClick ? 'pointer' : 'default' }}
            >
              <circle
                cx={cx}
                cy={cy}
                fill="var(--color-accent)"
                fillOpacity={focused ? 0.5 : 0.25}
                r={r}
                stroke="var(--color-accent)"
                strokeOpacity={focused ? 1 : 0.5}
                strokeWidth={focused ? 1.5 : 1}
              />
              {focused && (
                <text
                  fill="var(--color-fg)"
                  fontSize="11"
                  textAnchor="middle"
                  x={cx}
                  y={cy - r - 4}
                >
                  {p.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="text-fg-muted absolute top-2 left-3 font-mono text-[10px]">{yLabel}</div>
      <div className="text-fg-muted absolute right-3 bottom-1 font-mono text-[10px]">
        {xLabel} →
      </div>
    </div>
  )
}

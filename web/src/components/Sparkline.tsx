/**
 * v2.2 — minimal inline-SVG sparkline.
 *
 * Pure SVG, no chart library — keeps the bundle thin and the
 * rendering predictable. Renders a single polyline + optional
 * baseline. The values array is the y-axis; x is implicit (evenly
 * spaced). Pass empty array → renders nothing.
 *
 * Sized via props so callers can drop it into a table cell
 * (16×40), a page-header strip (40×240), or a card kpi (60×120).
 */
export function Sparkline({
  values,
  width = 240,
  height = 40,
  stroke = 'currentColor',
  strokeWidth = 1.5,
  ariaLabel,
}: {
  values: number[]
  width?: number
  height?: number
  stroke?: string
  strokeWidth?: number
  ariaLabel?: string
}) {
  if (values.length === 0) {
    return (
      <svg
        aria-label={ariaLabel ?? 'sparkline: no data'}
        height={height}
        role="img"
        width={width}
      />
    )
  }

  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = Math.max(max - min, 1)

  const stepX = values.length > 1 ? width / (values.length - 1) : 0
  const points = values
    .map((v, i) => {
      const x = i * stepX
      const y = height - ((v - min) / range) * height
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  // Area under the curve, very faint, for visual heft.
  const areaPoints = `0,${height} ${points} ${width},${height}`

  return (
    <svg
      aria-label={ariaLabel ?? `sparkline of ${values.length} points, max ${max}`}
      height={height}
      role="img"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
    >
      <polygon fill={stroke} opacity={0.08} points={areaPoints} />
      <polyline
        fill="none"
        points={points}
        stroke={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
    </svg>
  )
}

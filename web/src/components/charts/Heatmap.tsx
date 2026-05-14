import { useMemo, useState } from 'react'

/**
 * Phase 50 sub-A4 — when-do-crashes-happen heatmap.
 *
 * 7×24 grid (day-of-week × hour-of-day), cell colour scaled to a 5-step
 * accent ramp. Hover surfaces the count + the day/hour label so users
 * can spot patterns ("most crashes Sun 14:00" / "always at 09:00").
 *
 * Takes a flat list of `{occurredAt: ISO string}` records and aggregates
 * locally so callers don't need a server endpoint. For million-event
 * scale the server should pre-aggregate; this is fine for last-N
 * windows.
 */

export function Heatmap({
  events,
  height = 200,
}: {
  events: Array<{ occurredAt: number | string }>
  height?: number
}) {
  const { grid, max } = useMemo(() => {
    const g: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0))
    let m = 0
    for (const e of events) {
      const d = new Date(e.occurredAt)
      if (Number.isNaN(d.valueOf())) continue
      const dow = d.getDay() // 0..6, Sun..Sat
      const hr = d.getHours() // 0..23
      g[dow]![hr]! += 1
      if (g[dow]![hr]! > m) m = g[dow]![hr]!
    }
    return { grid: g, max: m }
  }, [events])

  const [hover, setHover] = useState<null | { count: number; dow: number; hour: number }>(null)
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  if (events.length === 0) {
    return (
      <div
        className="text-fg-muted bg-bg-secondary border-border flex items-center justify-center rounded-md border text-[12px]"
        style={{ height }}
      >
        No events in this window.
      </div>
    )
  }

  return (
    <div className="border-border bg-bg-secondary relative rounded-md border p-3">
      <div className="grid" style={{ gridTemplateColumns: 'auto repeat(24, minmax(0, 1fr))' }}>
        {/* corner cell */}
        <div className="text-fg-muted/0 h-4 text-[9px]">·</div>
        {/* hour labels — sparse to fit */}
        {Array.from({ length: 24 }).map((_, h) => (
          <div className="text-fg-muted px-[1px] text-center font-mono text-[9px]" key={h}>
            {h % 6 === 0 ? `${String(h).padStart(2, '0')}` : ''}
          </div>
        ))}
        {grid.map((row, dow) => (
          <Row day={days[dow]!} dow={dow} key={dow} max={max} onHover={setHover} row={row} />
        ))}
      </div>
      {hover && (
        <div className="text-fg-muted absolute right-3 bottom-2 font-mono text-[10px]">
          {days[hover.dow]} {String(hover.hour).padStart(2, '0')}:00 — {hover.count} event
          {hover.count === 1 ? '' : 's'}
        </div>
      )}
    </div>
  )
}

function Row({
  day,
  dow,
  max,
  onHover,
  row,
}: {
  day: string
  dow: number
  max: number
  onHover: (s: null | { count: number; dow: number; hour: number }) => void
  row: number[]
}) {
  return (
    <>
      <div className="text-fg-muted py-[3px] pr-2 text-right font-mono text-[10px]">{day}</div>
      {row.map((count, h) => {
        const intensity = max === 0 ? 0 : Math.min(1, count / max)
        // Five-step accent ramp via opacity.
        const op = count === 0 ? 0 : 0.15 + 0.85 * Math.pow(intensity, 0.7)
        return (
          <button
            aria-label={`${day} ${h}:00 ${count} events`}
            className="h-4 cursor-default transition-opacity"
            key={h}
            onMouseEnter={() => onHover({ count, dow, hour: h })}
            onMouseLeave={() => onHover(null)}
            style={{
              background:
                count === 0
                  ? 'var(--color-bg-tertiary)'
                  : `rgb(from var(--color-accent) r g b / ${op})`,
              border: '1px solid var(--color-bg)',
            }}
            type="button"
          />
        )
      })}
    </>
  )
}

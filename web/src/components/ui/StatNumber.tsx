import { useEffect, useRef, useState } from 'react'

/**
 * Phase 50 sub-B4 — animated count-up for hero metrics.
 *
 *     <StatNumber value={data.summary.totalSessions} />
 *
 * Eases from previous value to the new value over `duration` ms
 * using rAF. When the value changes, the ease retriggers from the
 * old value (so users see a smooth transition during refetches,
 * not a snap). Stripe / Vercel dashboards both do this.
 *
 * Honours `prefers-reduced-motion`: snaps instantly to the value.
 *
 * `format` lets the caller render the eased intermediate number in
 * a custom way — default is integer with locale grouping. For rates
 * pass `(v) => formatRate(v / 100)` etc.
 */

const REDUCED_MOTION =
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export function StatNumber({
  className,
  duration = 700,
  format = (v) => Math.round(v).toLocaleString(),
  value,
}: {
  className?: string
  duration?: number
  format?: (v: number) => string
  value: number
}) {
  const [shown, setShown] = useState<number>(value)
  const fromRef = useRef<number>(value)
  const targetRef = useRef<number>(value)
  const startRef = useRef<number>(0)
  const rafRef = useRef<null | number>(null)

  useEffect(() => {
    if (REDUCED_MOTION) {
      const id = requestAnimationFrame(() => setShown(value))
      fromRef.current = value
      targetRef.current = value
      return () => cancelAnimationFrame(id)
    }
    if (value === targetRef.current) return
    // Snapshot the "from" frame off the render path so we don't
    // depend on `shown` in deps (which would create a feedback loop).
    fromRef.current = shown
    targetRef.current = value
    startRef.current = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - startRef.current) / duration)
      const e = 1 - Math.pow(1 - t, 3) // ease-out cubic
      const v = fromRef.current + (targetRef.current - fromRef.current) * e
      setShown(v)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {format(shown)}
    </span>
  )
}

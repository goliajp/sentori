import { useEffect, useMemo, useState } from 'react'

/**
 * Phase 50 sub-A1 — real-time event sparkline.
 *
 * Subscribes to `/admin/api/projects/{projectId}/events:stream` via
 * EventSource. Bins ticks into 60×1s buckets (rolling 60-second
 * window) and draws an SVG bar chart. The latest bucket pulses
 * accent so the user can feel events arriving.
 *
 *     <LiveEventSparkline projectId={projectId} />
 *
 * Designed to sit in a header strip — height defaults to 32px and
 * the chart fills container width. Cells re-key by ts so React can
 * cheaply diff the trailing additions.
 */

type Bin = { count: number; ts: number }
const WINDOW_S = 60
const TICK_MS = 1000

export function LiveEventSparkline({
  height = 32,
  projectId,
}: {
  height?: number
  projectId: string
}) {
  const [bins, setBins] = useState<Bin[]>(() => emptyBins())
  // Use state (not a ref) for the last-tick timestamp so render can
  // read it without violating react-hooks/refs purity. State updates
  // are batched with `setBins`, so we don't get extra paints.
  const [lastTickMs, setLastTickMs] = useState<number>(0)

  // 1s tick: shift the window forward + push an empty bin for the
  // new "now" slot.
  useEffect(() => {
    const id = window.setInterval(() => {
      setBins((prev) => {
        const now = Math.floor(Date.now() / TICK_MS) * TICK_MS
        const next = prev.filter((b) => b.ts > now - WINDOW_S * TICK_MS)
        if (next.length === 0 || next[next.length - 1]!.ts < now) {
          next.push({ count: 0, ts: now })
        }
        return next
      })
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  // EventSource: each incoming tick increments the current second's
  // bin. Pulse animation re-keys based on `lastTickRef`.
  useEffect(() => {
    if (!projectId) return undefined
    const es = new EventSource(
      `/admin/api/projects/${encodeURIComponent(projectId)}/events:stream`,
      { withCredentials: true }
    )
    es.onmessage = () => {
      setLastTickMs(Date.now())
      setBins((prev) => {
        const now = Math.floor(Date.now() / TICK_MS) * TICK_MS
        const next = [...prev]
        if (next.length === 0 || next[next.length - 1]!.ts < now) {
          next.push({ count: 1, ts: now })
        } else {
          next[next.length - 1] = {
            count: next[next.length - 1]!.count + 1,
            ts: next[next.length - 1]!.ts,
          }
        }
        return next.slice(-WINDOW_S)
      })
    }
    // Errors → EventSource auto-reconnects with backoff; nothing to
    // do here other than logging in dev.
    return () => es.close()
  }, [projectId])

  const max = useMemo(() => Math.max(1, ...bins.map((b) => b.count)), [bins])
  const total = useMemo(() => bins.reduce((a, b) => a + b.count, 0), [bins])
  // `isAlive` is a pure derivation of state — no Date.now() needed
  // because the 1s tick effect refreshes `bins`, and a recent tick
  // also updates `lastTickMs`. We treat any nonzero `lastTickMs` as
  // alive — false on first render only.
  const isAlive = bins.some((b) => b.count > 0) || lastTickMs !== 0

  return (
    <div
      className="border-border bg-bg-secondary flex items-center gap-2 rounded-md border px-2 py-1"
      style={{ height: height + 8 }}
      title={`Last 60s · ${total} events · live`}
    >
      <span className="text-fg-muted text-[10px] tracking-wider uppercase">Live</span>
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${
          isAlive ? 'bg-[color:var(--color-success)]' : 'bg-fg-muted/40'
        } ${isAlive ? 'sentori-live-pulse' : ''}`}
      />
      <svg
        aria-label={`Last 60 seconds of events: ${total} total`}
        height={height}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 ${WINDOW_S} ${height}`}
        width="100%"
      >
        {bins.map((b, i) => {
          const x = i
          const h = (b.count / max) * height
          return (
            <rect
              fill="var(--color-accent)"
              height={Math.max(b.count > 0 ? 1.5 : 0, h)}
              key={b.ts}
              opacity={b.count > 0 ? 0.85 : 0}
              width={0.8}
              x={x + 0.1}
              y={height - h}
            />
          )
        })}
      </svg>
      <span className="text-fg-muted ml-auto font-mono text-[10px] tabular-nums">{total}/60s</span>
    </div>
  )
}

function emptyBins(): Bin[] {
  const now = Math.floor(Date.now() / TICK_MS) * TICK_MS
  return Array.from({ length: WINDOW_S }, (_, i) => ({
    count: 0,
    ts: now - (WINDOW_S - 1 - i) * TICK_MS,
  }))
}

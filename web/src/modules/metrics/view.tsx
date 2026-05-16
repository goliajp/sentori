// v0.8.3 — custom metrics surface.
//
// MVP shape: left rail lists every metric name seen in the last 24 h
// (with the most-recent timestamp + 24 h count). Click one → right
// pane shows the last N points as a table + a minimal SVG sparkline.
// Time-series chart with axes / aggregation is intentionally deferred
// until customers tell us which projections they want (sum vs avg vs
// p99 — depends on whether the metric is a counter or a gauge).

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

export function MetricsView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [selected, setSelected] = useState<null | string>(null)

  const namesQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listMetricNames(projectId!),
    queryKey: ['metric-names', projectId],
  })

  const pointsQ = useQuery({
    enabled: !!projectId && !!selected,
    queryFn: () => adminApi.listMetrics(projectId!, { name: selected! }),
    queryKey: ['metric-points', projectId, selected],
  })

  const names = namesQ.data ?? []
  const points = pointsQ.data ?? []

  return (
    <div className="flex h-full min-h-0 gap-3">
      <aside className="border-border h-full w-80 shrink-0 overflow-y-auto rounded-md border">
        <header className="border-border bg-bg-tertiary/60 sticky top-0 border-b px-3 py-2">
          <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">
            Metrics (last 24 h)
          </span>
        </header>
        {namesQ.isLoading && <div className="text-fg-muted t-md px-3 py-3">Loading…</div>}
        {!namesQ.isLoading && names.length === 0 && (
          <div className="text-fg-muted t-md px-3 py-3">
            No metrics yet. Call <code>sentori.recordMetric('name', value)</code> from the host app.
          </div>
        )}
        <ul className="divide-border divide-y">
          {names.map((n) => (
            <li key={n.name}>
              <button
                className={`hover:bg-bg-tertiary/40 w-full px-3 py-2 text-left ${
                  selected === n.name ? 'bg-bg-tertiary/60' : ''
                }`}
                onClick={() => setSelected(n.name)}
                type="button"
              >
                <div className="t-md text-fg font-medium">{n.name}</div>
                <div className="text-fg-muted t-sm flex items-center gap-2">
                  <span className="tabular-nums">{n.count} points</span>
                  <span className="font-mono">{formatRelative(n.lastSeen)}</span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <main className="flex-1 overflow-auto">
        {!selected && <div className="text-fg-muted t-md p-3">Pick a metric on the left.</div>}
        {selected && pointsQ.isLoading && (
          <div className="text-fg-muted t-md p-3">Loading points…</div>
        )}
        {selected && !pointsQ.isLoading && points.length > 0 && (
          <div className="space-y-3">
            <Sparkline values={points.map((p) => p.value).reverse()} />
            <table className="std-table w-full">
              <thead>
                <tr>
                  <th>ts</th>
                  <th>value</th>
                  <th>tags</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.id}>
                    <td className="font-mono tabular-nums">{p.ts}</td>
                    <td className="tabular-nums">{p.value}</td>
                    <td className="font-mono">{stringifyTags(p.tags)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

/** Minimal inline SVG sparkline. No axes, no labels, no library — just
 *  a quick visual cue for "is this number going up or down". */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <div className="border-border text-fg-muted t-sm rounded border p-3">
        Not enough points for a trend yet.
      </div>
    )
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const W = 600
  const H = 80
  const dx = W / (values.length - 1)
  const points = values
    .map((v, i) => `${(i * dx).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`)
    .join(' ')
  return (
    <div className="border-border rounded-md border p-3">
      <svg className="w-full" height={H} preserveAspectRatio="none" viewBox={`0 0 ${W} ${H}`}>
        <polyline
          fill="none"
          points={points}
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="text-fg-muted t-sm mt-1 flex justify-between font-mono tabular-nums">
        <span>min {min}</span>
        <span>max {max}</span>
      </div>
    </div>
  )
}

function stringifyTags(t: unknown): string {
  if (!t || typeof t !== 'object') return ''
  const entries = Object.entries(t as Record<string, unknown>)
  if (entries.length === 0) return ''
  return entries.map(([k, v]) => `${k}=${String(v)}`).join(' ')
}

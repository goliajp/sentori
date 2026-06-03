// v0.8.3 — custom metrics surface.
//
// Master/detail: left rail = metric names (counts + last-seen), right
// pane = points table + minimal sparkline for the selected metric.
// Aggregations (sum / avg / p99) deferred until customer signal.

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi } from '@/api/client'
import { RailEmpty, CenteredEmpty } from '@/components/Hint'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'
import { qk } from '@/api/query-keys'

export function MetricsView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [selected, setSelected] = useState<null | string>(null)

  const namesQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listMetricNames(projectId!),
    queryKey: qk.metrics.names(projectId),
  })

  const pointsQ = useQuery({
    enabled: !!projectId && !!selected,
    queryFn: () => adminApi.listMetrics(projectId!, { name: selected! }),
    queryKey: qk.metrics.points(projectId, selected),
  })

  const names = namesQ.data ?? []
  const points = pointsQ.data ?? []

  return (
    <div className="bg-bg -mx-4 -my-3 flex h-[calc(100%+1.5rem)] min-h-0 overflow-hidden">
      <aside className="border-border bg-bg-secondary flex w-[20rem] shrink-0 flex-col overflow-hidden border-r">
        <header className="border-border shrink-0 border-b px-4 py-3">
          <h1
            className="text-fg"
            style={{
              fontVariationSettings: "'wdth' 95, 'opsz' 24, 'wght' 550",
              fontSize: '17px',
              letterSpacing: '-0.01em',
            }}
          >
            Metrics
          </h1>
          <div className="text-fg-muted mt-1 font-mono text-[11px] tracking-[0.08em] uppercase">
            last 24 hours
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {namesQ.isLoading && <RailEmpty>Loading…</RailEmpty>}
          {namesQ.isError && <RailEmpty>Failed to load metric names. Refresh to retry.</RailEmpty>}
          {!namesQ.isLoading && !namesQ.isError && names.length === 0 && (
            <RailEmpty>Call sentori.recordMetric('name', value) to populate this list.</RailEmpty>
          )}
          {names.map((n) => {
            const active = selected === n.name
            return (
              <button
                className={`border-border-muted relative block w-full border-b px-4 py-2.5 text-left transition-colors ${
                  active ? 'bg-accent/10' : 'hover:bg-bg'
                }`}
                key={n.name}
                onClick={() => setSelected(n.name)}
                type="button"
              >
                <span
                  aria-hidden
                  className={`absolute top-0 bottom-0 left-0 w-[2px] ${active ? 'bg-accent' : 'bg-transparent'}`}
                />
                <div className="text-fg font-mono text-[13px]">{n.name}</div>
                <div className="text-fg-muted mt-1 flex items-center gap-2 font-mono text-[10px] tracking-[0.05em]">
                  <span className="tabular-nums">{n.count.toLocaleString()} points</span>
                  <span aria-hidden className="opacity-40">
                    /
                  </span>
                  <span>{formatRelative(n.lastSeen)}</span>
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="bg-bg min-w-0 flex-1 overflow-y-auto">
        {!selected && (
          <CenteredEmpty eyebrow="Pick a metric">
            The left rail lists every metric name seen in the last 24 h.
          </CenteredEmpty>
        )}
        {selected && pointsQ.isLoading && <CenteredEmpty>Loading points…</CenteredEmpty>}
        {selected && pointsQ.isError && (
          <CenteredEmpty eyebrow="error">Failed to load points. Refresh to retry.</CenteredEmpty>
        )}
        {selected && !pointsQ.isLoading && !pointsQ.isError && points.length > 0 && (
          <div className="space-y-4 p-6">
            <header className="pb-2">
              <div className="text-accent font-mono text-[11px] tracking-[0.18em] uppercase">
                metric
              </div>
              <h2 className="text-fg mt-1 font-mono text-[20px]">{selected}</h2>
            </header>
            <Sparkline values={points.map((p) => p.value).reverse()} />
            <table className="bench">
              <thead>
                <tr>
                  <th>timestamp</th>
                  <th className="num">value</th>
                  <th>tags</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.id}>
                    <td>{p.ts}</td>
                    <td className="num">{p.value.toLocaleString()}</td>
                    <td>{stringifyTags(p.tags)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

/** Minimal inline SVG sparkline — `accent` stroke, no axes / labels. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <div className="border-border text-fg-muted border-y py-3 text-center font-mono text-[11px] tracking-[0.08em] uppercase">
        not enough points for a trend yet
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
    <div className="border-border border-y py-3">
      <svg className="w-full" height={H} preserveAspectRatio="none" viewBox={`0 0 ${W} ${H}`}>
        <polyline
          fill="var(--color-accent)"
          fillOpacity="0.08"
          points={`0,${H} ${points} ${W},${H}`}
          stroke="none"
        />
        <polyline
          fill="none"
          points={points}
          stroke="var(--color-accent)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="text-fg-muted mt-2 flex justify-between font-mono text-[10px] tracking-[0.05em] uppercase tabular-nums">
        <span>min {min.toLocaleString()}</span>
        <span>max {max.toLocaleString()}</span>
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

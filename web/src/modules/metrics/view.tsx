// v0.8.3 — custom metrics surface.
//
// Master/detail: left rail = metric names (counts + last-seen), right
// pane = points table + minimal sparkline for the selected metric.
// Aggregations (sum / avg / p99) deferred until customer signal.

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
    <div className="-mx-4 -my-3 flex h-[calc(100%+1.5rem)] min-h-0 overflow-hidden bg-[color:var(--paper)]">
      <aside className="flex w-[20rem] shrink-0 flex-col overflow-hidden border-r border-[color:var(--rule)] bg-[color:var(--paper-2)]">
        <header className="shrink-0 border-b border-[color:var(--rule)] px-4 py-3">
          <h1
            className="text-[color:var(--ink)]"
            style={{
              fontFamily: 'var(--font-sans)',
              fontVariationSettings: "'wdth' 95, 'opsz' 24, 'wght' 550",
              fontSize: '17px',
              letterSpacing: '-0.01em',
            }}
          >
            Metrics
          </h1>
          <div className="mt-1 font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink-muted)] uppercase">
            last 24 hours
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {namesQ.isLoading && <EmptyRail hint="Loading…" />}
          {!namesQ.isLoading && names.length === 0 && (
            <EmptyRail hint="Call sentori.recordMetric('name', value) to populate this list." />
          )}
          {names.map((n) => {
            const active = selected === n.name
            return (
              <button
                className={`relative block w-full border-b border-[color:var(--rule-soft)] px-4 py-2.5 text-left transition-colors ${
                  active ? 'bg-[color:var(--accent-soft)]' : 'hover:bg-[color:var(--paper)]'
                }`}
                key={n.name}
                onClick={() => setSelected(n.name)}
                type="button"
              >
                <span
                  aria-hidden
                  className={`absolute top-0 bottom-0 left-0 w-[2px] ${active ? 'bg-[color:var(--accent)]' : 'bg-transparent'}`}
                />
                <div className="font-mono text-[13px] text-[color:var(--ink)]">{n.name}</div>
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] tracking-[0.05em] text-[color:var(--ink-muted)]">
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

      <section className="min-w-0 flex-1 overflow-y-auto bg-[color:var(--paper)]">
        {!selected && (
          <Placeholder
            hint="The left rail lists every metric name seen in the last 24 h."
            title="Pick a metric"
          />
        )}
        {selected && pointsQ.isLoading && <Placeholder hint="Loading points…" title="" />}
        {selected && !pointsQ.isLoading && points.length > 0 && (
          <div className="space-y-4 p-6">
            <header className="pb-2">
              <div className="font-mono text-[11px] tracking-[0.18em] text-[color:var(--accent)] uppercase">
                metric
              </div>
              <h2 className="mt-1 font-mono text-[20px] text-[color:var(--ink)]">{selected}</h2>
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

function EmptyRail({ hint }: { hint: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="mb-2 font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
        empty
      </div>
      <div className="mx-auto max-w-[24ch] text-[13px] leading-relaxed text-[color:var(--ink-soft)]">
        {hint}
      </div>
    </div>
  )
}

function Placeholder({ hint, title }: { hint: string; title: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="text-center">
        {title && (
          <div className="mb-2 font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
            {title}
          </div>
        )}
        <div className="text-[13px] text-[color:var(--ink-soft)]">{hint}</div>
      </div>
    </div>
  )
}

/** Minimal inline SVG sparkline — `accent` stroke, no axes / labels. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) {
    return (
      <div className="border-y border-[color:var(--rule)] py-3 text-center font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink-muted)] uppercase">
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
    <div className="border-y border-[color:var(--rule)] py-3">
      <svg className="w-full" height={H} preserveAspectRatio="none" viewBox={`0 0 ${W} ${H}`}>
        <polyline
          fill="var(--accent)"
          fillOpacity="0.08"
          points={`0,${H} ${points} ${W},${H}`}
          stroke="none"
        />
        <polyline
          fill="none"
          points={points}
          stroke="var(--accent)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="mt-2 flex justify-between font-mono text-[10px] tracking-[0.05em] text-[color:var(--ink-muted)] uppercase tabular-nums">
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

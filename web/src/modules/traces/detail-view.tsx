import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { adminApi, type MetricPoint } from '@/api/client'
import { Stat } from '@/components/Stat'
import { useOrg } from '@/auth/orgContext'
import { EmptyState } from '@/components/Hint'
import { qk } from '@/api/query-keys'

export function TraceDetailView() {
  const { traceId } = useParams<{ traceId: string }>()
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId && !!traceId,
    queryFn: () => adminApi.getTraceDetail(projectId!, traceId!),
    queryKey: qk.traces.detail(projectId, traceId),
  })

  // v2.0 W3 — pull every metric point in the last 24h that carries
  // `tags.span_id` matching one of this trace's spans. Client-side
  // group keeps the server query simple (one fetch per trace, not
  // one per span) and surfaces metrics emitted via
  // `recordMetric(name, value, tags, { parent: span })` next to the
  // span that produced them. Trace-level metrics (no span_id tag)
  // and metrics tied to other traces are filtered out here.
  const spanIdSet = new Set((data?.spans ?? []).map((s) => s.id))
  const traceStart = data?.trace.firstSeen
  const metricsQuery = useQuery({
    enabled: !!projectId && spanIdSet.size > 0 && !!traceStart,
    queryFn: () =>
      adminApi.listMetrics(projectId!, {
        limit: 1000,
        since: traceStart,
      }),
    queryKey: ['trace-related-metrics', projectId, traceId],
  })
  const relatedBySpan: Map<string, MetricPoint[]> = new Map()
  for (const m of metricsQuery.data ?? []) {
    const spanId = typeof m.tags?.span_id === 'string' ? m.tags.span_id : null
    if (!spanId || !spanIdSet.has(spanId)) continue
    const bucket = relatedBySpan.get(spanId) ?? []
    bucket.push(m)
    relatedBySpan.set(spanId, bucket)
  }

  if (!projectId || !traceId) return null

  const trace = data?.trace

  return (
    <div className="sentori-page-in space-y-4">
      <Link
        className="text-fg-muted hover:text-accent inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.08em] uppercase transition-colors"
        to={`/main/org/${currentOrg.slug}/traces`}
      >
        ← back to traces
      </Link>

      <header>
        <div className="text-fg-muted font-mono text-[11px] tracking-[0.18em] uppercase">trace</div>
        <h1
          className="text-fg mt-1"
          style={{
            fontVariationSettings: "'wdth' 95, 'opsz' 48, 'wght' 600",
            fontSize: '26px',
            letterSpacing: '-0.018em',
            lineHeight: 1.05,
          }}
        >
          {trace?.rootOp ?? trace?.rootName ?? `trace ${traceId.slice(0, 8)}`}
        </h1>
        <div className="text-fg-muted mt-2 font-mono text-[11px] tracking-[0.05em]">{traceId}</div>
      </header>

      {isLoading && <EmptyState>Loading trace…</EmptyState>}
      {error && <EmptyState>Failed to load this trace.</EmptyState>}
      {data && (
        <>
          <div className="rule-grid grid-cols-3">
            <Stat label="spans" value={<span className="tabular-nums">{data.spans.length}</span>} />
            <Stat
              label="duration"
              value={
                <span className="tabular-nums">
                  {data.trace.durationMs >= 1000
                    ? `${(data.trace.durationMs / 1000).toFixed(2)}s`
                    : `${Math.round(data.trace.durationMs)}ms`}
                </span>
              }
            />
            <Stat highlight={data.trace.status !== 'ok'} label="status" value={data.trace.status} />
          </div>

          <table className="bench mt-2">
            <thead>
              <tr>
                <th>op</th>
                <th>name</th>
                <th className="num">duration</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {data.spans.flatMap((s) => {
                const related = relatedBySpan.get(s.id) ?? []
                const rows = [
                  <tr key={s.id}>
                    <td className="text-fg-secondary">{s.op}</td>
                    <td className="lead">{s.name}</td>
                    <td className="num">{s.durationMs.toLocaleString()}ms</td>
                    <td
                      className={
                        s.status === 'ok'
                          ? undefined
                          : s.status === 'error'
                            ? 'text-danger'
                            : 'text-fg-muted'
                      }
                    >
                      {s.status}
                    </td>
                  </tr>,
                ]
                // v2.0 W3 — sibling row listing every metric point whose
                // `tags.span_id` equals this span's id. Rendered as a
                // dense, single-line summary so a span with no related
                // metrics costs zero extra height — only spans that
                // emitted via `recordMetric(..., { parent: span })` get
                // a second row.
                if (related.length > 0) {
                  rows.push(
                    <tr key={`${s.id}-metrics`}>
                      <td className="text-fg-muted text-[10px] tracking-[0.12em] uppercase">
                        metrics
                      </td>
                      <td className="text-[11px]" colSpan={3}>
                        <div className="text-fg-secondary flex flex-wrap items-center gap-x-3 gap-y-1">
                          {related.map((m) => (
                            <span
                              className="inline-flex items-center gap-1 font-mono"
                              key={m.id}
                              title={`${m.ts} • ${JSON.stringify(m.tags)}`}
                            >
                              <span className="text-fg">{m.name}</span>
                              <span className="text-accent tabular-nums">
                                {Number.isInteger(m.value) ? m.value : m.value.toFixed(2)}
                              </span>
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                }
                return rows
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

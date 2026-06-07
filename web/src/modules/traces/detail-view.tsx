// v2.14 — Trace detail (v3 GDS migration).
//
// Three-section page: header card (op + traceId + back link), KPI
// strip (spans / duration / status), spans timeline DataTable. When
// a span emitted metrics via `recordMetric(..., { parent: span })`,
// a sibling row beneath that span lists each metric inline.

import { Alert, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { adminApi, type MetricPoint } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'

type SpanRow = {
  durationMs: number
  id: string
  name: string
  op: string
  related: MetricPoint[]
  status: string
}

export function TraceDetailView() {
  const { traceId } = useParams<{ traceId: string }>()
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const traceQ = useQuery({
    enabled: !!projectId && !!traceId,
    queryFn: () => adminApi.getTraceDetail(projectId!, traceId!),
    queryKey: qk.traces.detail(projectId, traceId),
  })

  // v2.0 W3 — pull every metric point in the last 24 h that carries
  // `tags.span_id` matching one of this trace's spans, then group
  // client-side. Keeps the server query one-fetch-per-trace.
  const spanIdSet = new Set((traceQ.data?.spans ?? []).map((s) => s.id))
  const traceStart = traceQ.data?.trace.firstSeen
  const metricsQ = useQuery({
    enabled: !!projectId && spanIdSet.size > 0 && !!traceStart,
    queryFn: () => adminApi.listMetrics(projectId!, { limit: 1000, since: traceStart }),
    queryKey: ['trace-related-metrics', projectId, traceId],
  })
  const relatedBySpan = new Map<string, MetricPoint[]>()
  for (const m of metricsQ.data ?? []) {
    const spanId = typeof m.tags?.span_id === 'string' ? m.tags.span_id : null
    if (!spanId || !spanIdSet.has(spanId)) continue
    const bucket = relatedBySpan.get(spanId) ?? []
    bucket.push(m)
    relatedBySpan.set(spanId, bucket)
  }

  if (!projectId || !traceId) return null

  const trace = traceQ.data?.trace
  const titleText = trace?.rootOp ?? trace?.rootName ?? `trace ${traceId.slice(0, 8)}`

  const spans: SpanRow[] = (traceQ.data?.spans ?? []).map((s) => ({
    durationMs: s.durationMs,
    id: s.id,
    name: s.name,
    op: s.op,
    related: relatedBySpan.get(s.id) ?? [],
    status: s.status,
  }))

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          {
            label: 'traces',
            href: `/main/org/${currentOrg.slug}/traces`,
          },
          { label: titleText },
        ]}
        subtitle={traceId}
        title={titleText}
      />

      <div className="flex">
        <Link
          className="text-fg-muted hover:text-accent inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.08em] uppercase transition-colors"
          to={`/main/org/${currentOrg.slug}/traces`}
        >
          ← back to traces
        </Link>
      </div>

      {traceQ.isLoading && (
        <Card>
          <EmptyState description="Fetching the spans…" title="Loading trace" />
        </Card>
      )}

      {traceQ.error && (
        <Alert title="Failed to load this trace" variant="danger">
          Refresh to retry.
        </Alert>
      )}

      {traceQ.data && trace && (
        <>
          <Card>
            <div className="grid grid-cols-3 gap-4">
              <KpiCell label="spans" value={trace ? spans.length.toLocaleString() : '—'} />
              <KpiCell
                label="duration"
                value={
                  trace
                    ? trace.durationMs >= 1000
                      ? `${(trace.durationMs / 1000).toFixed(2)}s`
                      : `${Math.round(trace.durationMs)}ms`
                    : '—'
                }
              />
              <KpiCell
                label="status"
                tone={trace.status !== 'ok' ? 'danger' : undefined}
                value={trace.status}
              />
            </div>
          </Card>

          <Card>
            <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
              <h2 className="text-fg text-[14px] font-semibold">Spans</h2>
              <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                {spans.length} span{spans.length === 1 ? '' : 's'}
              </span>
            </header>

            {spans.length === 0 ? (
              <EmptyState
                description="The root span exists but no children landed under this trace id."
                title="No child spans"
              />
            ) : (
              <DataTable<SpanRow>
                columns={[
                  {
                    key: 'op',
                    label: 'Op',
                    width: '120px',
                    render: (_v, s) => (
                      <span className="text-fg-secondary font-mono text-[12px]">{s.op}</span>
                    ),
                  },
                  {
                    key: 'name',
                    label: 'Name',
                    render: (_v, s) => (
                      <div className="flex flex-col gap-1">
                        <span className="text-fg font-mono text-[12px]">{s.name}</span>
                        {s.related.length > 0 && (
                          <span className="text-fg-muted flex flex-wrap items-center gap-x-3 font-mono text-[11px]">
                            <span className="text-fg-muted tracking-[0.12em] uppercase">
                              metrics
                            </span>
                            {s.related.map((m) => (
                              <span
                                className="inline-flex items-center gap-1"
                                key={m.id}
                                title={`${m.ts} • ${JSON.stringify(m.tags)}`}
                              >
                                <span className="text-fg-secondary">{m.name}</span>
                                <span className="text-accent tabular-nums">
                                  {Number.isInteger(m.value) ? m.value : m.value.toFixed(2)}
                                </span>
                              </span>
                            ))}
                          </span>
                        )}
                      </div>
                    ),
                  },
                  {
                    align: 'right',
                    key: 'durationMs',
                    label: 'Duration',
                    width: '110px',
                    render: (_v, s) => (
                      <span className="text-fg font-mono text-[12px] tabular-nums">
                        {s.durationMs.toLocaleString()}ms
                      </span>
                    ),
                  },
                  {
                    key: 'status',
                    label: 'Status',
                    width: '90px',
                    render: (_v, s) => (
                      <span
                        className={
                          s.status === 'ok'
                            ? 'text-fg-secondary'
                            : s.status === 'error'
                              ? 'text-danger'
                              : 'text-fg-muted'
                        }
                      >
                        {s.status}
                      </span>
                    ),
                  },
                ]}
                density="compact"
                rowKey={(s) => s.id}
                rows={spans}
                striped
              />
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function KpiCell({
  label,
  tone,
  value,
}: {
  label: string
  tone?: 'danger'
  value: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg-muted font-mono text-[10px] tracking-[0.22em] uppercase">
        {label}
      </span>
      <span
        className={
          tone === 'danger'
            ? 'text-danger font-mono text-[22px] tabular-nums'
            : 'text-fg font-mono text-[22px] tabular-nums'
        }
      >
        {value}
      </span>
    </div>
  )
}

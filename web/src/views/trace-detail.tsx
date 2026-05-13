// Phase 36 sub-B: trace detail (waterfall).
//
// Renders the span tree as a flat table with indent depth per row,
// no SVG bars. The duration column carries the timing signal; the
// "Op / Name" tree-shape carries the structural signal. Hover a row
// to highlight the root → leaf chain it belongs to. Click to open a
// drawer with tags + data.

import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { adminApi, type SpanRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { ErrorState, LoadingState } from '@/components/states'

type TreeNode = {
  children: TreeNode[]
  depth: number
  span: SpanRow
}

function buildTree(spans: SpanRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  for (const s of spans) {
    byId.set(s.id, { children: [], depth: 0, span: s })
  }
  const roots: TreeNode[] = []
  for (const node of byId.values()) {
    const parentId = node.span.parentSpanId
    if (parentId && byId.has(parentId)) {
      const parent = byId.get(parentId)!
      parent.children.push(node)
      node.depth = parent.depth + 1
    } else {
      // Orphan (parent missing) → treat as root so it still shows.
      roots.push(node)
    }
  }
  return roots
}

function flatten(roots: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (n: TreeNode) => {
    out.push(n)
    for (const c of n.children) walk(c)
  }
  for (const r of roots) walk(r)
  return out
}

function ancestorIds(byId: Map<string, SpanRow>, spanId: string): Set<string> {
  const out = new Set<string>()
  let cur: string | undefined = spanId
  while (cur && byId.has(cur)) {
    out.add(cur)
    const next: null | string | undefined = byId.get(cur)?.parentSpanId
    cur = next ?? undefined
  }
  return out
}

export function TraceDetailView() {
  const { traceId } = useParams<{ traceId: string }>()
  const navigate = useNavigate()
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [hoveredId, setHoveredId] = useState<null | string>(null)
  const [openSpanId, setOpenSpanId] = useState<null | string>(null)

  const detail = useQuery({
    enabled: !!projectId && !!traceId,
    queryFn: () => adminApi.getTraceDetail(projectId!, traceId!),
    queryKey: ['trace-detail', projectId, traceId],
  })

  const rows = useMemo(() => {
    if (!detail.data) return [] as TreeNode[]
    return flatten(buildTree(detail.data.spans))
  }, [detail.data])

  const byId = useMemo(() => {
    const m = new Map<string, SpanRow>()
    for (const s of detail.data?.spans ?? []) m.set(s.id, s)
    return m
  }, [detail.data])

  const eventsBySpan = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of detail.data?.events ?? []) {
      if (!e.spanId) continue
      m.set(e.spanId, (m.get(e.spanId) ?? 0) + 1)
    }
    return m
  }, [detail.data])

  const highlightChain = useMemo(
    () => (hoveredId ? ancestorIds(byId, hoveredId) : new Set<string>()),
    [byId, hoveredId]
  )

  if (!traceId) return null
  if (detail.isLoading) return <LoadingState />
  if (detail.error || !detail.data) return <ErrorState label="Failed to load trace." />

  const trace = detail.data.trace
  const openSpan = openSpanId ? byId.get(openSpanId) : null

  return (
    <div className="flex h-full flex-col">
      <header className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-6">
        <button
          className="text-fg-muted hover:text-fg text-sm"
          onClick={() => navigate(`/org/${currentOrg.slug}/traces`)}
          type="button"
        >
          ← Back
        </button>
        <h2 className="text-fg truncate text-base font-semibold">{trace.rootOp ?? '—'}</h2>
        <span className="text-fg-muted ml-1 truncate text-sm">{trace.rootName ?? '—'}</span>
        <span className="text-fg-muted ml-auto text-[12px]">
          {detail.data.spans.length} spans · {formatDuration(trace.durationMs)} · {trace.status}
        </span>
      </header>

      <section className="flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-[12px]">
          <thead className="bg-bg sticky top-0 z-10">
            <tr className="border-border text-fg-muted border-b text-[11px] tracking-wider uppercase">
              <th className="px-4 py-2 text-left">Op / Name</th>
              <th className="px-4 py-2 text-right">Duration</th>
              <th className="px-4 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => {
              const inChain = highlightChain.has(n.span.id)
              return (
                <tr
                  className={`border-border/40 cursor-pointer border-b ${
                    n.span.id === openSpanId
                      ? 'bg-bg-tertiary'
                      : inChain
                        ? 'bg-bg-tertiary/40'
                        : 'hover:bg-bg-tertiary/60'
                  }`}
                  key={n.span.id}
                  onClick={() => setOpenSpanId(n.span.id)}
                  onMouseEnter={() => setHoveredId(n.span.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <td className="px-4 py-1">
                    <span
                      className="text-fg-muted inline-block"
                      style={{ width: `${n.depth * 16}px` }}
                    />
                    <span className="text-fg-muted font-mono">{n.span.op}</span>
                    <span className="text-fg ml-3 truncate">{n.span.name}</span>
                  </td>
                  <td className="text-fg-muted px-4 py-1 text-right tabular-nums">
                    {formatDuration(n.span.durationMs)}
                  </td>
                  <td className="px-4 py-1">
                    <StatusPill status={n.span.status} />
                    {(eventsBySpan.get(n.span.id) ?? 0) > 0 && (
                      <span
                        className="ml-2 inline-block rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400 tabular-nums"
                        title="Events captured on this span"
                      >
                        {eventsBySpan.get(n.span.id)} event
                        {eventsBySpan.get(n.span.id) === 1 ? '' : 's'}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      {openSpan && (
        <aside className="border-border bg-bg-secondary fixed top-0 right-0 z-20 h-full w-96 overflow-y-auto border-l p-6 shadow-lg">
          <div className="flex items-baseline justify-between">
            <h3 className="text-fg font-semibold">{openSpan.op}</h3>
            <button
              className="text-fg-muted hover:text-fg text-sm"
              onClick={() => setOpenSpanId(null)}
              type="button"
            >
              ✕
            </button>
          </div>
          <p className="text-fg-muted mt-1 truncate text-[12px]">{openSpan.name}</p>

          <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-fg-muted">id</dt>
            <dd className="font-mono break-all">{openSpan.id}</dd>
            <dt className="text-fg-muted">parent</dt>
            <dd className="font-mono break-all">{openSpan.parentSpanId ?? '— (root)'}</dd>
            <dt className="text-fg-muted">duration</dt>
            <dd className="tabular-nums">{formatDuration(openSpan.durationMs)}</dd>
            <dt className="text-fg-muted">status</dt>
            <dd>{openSpan.status}</dd>
            <dt className="text-fg-muted">started</dt>
            <dd className="font-mono">{new Date(openSpan.startedAt).toISOString()}</dd>
          </dl>

          {Object.keys(openSpan.tags).length > 0 && (
            <section className="mt-5">
              <h4 className="text-fg-muted text-[11px] tracking-wider uppercase">Tags</h4>
              <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
                {Object.entries(openSpan.tags).map(([k, v]) => (
                  <Fragment key={k}>
                    <dt className="text-fg-muted font-mono">{k}</dt>
                    <dd className="font-mono break-all">{v}</dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          )}

          {openSpan.data && (
            <section className="mt-5">
              <h4 className="text-fg-muted text-[11px] tracking-wider uppercase">Data</h4>
              <pre className="bg-bg-tertiary mt-2 overflow-x-auto rounded p-3 text-[11px]">
                {JSON.stringify(openSpan.data, null, 2)}
              </pre>
            </section>
          )}

          {/* Phase 42 sub-H.05: trace → issue back-link. Surfaces every
              event captured on this span with a direct link into the
              issue-detail page — closes the loop on "I see an error
              pill on a span, I want to land on the issue in one click". */}
          {(() => {
            const events = (detail.data?.events ?? []).filter((e) => e.spanId === openSpan.id)
            if (events.length === 0) return null
            return (
              <section className="mt-5">
                <h4 className="text-fg-muted text-[11px] tracking-wider uppercase">
                  Events on this span
                </h4>
                <ul className="mt-2 space-y-1">
                  {events.map((e) => (
                    <li className="flex items-baseline gap-2 text-[12px]" key={e.id}>
                      <span className="font-mono text-red-400">{e.errorType}</span>
                      {e.issueId ? (
                        <Link
                          className="text-accent hover:text-accent/80"
                          to={`/org/${currentOrg.slug}/issues/${e.issueId}`}
                        >
                          → issue
                        </Link>
                      ) : (
                        <span className="text-fg-muted">no issue</span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })()}
        </aside>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: SpanRow['status'] }) {
  const cls =
    status === 'error'
      ? 'bg-red-500/10 text-red-400'
      : status === 'cancelled'
        ? 'bg-amber-500/10 text-amber-400'
        : 'bg-green-500/10 text-green-400'
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[11px] tracking-wider uppercase ${cls}`}
    >
      {status}
    </span>
  )
}

function formatDuration(ms: number): string {
  if (ms < 1) return '<1 ms'
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(2)} s`
}

import { Fragment } from 'react'

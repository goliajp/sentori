// Phase 36 sub-A: trace list view.
//
// Mirrors IssuesView in structure: 32 px rows + keyboard nav + keyset
// pagination via useInfiniteQuery + IntersectionObserver bottom
// sentinel. Trace detail (waterfall) lands in sub-B.

import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHotkeys } from 'react-hotkeys-hook'
import { useNavigate } from 'react-router'

import { adminApi, type TraceRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { densityClasses, useDensity } from '@/lib/density'

const PAGE_SIZE = 100

const STATUS_OPTIONS = ['ok', 'error', 'cancelled'] as const
type StatusFilter = 'all' | (typeof STATUS_OPTIONS)[number]

const OP_OPTIONS = [
  'http.client',
  'http.server',
  'db.query',
  'db.transaction',
  'cache.get',
  'react.render',
  'react.navigation',
] as const

export function TracesView() {
  const navigate = useNavigate()
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [opFilter, setOpFilter] = useState<string>('')
  const [minDurationMs, setMinDurationMs] = useState<number | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const { density } = useDensity()
  const dCls = densityClasses(density)

  type TracesPage = Awaited<ReturnType<typeof adminApi.listTracesPage>>
  const tracesInfinite = useInfiniteQuery({
    enabled: !!projectId,
    getNextPageParam: (last: TracesPage) => last.nextCursor ?? undefined,
    initialPageParam: null as null | string,
    queryFn: ({ pageParam }: { pageParam: null | string }) =>
      adminApi.listTracesPage(projectId!, {
        cursor: pageParam,
        durationMs: minDurationMs ?? undefined,
        limit: PAGE_SIZE,
        op: opFilter || undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
      }),
    queryKey: ['traces', projectId, statusFilter, opFilter, minDurationMs],
  })

  const traces = useMemo(
    () => tracesInfinite.data?.pages.flatMap((p: TracesPage) => p.traces) ?? [],
    [tracesInfinite.data]
  )

  // Reset row cursor when filters change — keyboard nav indices
  // wouldn't map sensibly across a different result set. The
  // set-state-in-effect rule is paranoid about cascading renders; this
  // is a deliberate one-shot reset, not a derive.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedIdx(0)
  }, [statusFilter, opFilter, minDurationMs, projectId])

  const open = (row: TraceRow) => {
    navigate(`/org/${currentOrg.slug}/traces/${row.traceId}`)
  }

  useHotkeys('j', () => setSelectedIdx((i) => Math.min(traces.length - 1, i + 1)), {
    enabled: traces.length > 0,
  })
  useHotkeys('k', () => setSelectedIdx((i) => Math.max(0, i - 1)), {
    enabled: traces.length > 0,
  })
  useHotkeys(
    'enter',
    () => {
      const r = traces[selectedIdx]
      if (r) open(r)
    },
    { enabled: traces.length > 0 }
  )

  if (!projectId) return null
  if (tracesInfinite.isLoading) return <LoadingState />
  if (tracesInfinite.error) return <ErrorState label="Failed to load traces." />

  return (
    <div className="flex h-full flex-col">
      <header className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-6">
        <h1 className="text-fg text-base font-semibold">Traces</h1>
        <span className="text-fg-muted text-[12px]">{traces.length} loaded</span>

        <div className="ml-auto flex items-center gap-2">
          <select
            className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1 text-[12px]"
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            value={statusFilter}
          >
            <option value="all">all status</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1 text-[12px]"
            onChange={(e) => setOpFilter(e.target.value)}
            value={opFilter}
          >
            <option value="">all ops</option>
            {OP_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>

          <input
            className="border-border bg-bg-tertiary text-fg w-24 rounded-md border px-2 py-1 text-[12px]"
            onChange={(e) => {
              const v = Number.parseInt(e.target.value, 10)
              setMinDurationMs(Number.isFinite(v) ? v : null)
            }}
            placeholder="≥ ms"
            type="number"
            value={minDurationMs ?? ''}
          />
        </div>
      </header>

      {traces.length === 0 ? (
        <EmptyState
          hint="Send an http.client span from a Sentori-instrumented client."
          title="No traces yet"
        />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="bg-bg sticky top-0 z-10">
              <tr className="border-border text-fg-muted border-b text-[11px] tracking-wider uppercase">
                <th className="px-4 text-left">Op</th>
                <th className="px-4 text-left">Name</th>
                <th className="px-4 text-right">Span count</th>
                <th className="px-4 text-right">Duration</th>
                <th className="px-4 text-left">Status</th>
                <th className="px-4 text-right">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t, i) => (
                <tr
                  className={`border-border/40 cursor-pointer border-b ${dCls.rowClass} ${
                    i === selectedIdx ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary/60'
                  }`}
                  key={t.traceId}
                  onClick={() => {
                    setSelectedIdx(i)
                    open(t)
                  }}
                >
                  <td className="text-fg-muted px-4 font-mono">{t.rootOp ?? '—'}</td>
                  <td className="text-fg truncate px-4">{t.rootName ?? '—'}</td>
                  <td className="text-fg-muted px-4 text-right tabular-nums">{t.spanCount}</td>
                  <td className="text-fg-muted px-4 text-right tabular-nums">
                    {formatDuration(t.durationMs)}
                  </td>
                  <td className="px-4">
                    <StatusPill status={t.status} />
                  </td>
                  <td className="text-fg-muted px-4 text-right tabular-nums">
                    {formatRelative(t.lastSeen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMoreSentinel
            hasMore={tracesInfinite.hasNextPage}
            isFetching={tracesInfinite.isFetchingNextPage}
            onLoadMore={() => void tracesInfinite.fetchNextPage()}
          />
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: TraceRow['status'] }) {
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

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime()
  const now = Date.now()
  const s = Math.max(0, Math.round((now - then) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

function LoadMoreSentinel({
  hasMore,
  isFetching,
  onLoadMore,
}: {
  hasMore: boolean
  isFetching: boolean
  onLoadMore: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hasMore || isFetching) return
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onLoadMore()
      },
      { rootMargin: '300px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, isFetching, onLoadMore])

  if (!hasMore) return null
  return (
    <div className="border-border/40 flex items-center justify-center border-t py-3" ref={ref}>
      <button
        className="text-fg-muted hover:text-fg text-[12px]"
        disabled={isFetching}
        onClick={onLoadMore}
        type="button"
      >
        {isFetching ? 'Loading…' : 'Load more'}
      </button>
    </div>
  )
}

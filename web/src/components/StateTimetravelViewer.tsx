import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * v0.9.3 +S2-VIEW — render an event's `stateSnapshot` attachment.
 *
 * The SDK side (`src/state-snapshots.ts`) records shallow diffs of
 * bound stores (Redux / Zustand / manual) into a 50-slot ring and
 * dumps it as JSON at captureException time. Shape:
 *
 *     {
 *       "snapshots": [
 *         { "ts": 1715645234567, "source": "redux",
 *           "diff": { "cart.items": [...] } },
 *         ...
 *       ]
 *     }
 *
 * UI:
 *   - left rail: vertical timeline of snapshots (source + relative ts).
 *   - right pane: the diff payload of the focused snapshot rendered
 *     as a recursive collapsible JSON tree.
 *   - "rehydrate forward" toggle: accumulate diffs from the first
 *     snapshot up to + including the focused index → shows the
 *     reconstructed state at that point, not just the diff.
 *   - keyboard: ← / → step through.
 *
 * Future (v1.0): cross-link with breadcrumb timeline so clicking a
 * breadcrumb scrolls to the nearest snapshot.
 */

type Snapshot = {
  ts: number
  source: string
  diff: Record<string, unknown>
}

type StateSnapshotsPayload = {
  snapshots: Snapshot[]
}

async function fetchSnapshots(eventId: string, ref: string): Promise<StateSnapshotsPayload> {
  const url = `/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(ref)}`
  const resp = await fetch(url, { credentials: 'include' })
  if (!resp.ok) throw new Error(`state snapshot ${resp.status}`)
  return (await resp.json()) as StateSnapshotsPayload
}

export function StateTimetravelViewer({
  attachmentRef,
  eventId,
}: {
  attachmentRef: string
  eventId: string
}) {
  const { data, error, isLoading } = useQuery({
    queryFn: () => fetchSnapshots(eventId, attachmentRef),
    queryKey: ['state-snapshot', eventId, attachmentRef],
    staleTime: Infinity,
  })

  const snapshots = useMemo(() => data?.snapshots ?? [], [data])
  const [focus, setFocus] = useState<null | number>(null)
  const [rehydrate, setRehydrate] = useState(false)
  const effectiveFocus = focus !== null ? focus : snapshots.length > 0 ? snapshots.length - 1 : null

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (snapshots.length === 0) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setFocus((cur) => {
          const base = cur ?? snapshots.length - 1
          return Math.max(0, base - 1)
        })
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setFocus((cur) => {
          const base = cur ?? snapshots.length - 1
          return Math.min(snapshots.length - 1, base + 1)
        })
      }
    },
    [snapshots.length]
  )
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  const crashTs = useMemo(() => {
    if (snapshots.length === 0) return null
    return snapshots[snapshots.length - 1]!.ts
  }, [snapshots])

  // Forward-rehydrated state at the focused index: apply each diff
  // top-level key onto an empty accumulator. Same-key writes overwrite
  // (matching the SDK-side shallowDiff semantics).
  const rehydratedState = useMemo(() => {
    if (effectiveFocus === null) return {}
    const acc: Record<string, unknown> = {}
    for (let i = 0; i <= effectiveFocus; i++) {
      const s = snapshots[i]
      if (!s) continue
      for (const [k, v] of Object.entries(s.diff)) acc[k] = v
    }
    return acc
  }, [snapshots, effectiveFocus])

  if (isLoading) return <div className="text-fg-muted text-[11px]">Loading state snapshots…</div>
  if (error)
    return (
      <div className="text-[11px] text-[color:var(--color-danger)]">
        Failed to load state snapshots.
      </div>
    )
  if (snapshots.length === 0)
    return <div className="text-fg-muted text-[11px]">No snapshots recorded.</div>

  const focused = effectiveFocus === null ? null : (snapshots[effectiveFocus] ?? null)
  const payloadToRender: Record<string, unknown> = rehydrate ? rehydratedState : (focused?.diff ?? {})

  return (
    <div className="grid grid-cols-[200px_1fr] gap-3">
      <ol className="border-border max-h-[320px] overflow-y-auto rounded border" role="listbox">
        {snapshots.map((s, i) => (
          <li key={i}>
            <button
              aria-selected={effectiveFocus === i}
              className={`hover:bg-bg-tertiary/50 block w-full px-2 py-1 text-left text-[11px] ${
                effectiveFocus === i ? 'bg-bg-tertiary text-fg' : 'text-fg-muted'
              }`}
              onClick={() => setFocus(i)}
              type="button"
            >
              <div className="flex items-baseline gap-2">
                <span className="text-fg-muted font-mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="text-fg-muted bg-bg-tertiary rounded px-1 py-[1px] text-[9px] uppercase">
                  {s.source}
                </span>
                {crashTs !== null && (
                  <span className="text-fg-muted ml-auto font-mono text-[9px]">
                    {relativeFromCrash(s.ts, crashTs)}
                  </span>
                )}
              </div>
              <div className="text-fg-muted truncate text-[10px]">
                {Object.keys(s.diff).join(', ')}
              </div>
            </button>
          </li>
        ))}
      </ol>
      <div className="border-border rounded border">
        <div className="border-border flex items-center justify-between border-b px-3 py-1.5">
          <div className="text-[11px]">
            <span className="text-fg-muted">Snapshot</span>{' '}
            <span className="font-mono">
              {effectiveFocus !== null ? effectiveFocus + 1 : '?'} of {snapshots.length}
            </span>
            {focused && (
              <span className="text-fg-muted ml-3">
                <span className="bg-bg-tertiary text-fg-muted rounded px-1 py-[1px] text-[9px] uppercase">
                  {focused.source}
                </span>
                {crashTs !== null && (
                  <span className="ml-2 font-mono text-[10px]">
                    {relativeFromCrash(focused.ts, crashTs)}
                  </span>
                )}
              </span>
            )}
          </div>
          <label className="text-fg-muted flex items-center gap-1.5 text-[10px]">
            <input
              checked={rehydrate}
              onChange={(e) => setRehydrate(e.target.checked)}
              type="checkbox"
            />
            rehydrate forward
          </label>
        </div>
        <div className="max-h-[320px] overflow-y-auto p-3 text-[11px]">
          <JsonTree value={payloadToRender} root />
        </div>
      </div>
    </div>
  )
}

/** Minimal collapsible JSON tree renderer. Recursive on objects /
 *  arrays. Primitives render inline. Strings get quoted; bigints
 *  appended `n`; symbols stringified. */
function JsonTree({ root = false, value }: { root?: boolean; value: unknown }) {
  if (value === null) return <span className="text-fg-muted">null</span>
  if (value === undefined) return <span className="text-fg-muted">undefined</span>
  if (typeof value === 'string') {
    return <span className="text-[color:var(--color-success)]">&quot;{value}&quot;</span>
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return <span className="text-[color:var(--color-info)]">{String(value)}</span>
  }
  if (typeof value === 'boolean') {
    return <span className="text-amber-400">{String(value)}</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-fg-muted">[]</span>
    return (
      <details className={root ? '' : 'pl-3'} open>
        <summary className="text-fg-muted cursor-pointer">
          Array({value.length})
        </summary>
        <ul className="border-fg-muted/20 ml-3 border-l pl-2">
          {value.map((v, i) => (
            <li key={i} className="flex items-baseline gap-1">
              <span className="text-fg-muted font-mono">{i}:</span>
              <JsonTree value={v} />
            </li>
          ))}
        </ul>
      </details>
    )
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return <span className="text-fg-muted">{'{}'}</span>
    return (
      <details className={root ? '' : 'pl-3'} open>
        <summary className="text-fg-muted cursor-pointer">
          Object({entries.length})
        </summary>
        <ul className="border-fg-muted/20 ml-3 border-l pl-2">
          {entries.map(([k, v]) => (
            <li key={k} className="flex items-baseline gap-1">
              <span className="text-fg font-mono">{k}:</span>
              <JsonTree value={v} />
            </li>
          ))}
        </ul>
      </details>
    )
  }
  return <span className="text-fg-muted">{String(value)}</span>
}

function relativeFromCrash(ts: number, crashTs: number): string {
  const delta = crashTs - ts
  if (delta === 0) return 'at crash'
  if (delta < 1000) return `${delta}ms before`
  if (delta < 60_000) return `${(delta / 1000).toFixed(1)}s before`
  return `${(delta / 60_000).toFixed(1)}min before`
}

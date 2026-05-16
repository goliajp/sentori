import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * v0.9.6 #2 — wireframe replay player.
 *
 * Fetches the `replay` attachment (NDJSON), parses each line as a
 * snapshot {ts, width, height, nodes[]}, and renders an SVG of the
 * focused snapshot. Scrubber on the left lets the operator step
 * through. Ts column shows "X s before crash" relative to the last
 * snapshot.
 *
 * Wireframe renderer is intentionally crude: every node becomes an
 * SVG `<rect>` (or `<text>` for kind=text, "masked" gray for
 * kind=mask). No animation between frames — operator scrubs and
 * sees discrete snapshots. Future polish: tween across snapshots
 * with CSS transitions; cross-link with breadcrumb timeline.
 */

type Node = {
  kind?: 'image' | 'mask' | 'rect' | 'text'
  x: number
  y: number
  w: number
  h: number
  text?: string
  color?: string
}

type Snapshot = {
  ts: number
  width: number
  height: number
  nodes: Node[]
}

async function fetchReplay(eventId: string, ref: string): Promise<Snapshot[]> {
  const url = `/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(ref)}`
  const resp = await fetch(url, { credentials: 'include' })
  if (!resp.ok) throw new Error(`replay ${resp.status}`)
  const text = await resp.text()
  const lines = text.split('\n').filter((l) => l.trim().length > 0)
  const out: Snapshot[] = []
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as Snapshot)
    } catch {
      // skip malformed snapshot
    }
  }
  return out
}

export function ReplayPlayer({
  attachmentRef,
  eventId,
}: {
  attachmentRef: string
  eventId: string
}) {
  const { data, error, isLoading } = useQuery({
    queryFn: () => fetchReplay(eventId, attachmentRef),
    queryKey: ['replay', eventId, attachmentRef],
    staleTime: Infinity,
  })

  const snapshots = useMemo(() => data ?? [], [data])
  const [focus, setFocus] = useState<null | number>(null)
  const effectiveFocus = focus !== null ? focus : snapshots.length > 0 ? snapshots.length - 1 : null

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (snapshots.length === 0) return
      // ←/↑ step back, →/↓ step forward — both directions because
      // operators come from different listbox conventions and the
      // wireframe is a vertical scroll list.
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocus((cur) => Math.max(0, (cur ?? snapshots.length - 1) - 1))
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setFocus((cur) => Math.min(snapshots.length - 1, (cur ?? snapshots.length - 1) + 1))
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

  if (isLoading) return <div className="text-fg-muted text-[11px]">Loading replay…</div>
  if (error)
    return (
      <div className="text-[11px] text-[color:var(--color-danger)]">
        Failed to load wireframe replay.
      </div>
    )
  if (snapshots.length === 0)
    return <div className="text-fg-muted text-[11px]">No snapshots in replay attachment.</div>

  const focused = effectiveFocus === null ? null : (snapshots[effectiveFocus] ?? null)

  return (
    <div className="grid grid-cols-[180px_1fr] gap-3">
      <ol className="border-border max-h-[480px] overflow-y-auto rounded border" role="listbox">
        {snapshots.map((s, i) => (
          <li key={i}>
            <button
              aria-selected={effectiveFocus === i}
              className={`hover:bg-bg-tertiary/50 focus:outline-accent focus:outline focus:outline-1 -outline-offset-1 block w-full px-2 py-1 text-left text-[11px] transition-colors ${
                effectiveFocus === i ? 'bg-bg-tertiary text-fg' : 'text-fg-muted'
              }`}
              onClick={() => setFocus(i)}
              type="button"
            >
              <div className="flex items-baseline justify-between gap-2 font-mono">
                <span>{String(i + 1).padStart(2, '0')}</span>
                {crashTs !== null && (
                  <span className="text-[9px]">{relativeFromCrash(s.ts, crashTs)}</span>
                )}
              </div>
              <div className="text-[9px] text-fg-muted">{s.nodes.length} nodes</div>
            </button>
          </li>
        ))}
      </ol>
      <div className="border-border bg-bg-secondary overflow-hidden rounded border">
        {focused === null ? (
          <div className="text-fg-muted p-3 text-[11px]">Pick a snapshot.</div>
        ) : (
          <WireframeSvg snapshot={focused} />
        )}
      </div>
    </div>
  )
}

function WireframeSvg({ snapshot }: { snapshot: Snapshot }) {
  const w = snapshot.width
  const h = snapshot.height
  return (
    <svg
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', maxHeight: 480, width: '100%' }}
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect fill="var(--color-bg)" height={h} width={w} x={0} y={0} />
      {snapshot.nodes.map((n, i) => (
        <NodeRender key={i} node={n} />
      ))}
    </svg>
  )
}

function NodeRender({ node }: { node: Node }) {
  const fill = node.color ?? defaultFill(node.kind)
  if (node.kind === 'text' && node.text) {
    const fontSize = Math.min(14, Math.max(8, node.h * 0.6))
    return (
      <g>
        <text
          fill={node.color ?? 'var(--color-fg)'}
          fontFamily="system-ui, -apple-system, sans-serif"
          fontSize={fontSize}
          x={node.x}
          y={node.y + node.h * 0.7}
        >
          {node.text}
        </text>
      </g>
    )
  }
  return (
    <rect
      fill={fill}
      height={node.h}
      stroke="var(--color-border)"
      strokeWidth={0.5}
      width={node.w}
      x={node.x}
      y={node.y}
    />
  )
}

// Wireframe palette uses fixed greys (not theme tokens). The
// dashboard's *chrome* honors the dark/light theme, but a wireframe
// "screenshot" should look the same regardless of who's viewing it —
// otherwise a dark-mode operator and a light-mode operator looking
// at the same crash see different visuals.
function defaultFill(kind?: string): string {
  switch (kind) {
    case 'mask':
      return 'var(--color-fg)'
    case 'image':
      return 'var(--color-bg-tertiary)'
    case 'rect':
      return 'var(--color-bg-tertiary)'
    default:
      return 'transparent'
  }
}

function relativeFromCrash(ts: number, crashTs: number): string {
  const delta = crashTs - ts
  if (delta === 0) return 'crash'
  if (delta < 1000) return `${delta}ms`
  if (delta < 60_000) return `${(delta / 1000).toFixed(1)}s`
  return `${(delta / 60_000).toFixed(1)}min`
}

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Wireframe replay player — inline rendering under
 * "Captured at error → Session replay" on the issue detail page.
 *
 * v1.0 polish round:
 *
 *   1. The canvas now sizes itself to the wireframe's natural mobile
 *      aspect (portrait, ~9:19.5) so the SVG no longer letterboxes
 *      against a wide parent — the "what's the dark area on the
 *      right" question goes away. The frame list + canvas now sit
 *      side-by-side in a grid that lets the canvas claim only the
 *      width its aspect needs.
 *
 *   2. Play controls — ▶ play / ⏸ pause + Prev / Next + a horizontal
 *      slider. Auto-advance is 1 Hz (matches the SDK sampler cadence),
 *      stops at the last frame. ←/→ still works for keyboard nav.
 *
 *   3. Frame list shows a delta count per row ("Δ +3 / −1 / ~5" —
 *      added / removed / changed nodes versus the previous frame).
 *      Lets the operator skim straight to "where things moved"
 *      instead of clicking through identical-looking snapshots. We
 *      also drop byte-equal consecutive frames the SDK still ships
 *      (defence in depth — the SDK has its own dedup but it only
 *      catches exact-byte equality; we additionally collapse
 *      frames that have the same node count + same root size and
 *      a zero-delta diff, which is the common "UI didn't move"
 *      case).
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

type SnapshotWithDelta = Snapshot & {
  /** 0 means "no movement vs prev"; null for the first frame. */
  delta: null | { added: number; changed: number; removed: number }
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

/** Spatial-fingerprint diff between two frames (same approach as
 *  the dedicated Replay tab). Cheap O(n) under integer rounding. */
function diffSnapshots(
  prev: Snapshot,
  next: Snapshot
): { added: number; changed: number; removed: number } {
  const key = (n: Node) =>
    `${Math.round(n.x)},${Math.round(n.y)},${Math.round(n.w)},${Math.round(n.h)}`
  const prevMap = new Map<string, Node>()
  for (const n of prev.nodes) prevMap.set(key(n), n)
  let added = 0
  let changed = 0
  const matched = new Set<string>()
  for (const n of next.nodes) {
    const k = key(n)
    const p = prevMap.get(k)
    if (!p) {
      added++
    } else {
      matched.add(k)
      if (
        (p.kind ?? '') !== (n.kind ?? '') ||
        (p.color ?? '') !== (n.color ?? '') ||
        (p.text ?? '') !== (n.text ?? '')
      ) {
        changed++
      }
    }
  }
  let removed = 0
  for (const k of prevMap.keys()) if (!matched.has(k)) removed++
  return { added, changed, removed }
}

/** Drop consecutive frames that produce a zero-delta diff. The SDK
 *  byte-dedups, but a re-rendered frame with identical structure can
 *  still slip through; we collapse it here so the operator's list
 *  doesn't repeat the same wireframe N times. */
function withDeltas(snapshots: Snapshot[]): SnapshotWithDelta[] {
  const out: SnapshotWithDelta[] = []
  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i]!
    if (i === 0) {
      out.push({ ...s, delta: null })
      continue
    }
    const prev = out[out.length - 1]!
    const d = diffSnapshots(prev, s)
    if (d.added === 0 && d.removed === 0 && d.changed === 0) continue // collapse
    out.push({ ...s, delta: d })
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

  const snapshots = useMemo<SnapshotWithDelta[]>(() => (data ? withDeltas(data) : []), [data])
  const [focusIdx, setFocusIdx] = useState<number>(0)
  const [playing, setPlaying] = useState(false)
  const safeIdx = Math.min(Math.max(focusIdx, 0), Math.max(snapshots.length - 1, 0))

  // Auto-advance — 1 Hz matches the SDK sampler default. Stops at
  // the end (no wrap-around — playing past the last frame would
  // re-render the same crash state forever).
  useEffect(() => {
    if (!playing || snapshots.length === 0) return
    const id = window.setInterval(() => {
      setFocusIdx((cur) => {
        const next = cur + 1
        if (next >= snapshots.length) {
          setPlaying(false)
          return cur
        }
        return next
      })
    }, 1000)
    return () => window.clearInterval(id)
  }, [playing, snapshots.length])

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (snapshots.length === 0) return
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setFocusIdx((cur) => Math.max(0, cur - 1))
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setFocusIdx((cur) => Math.min(snapshots.length - 1, cur + 1))
      } else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
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

  if (isLoading) return <Hint>Loading replay…</Hint>
  if (error) return <Hint tone="danger">Failed to load wireframe replay.</Hint>
  if (snapshots.length === 0) return <Hint>No snapshots in replay attachment.</Hint>

  const focused = snapshots[safeIdx] ?? null
  const totalRaw = (data ?? []).length
  const collapsed = totalRaw - snapshots.length

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[200px_1fr] gap-4">
        <FrameList
          collapsedCount={collapsed}
          crashTs={crashTs}
          onFocus={setFocusIdx}
          safeIdx={safeIdx}
          snapshots={snapshots}
        />
        <CanvasFrame snapshot={focused} />
      </div>

      <Scrubber
        canBack={safeIdx > 0}
        canForward={safeIdx < snapshots.length - 1}
        onPlayPause={() => setPlaying((p) => !p)}
        onSeek={setFocusIdx}
        onStepBack={() => setFocusIdx((c) => Math.max(0, c - 1))}
        onStepForward={() => setFocusIdx((c) => Math.min(snapshots.length - 1, c + 1))}
        playing={playing}
        selectedIdx={safeIdx}
        totalFrames={snapshots.length}
      />
    </div>
  )
}

function FrameList({
  collapsedCount,
  crashTs,
  onFocus,
  safeIdx,
  snapshots,
}: {
  collapsedCount: number
  crashTs: null | number
  onFocus: (i: number) => void
  safeIdx: number
  snapshots: SnapshotWithDelta[]
}) {
  return (
    <div>
      <ol
        aria-label="Replay snapshot list"
        className="max-h-[420px] overflow-y-auto border-y border-[color:var(--rule)]"
        role="listbox"
      >
        {snapshots.map((s, i) => (
          <li key={i}>
            <button
              aria-selected={safeIdx === i}
              className={`block w-full border-b border-[color:var(--rule-soft)] px-2.5 py-1.5 text-left transition-colors last:border-b-0 ${
                safeIdx === i
                  ? 'bg-[color:var(--accent-soft)] text-[color:var(--ink)]'
                  : 'text-[color:var(--ink-soft)] hover:bg-[color:var(--paper-2)]'
              }`}
              onClick={() => onFocus(i)}
              role="option"
              type="button"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[12px] tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="font-mono text-[10px] text-[color:var(--ink-muted)]">
                  {crashTs !== null ? relativeFromCrash(s.ts, crashTs) : ''}
                </span>
              </div>
              <div className="mt-0.5 flex items-baseline justify-between gap-2 font-mono text-[10px] text-[color:var(--ink-muted)]">
                <span>{s.nodes.length} nodes</span>
                <DeltaChip delta={s.delta} />
              </div>
            </button>
          </li>
        ))}
      </ol>
      {collapsedCount > 0 && (
        <p className="mt-2 font-mono text-[10px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase">
          {collapsedCount} identical frame{collapsedCount === 1 ? '' : 's'} collapsed
        </p>
      )}
    </div>
  )
}

function DeltaChip({
  delta,
}: {
  delta: null | { added: number; changed: number; removed: number }
}) {
  if (!delta) return <span className="text-[color:var(--ink-muted)]/60">start</span>
  if (delta.added === 0 && delta.changed === 0 && delta.removed === 0) {
    return <span className="text-[color:var(--ink-muted)]/60">·</span>
  }
  return (
    <span className="space-x-1.5">
      {delta.added > 0 && (
        <span className="text-[color:var(--success)]" title={`${delta.added} added`}>
          +{delta.added}
        </span>
      )}
      {delta.removed > 0 && (
        <span className="text-[color:var(--danger)]" title={`${delta.removed} removed`}>
          −{delta.removed}
        </span>
      )}
      {delta.changed > 0 && (
        <span className="text-[color:var(--warning)]" title={`${delta.changed} changed`}>
          ~{delta.changed}
        </span>
      )}
    </span>
  )
}

/** Canvas pinned to the wireframe's natural aspect ratio — no
 *  letterbox bars. Width is whatever the parent gives us up to the
 *  aspect-derived ceiling; height follows. */
function CanvasFrame({ snapshot }: { snapshot: null | Snapshot }) {
  if (!snapshot) {
    return (
      <div className="flex h-[420px] items-center justify-center border border-[color:var(--rule)] text-[12px] text-[color:var(--ink-muted)]">
        Pick a snapshot.
      </div>
    )
  }
  const aspect = snapshot.width / snapshot.height
  return (
    <div
      className="mx-auto border border-[color:var(--rule)] bg-[color:var(--paper-2)]"
      style={{
        aspectRatio: `${aspect}`,
        maxHeight: 480,
        width: `min(100%, calc(480px * ${aspect}))`,
      }}
    >
      <WireframeSvg snapshot={snapshot} />
    </div>
  )
}

function Scrubber({
  canBack,
  canForward,
  onPlayPause,
  onSeek,
  onStepBack,
  onStepForward,
  playing,
  selectedIdx,
  totalFrames,
}: {
  canBack: boolean
  canForward: boolean
  onPlayPause: () => void
  onSeek: (i: number) => void
  onStepBack: () => void
  onStepForward: () => void
  playing: boolean
  selectedIdx: number
  totalFrames: number
}) {
  return (
    <div className="flex items-center gap-3 border-t border-[color:var(--rule)] pt-3">
      <button
        aria-label="Previous frame"
        className="inline-flex h-7 items-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink)] uppercase disabled:opacity-40"
        disabled={!canBack}
        onClick={onStepBack}
        type="button"
      >
        ◀ prev
      </button>
      <button
        aria-label={playing ? 'Pause' : 'Play'}
        className="inline-flex h-7 items-center border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--paper)] uppercase"
        onClick={onPlayPause}
        type="button"
      >
        {playing ? '⏸ pause' : '▶ play'}
      </button>
      <button
        aria-label="Next frame"
        className="inline-flex h-7 items-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink)] uppercase disabled:opacity-40"
        disabled={!canForward}
        onClick={onStepForward}
        type="button"
      >
        next ▶
      </button>
      <input
        aria-label="Frame slider"
        className="flex-1 accent-[color:var(--accent)]"
        max={Math.max(totalFrames - 1, 0)}
        min={0}
        onChange={(e) => onSeek(Number(e.target.value))}
        type="range"
        value={selectedIdx}
      />
      <span className="font-mono text-[11px] text-[color:var(--ink-muted)] tabular-nums">
        {selectedIdx + 1} / {totalFrames}
      </span>
    </div>
  )
}

function WireframeSvg({ snapshot }: { snapshot: Snapshot }) {
  const w = snapshot.width
  const h = snapshot.height
  return (
    <svg
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', height: '100%', width: '100%' }}
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Canvas bg comes from the parent div (var(--paper-2)); the SVG
       *  does NOT paint its own background — previously this rect was
       *  the same colour as the parent which made it impossible to
       *  tell the wireframe area apart from any letterbox bars, and
       *  it also competed with the node fills below for visibility.
       *  Pulling it out also makes diff overlays render cleaner since
       *  there's only one chrome layer to read.
       */}
      {snapshot.nodes.map((n, i) => (
        <NodeRender key={i} node={n} />
      ))}
    </svg>
  )
}

/**
 * If the SDK emitted an explicit colour for the node, use it only when
 * it would visibly contrast against the canvas (paper-2 in light mode,
 * warm-dark in dark mode). Android's `view.background` on dark-mode
 * apps often paints near-white; rendering that literally erases the
 * shape. Falls back to the structural tint for low-contrast emits.
 */
function pickFill(color: string | undefined, kind: string | undefined): string {
  if (!color) return defaultFill(kind)
  const lum = parseHexLuminance(color)
  if (lum === null) return color // unknown shape, trust the SDK
  if (lum > 0.92) return defaultFill(kind) // near-white, would vanish on paper-2
  return color
}

function parseHexLuminance(hex: string): null | number {
  // Accepts #RGB, #RRGGBB, #RRGGBBAA. Returns relative luminance in [0,1].
  const m = /^#?([0-9a-f]{3,8})$/i.exec(hex.trim())
  if (!m) return null
  let body = m[1]!
  if (body.length === 3)
    body = body
      .split('')
      .map((c) => c + c)
      .join('')
  if (body.length < 6) return null
  const r = parseInt(body.slice(0, 2), 16) / 255
  const g = parseInt(body.slice(2, 4), 16) / 255
  const b = parseInt(body.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function NodeRender({ node }: { node: Node }) {
  const fill = pickFill(node.color, node.kind)
  if (node.kind === 'text' && node.text) {
    const fontSize = Math.min(14, Math.max(8, node.h * 0.6))
    return (
      <g>
        <text
          // Wireframe is a structural diagram — readability against
          // the canvas beats colour fidelity. Android's
          // `view.currentTextColor` returns white on dark-mode apps
          // (#FFFFFFB3 is common), which would be invisible against
          // the light paper-2 canvas; force the ink token instead so
          // text content reads on any host UI.
          fill="var(--ink)"
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
      stroke="rgba(0,0,0,0.18)"
      strokeWidth={0.5}
      width={node.w}
      x={node.x}
      y={node.y}
    />
  )
}

/**
 * Default fills are theme-agnostic alpha tints so they're visible on
 * both paper-2 (light) and the warm-dark background (dark) without
 * needing two palettes. Android emits most nodes as `kind: rect` /
 * `image` with no `color` field (only TextView sets one), so a bg-
 * matching default would erase ~95% of an Android wireframe — the
 * exact symptom Insight hit on the qualcomm-insight verify event.
 */
function defaultFill(kind?: string): string {
  switch (kind) {
    case 'mask':
      return 'rgba(0,0,0,0.65)'
    case 'image':
      // Slight blue tint so image placeholders read as "media" not
      // "container", mirroring how design tools cue image regions.
      return 'rgba(59,130,246,0.12)'
    case 'rect':
      return 'rgba(0,0,0,0.08)'
    default:
      return 'rgba(0,0,0,0.05)'
  }
}

function Hint({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <p
      className={`border-y border-[color:var(--rule)] py-3 text-[12px] ${
        tone === 'danger' ? 'text-[color:var(--danger)]' : 'text-[color:var(--ink-soft)]'
      }`}
    >
      {children}
    </p>
  )
}

function relativeFromCrash(ts: number, crashTs: number): string {
  const delta = crashTs - ts
  if (delta === 0) return 'crash'
  if (delta < 1000) return `${delta}ms`
  if (delta < 60_000) return `${(delta / 1000).toFixed(1)}s`
  return `${(delta / 60_000).toFixed(1)}min`
}

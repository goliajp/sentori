import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { adminApi, type ReplayFrame } from '@/api/client'
import {
  isCircleShape,
  WIREFRAME_IMAGE_FILL,
  WIREFRAME_IMAGE_OPACITY,
  WIREFRAME_MASK_FILL,
  WIREFRAME_RECT_FALLBACK_OPACITY,
  WIREFRAME_RECT_FILL,
  WIREFRAME_RECT_OPACITY,
  WIREFRAME_TEXT_FILL,
} from '@/lib/wireframe-palette'

/**
 * v1.0 A4 — Replay tab on the issue detail surface.
 *
 * Layout (single column inside the tab body):
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │  Replay · 42 frames · ref 9c2…                   │
 *   ├──────────────────────────────────────────────────┤
 *   │                                                  │
 *   │   ┌─────────────┐    Frame 23 / 42               │
 *   │   │             │    ts: +12.4 s                  │
 *   │   │ <wireframe  │    nodes: 47                    │
 *   │   │   SVG       │    bounds: 390 × 844            │
 *   │   │   render>   │                                 │
 *   │   │             │    [diff vs previous]           │
 *   │   └─────────────┘                                 │
 *   │                                                  │
 *   │   ▏▎▍▌▋▊▉█▉▊▋▌▍▎▏  ─◯─────────                  │
 *   │   thumbnails        time slider                   │
 *   │                                                  │
 *   │   [◀ prev]  [▶ play]  [next ▶]   ← / → step      │
 *   └──────────────────────────────────────────────────┘
 *
 * The frame canvas renders each node as an SVG rect (with optional
 * label) — same primitive shape the iOS sampler emits. The scrubber
 * is keyboard-driven (←/→ to step, space to play/pause) and the
 * thumbnail strip is direct-jump.
 *
 * Empty state: when the server's replay-frames endpoint returns
 * `frames: []` (event has no replay attachment) we show a tooltip
 * explaining the SDK config needed to opt in. No 404 / error
 * special-casing.
 */
export function ReplayTab({ eventId, projectId }: { eventId: string; projectId: string }) {
  const framesQ = useQuery({
    enabled: !!projectId && !!eventId,
    queryFn: () => adminApi.listReplayFrames(projectId, eventId),
    queryKey: ['replay-frames', projectId, eventId],
    staleTime: 60_000,
  })

  const frames = framesQ.data?.frames ?? []
  const ref = framesQ.data?.ref ?? null
  const [idx, setIdx] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [diffMode, setDiffMode] = useState(false)
  const safeIdx = frames.length > 0 ? Math.min(idx, frames.length - 1) : 0
  const current = frames[safeIdx]
  const previous = safeIdx > 0 ? frames[safeIdx - 1] : undefined

  // Auto-play steps at ~2 Hz to match the sampler cadence. Stop at
  // the end (don't loop — staring at a wrap-around is disorienting
  // when debugging a crash).
  useEffect(() => {
    if (!playing || frames.length === 0) return
    const tick = setInterval(() => {
      setIdx((cur) => {
        if (cur >= frames.length - 1) {
          setPlaying(false)
          return cur
        }
        return cur + 1
      })
    }, 500)
    return () => clearInterval(tick)
  }, [playing, frames.length])

  // Keyboard navigation on the panel — ←/→ to step, space to play.
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (frames.length === 0) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        setIdx((c) => Math.min(c + 1, frames.length - 1))
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setIdx((c) => Math.max(c - 1, 0))
      } else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'Home') {
        setIdx(0)
      } else if (e.key === 'End') {
        setIdx(frames.length - 1)
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [frames.length])

  if (framesQ.isLoading) {
    return <Empty hint="Fetching replay frames…" title="Replay" />
  }
  if (framesQ.error) {
    return <Empty hint="Failed to load replay frames." title="Replay" />
  }
  if (frames.length === 0) {
    return (
      <Empty
        hint="No replay attachment on this event. Enable wireframe replay in your SDK init: capture.replay = { mode: 'wireframe', hz: 1 } — the SDK will then ship the last 60 seconds of wireframe snapshots with every captureException."
        title="No replay captured"
      />
    )
  }

  // Time elapsed since frame 0, in seconds.
  const baseTs = frames[0]!.ts
  const elapsedSec = current ? (current.ts - baseTs) / 1000 : 0

  return (
    <section
      aria-label="Wireframe replay scrubber"
      className="space-y-3"
      ref={panelRef}
      role="region"
      tabIndex={0}
    >
      <header className="flex items-baseline gap-4 border-b border-[color:var(--rule)] pb-2">
        <span className="text-[15px] font-medium text-[color:var(--ink)]">Wireframe replay</span>
        <span className="font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink-muted)] tabular-nums">
          {frames.length} frame{frames.length === 1 ? '' : 's'}
        </span>
        {ref && (
          <span className="ml-auto font-mono text-[11px] text-[color:var(--ink-muted)]">
            ref {ref.slice(0, 8)}…
          </span>
        )}
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-5">
        <ReplayCanvas diffMode={diffMode} frame={current} prevFrame={previous} />
        <ReplayMeta
          baseTs={baseTs}
          diffEnabled={diffMode}
          elapsedSec={elapsedSec}
          frame={current}
          frameIdx={safeIdx}
          onToggleDiff={() => setDiffMode((d) => !d)}
          prevFrame={previous}
          totalFrames={frames.length}
        />
      </div>

      <ThumbnailRail frames={frames} onSelect={setIdx} selectedIdx={safeIdx} />

      <ScrubberControls
        canStepBack={safeIdx > 0}
        canStepForward={safeIdx < frames.length - 1}
        onPlayPause={() => setPlaying((p) => !p)}
        onSeek={setIdx}
        onStepBack={() => setIdx((c) => Math.max(c - 1, 0))}
        onStepForward={() => setIdx((c) => Math.min(c + 1, frames.length - 1))}
        playing={playing}
        selectedIdx={safeIdx}
        totalFrames={frames.length}
      />
    </section>
  )
}

/** SVG wireframe renderer. One <rect> per node + a soft <text>
 *  glyph when the node has visible copy.
 *
 *  When `diffMode` is on and `prevFrame` is provided, each node is
 *  tagged "added" / "removed" / "changed" / "same" by spatial-position
 *  matching (see `computeDiff` below). Added nodes draw with a
 *  success outline, removed with a danger outline as ghosts of the
 *  previous frame, changed with a warning outline. Same-as-previous
 *  nodes render normally.
 */
function ReplayCanvas({
  diffMode,
  frame,
  prevFrame,
}: {
  diffMode: boolean
  frame?: ReplayFrame
  prevFrame?: ReplayFrame
}) {
  if (!frame) {
    return (
      <div className="flex h-[420px] items-center justify-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] text-[color:var(--ink-muted)]">
        no frame
      </div>
    )
  }
  const diff = diffMode && prevFrame ? computeDiff(prevFrame, frame) : null

  const a11yLabel = diff
    ? `Wireframe frame, ${frame.nodes.length} nodes — diff overlay on, ${diff.removed.length} removed`
    : `Wireframe frame, ${frame.nodes.length} nodes`
  return (
    <div className="bg-[color:var(--paper-2)]">
      <svg
        aria-label={a11yLabel}
        className="block w-full"
        overflow="hidden"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        style={{ maxHeight: '420px', overflow: 'hidden' }}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
      >
        <title>{a11yLabel}</title>
        <desc>
          Wireframe snapshot of the host app at the selected timeline frame.
          {diff && ' Coloured outlines highlight nodes that changed since the previous frame.'}
        </desc>
        {/* rc.8 — clip-path so an overflowing walker emission can't
         *  paint outside the device frame. */}
        <defs>
          <clipPath id="wf-tab-viewport-clip">
            <rect height={frame.height} width={frame.width} x={0} y={0} />
          </clipPath>
        </defs>
        <g clipPath="url(#wf-tab-viewport-clip)">
          {/* Removed-nodes layer: render ghosts of the previous frame's
           *  positions that are absent in the current frame. */}
          {diff &&
            prevFrame &&
            diff.removed.map((i) => (
              <NodeShape diffStatus="removed" key={`r${i}`} node={prevFrame.nodes[i]!} />
            ))}
          {frame.nodes.map((n, i) => (
            <NodeShape diffStatus={diff ? diff.status[i] : undefined} key={i} node={n} />
          ))}
        </g>
      </svg>
    </div>
  )
}

export type DiffStatus = 'added' | 'changed' | 'removed' | 'same'

/** Match nodes across two frames by their (x, y, w, h) spatial
 *  fingerprint — the SDK doesn't emit stable IDs so position is
 *  the best honest matcher. Returns:
 *
 *  - `status[i]` for each node in `next`: 'added' (no spatial match
 *    in prev) / 'changed' (matched but kind|color|text differs) /
 *    'same' (matched and identical)
 *  - `removed[]`: indices in `prev` that have no spatial match in `next`
 */
export function computeDiff(
  prev: ReplayFrame,
  next: ReplayFrame
): { removed: number[]; status: DiffStatus[] } {
  const key = (n: ReplayFrame['nodes'][number]) =>
    `${Math.round(n.x)},${Math.round(n.y)},${Math.round(n.w)},${Math.round(n.h)}`
  const prevMap = new Map<string, number>()
  prev.nodes.forEach((n, i) => prevMap.set(key(n), i))
  const status: DiffStatus[] = next.nodes.map((n) => {
    const k = key(n)
    const pIdx = prevMap.get(k)
    if (pIdx === undefined) return 'added'
    const p = prev.nodes[pIdx]!
    prevMap.delete(k)
    return p.kind === n.kind && p.color === n.color && p.text === n.text ? 'same' : 'changed'
  })
  // Anything still in prevMap was removed.
  const removed: number[] = Array.from(prevMap.values())
  return { removed, status }
}

function NodeShape({
  diffStatus,
  node,
}: {
  diffStatus?: DiffStatus
  node: ReplayFrame['nodes'][number]
}) {
  // Structural wireframe — colour comes from the curated palette via
  // a stable hash of the node's spatial fingerprint. Same node keeps
  // the same hue across frames, so the diff overlay strokes
  // (added/changed/removed) are the only thing the eye has to scan
  // for visual change. See `lib/wireframe-palette.ts` for the why.
  const text = node.kind === 'text' && node.text ? truncate(node.text, 60) : null

  if (node.kind === 'text' && text) {
    return (
      <text
        dominantBaseline="middle"
        fill={WIREFRAME_TEXT_FILL}
        fontFamily="system-ui"
        fontSize={Math.max(8, Math.min(node.h * 0.6, 14))}
        opacity={diffStatus === 'removed' ? 0.45 : 1}
        x={node.x + 2}
        y={node.y + node.h / 2}
      >
        {text}
      </text>
    )
  }

  // SDK colour pass-through with a solid-white fallback; the shared
  // `fill-opacity` knob is what makes overlapping rectangles describe
  // depth instead of saturating into a flat block. Diff overlay keeps
  // the semantic stroke colours (added / changed / removed) since
  // those carry meaning beyond structural decoration.
  const isMask = node.kind === 'mask'
  const isImage = node.kind === 'image'

  const hasExplicitColor = !isMask && !isImage && !!node.color
  let fill: string = isMask
    ? WIREFRAME_MASK_FILL
    : isImage
      ? WIREFRAME_IMAGE_FILL
      : (node.color ?? WIREFRAME_RECT_FILL)
  // Mask stays at its declared opacity (already a heavy rgba). Rect
  // without an SDK-emitted colour drops to the fallback opacity so
  // the grid pattern underneath still reads through old captures.
  let fillOpacity = isMask
    ? 1
    : isImage
      ? WIREFRAME_IMAGE_OPACITY
      : hasExplicitColor
        ? WIREFRAME_RECT_OPACITY
        : WIREFRAME_RECT_FALLBACK_OPACITY
  let stroke = 'transparent'
  let strokeWidth = 0
  let opacity = 1
  if (diffStatus === 'added') {
    stroke = 'var(--success)'
    strokeWidth = 1.6
  } else if (diffStatus === 'changed') {
    stroke = 'var(--warning)'
    strokeWidth = 1.6
  } else if (diffStatus === 'removed') {
    stroke = 'var(--danger)'
    strokeWidth = 1.4
    fill = 'transparent'
    fillOpacity = 0
    opacity = 0.55
  }

  if (isImage && isCircleShape(node.w, node.h)) {
    const r = Math.min(node.w, node.h) / 2
    return (
      <g opacity={opacity}>
        <circle
          cx={node.x + node.w / 2}
          cy={node.y + node.h / 2}
          fill={fill}
          fillOpacity={fillOpacity}
          r={r}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      </g>
    )
  }

  return (
    <g opacity={opacity}>
      <rect
        fill={fill}
        fillOpacity={fillOpacity}
        height={node.h}
        rx={isImage ? 8 : 0}
        stroke={stroke}
        strokeWidth={strokeWidth}
        width={node.w}
        x={node.x}
        y={node.y}
      />
    </g>
  )
}

function ReplayMeta({
  baseTs,
  diffEnabled,
  elapsedSec,
  frame,
  frameIdx,
  onToggleDiff,
  prevFrame,
  totalFrames,
}: {
  baseTs: number
  diffEnabled: boolean
  elapsedSec: number
  frame?: ReplayFrame
  frameIdx: number
  onToggleDiff: () => void
  prevFrame?: ReplayFrame
  totalFrames: number
}) {
  void baseTs
  const counts = diffEnabled && prevFrame && frame ? summariseDiff(prevFrame, frame) : null

  return (
    <div className="space-y-1.5 pt-2">
      <Row label="frame" value={`${frameIdx + 1} / ${totalFrames}`} />
      <Row label="t+" value={`${elapsedSec.toFixed(2)} s`} />
      <Row label="ts" value={frame ? frame.ts.toString() : '—'} />
      <Row label="nodes" value={frame ? frame.nodes.length.toString() : '—'} />
      <Row
        label="viewport"
        value={frame ? `${Math.round(frame.width)} × ${Math.round(frame.height)}` : '—'}
      />

      <button
        aria-pressed={diffEnabled}
        className={`mt-3 inline-flex h-6 items-center border px-2 font-mono text-[10px] tracking-[0.12em] uppercase transition-colors ${
          diffEnabled
            ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)]'
            : 'border-[color:var(--rule)] text-[color:var(--ink-soft)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]'
        }`}
        disabled={!prevFrame}
        onClick={onToggleDiff}
        type="button"
      >
        {diffEnabled ? '◉' : '○'} diff vs prev
      </button>

      {counts && (
        <div className="mt-2 space-y-1">
          <DiffRow color="success" count={counts.added} label="added" />
          <DiffRow color="warning" count={counts.changed} label="changed" />
          <DiffRow color="danger" count={counts.removed} label="removed" />
        </div>
      )}
    </div>
  )
}

function DiffRow({
  color,
  count,
  label,
}: {
  color: 'danger' | 'success' | 'warning'
  count: number
  label: string
}) {
  return (
    <div className="grid grid-cols-[60px_1fr] items-baseline gap-3">
      <span
        className={`font-mono text-[10px] tracking-[0.18em] uppercase text-[color:var(--${color})]`}
      >
        {label}
      </span>
      <span className="font-mono text-[12px] text-[color:var(--ink)] tabular-nums">{count}</span>
    </div>
  )
}

export function summariseDiff(prev: ReplayFrame, next: ReplayFrame) {
  const key = (n: ReplayFrame['nodes'][number]) =>
    `${Math.round(n.x)},${Math.round(n.y)},${Math.round(n.w)},${Math.round(n.h)}`
  const prevMap = new Map<string, number>()
  prev.nodes.forEach((n, i) => prevMap.set(key(n), i))
  let added = 0
  let changed = 0
  for (const n of next.nodes) {
    const k = key(n)
    const pIdx = prevMap.get(k)
    if (pIdx === undefined) {
      added += 1
      continue
    }
    const p = prev.nodes[pIdx]!
    prevMap.delete(k)
    if (p.kind !== n.kind || p.color !== n.color || p.text !== n.text) {
      changed += 1
    }
  }
  return { added, changed, removed: prevMap.size }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[60px_1fr] items-baseline gap-3">
      <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </span>
      <span className="font-mono text-[12px] text-[color:var(--ink)] tabular-nums">{value}</span>
    </div>
  )
}

/** Horizontal thumbnail strip — one mini SVG per frame. Each is a
 *  click-target jumping the scrubber. Active frame gets the accent
 *  outline. */
function ThumbnailRail({
  frames,
  onSelect,
  selectedIdx,
}: {
  frames: ReplayFrame[]
  onSelect: (i: number) => void
  selectedIdx: number
}) {
  return (
    <div
      aria-label="Replay frame timeline"
      className="flex gap-1 overflow-x-auto py-2"
      role="listbox"
    >
      {frames.map((f, i) => (
        <button
          aria-selected={i === selectedIdx}
          className={`shrink-0 transition-opacity ${
            i === selectedIdx
              ? 'outline outline-2 outline-[color:var(--accent)]'
              : 'outline outline-1 outline-[color:var(--rule)] hover:opacity-80'
          }`}
          key={i}
          onClick={() => onSelect(i)}
          role="option"
          type="button"
        >
          <svg
            className="block bg-[color:var(--paper-2)]"
            preserveAspectRatio="xMidYMid meet"
            style={{ height: 48, width: 28 }}
            viewBox={`0 0 ${f.width} ${f.height}`}
          >
            {f.nodes.slice(0, 60).map((n, j) => (
              <rect
                fill={n.kind === 'mask' ? '#000' : n.color || 'rgba(255,255,255,0.4)'}
                height={n.h}
                key={j}
                width={n.w}
                x={n.x}
                y={n.y}
              />
            ))}
          </svg>
        </button>
      ))}
    </div>
  )
}

function ScrubberControls({
  canStepBack,
  canStepForward,
  onPlayPause,
  onSeek,
  onStepBack,
  onStepForward,
  playing,
  selectedIdx,
  totalFrames,
}: {
  canStepBack: boolean
  canStepForward: boolean
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
        className="inline-flex h-7 items-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2.5 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink)] uppercase transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:opacity-40"
        disabled={!canStepBack}
        onClick={onStepBack}
        type="button"
      >
        ◀ prev
      </button>
      <button
        className="inline-flex h-7 items-center bg-[color:var(--accent)] px-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--paper)] uppercase transition-opacity hover:opacity-90"
        onClick={onPlayPause}
        type="button"
      >
        {playing ? '⏸ pause' : '▶ play'}
      </button>
      <button
        className="inline-flex h-7 items-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2.5 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink)] uppercase transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)] disabled:opacity-40"
        disabled={!canStepForward}
        onClick={onStepForward}
        type="button"
      >
        next ▶
      </button>
      <input
        aria-label="Replay frame slider"
        className="ml-2 h-1 flex-1 accent-[color:var(--accent)]"
        max={totalFrames - 1}
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

function Empty({ hint, title }: { hint: string; title: string }) {
  return (
    <div className="border-y border-[color:var(--rule)] py-8 text-center">
      <div className="mb-1 font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
        {title}
      </div>
      <div className="mx-auto max-w-prose text-[13px] leading-relaxed text-[color:var(--ink-soft)]">
        {hint}
      </div>
    </div>
  )
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max - 1) + '…'
}

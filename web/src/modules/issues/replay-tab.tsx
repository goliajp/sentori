import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { adminApi, type ReplayFrame } from '@/api/client'

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
  const safeIdx = frames.length > 0 ? Math.min(idx, frames.length - 1) : 0
  const current = frames[safeIdx]

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
    <section className="space-y-3" ref={panelRef} tabIndex={0}>
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
        <ReplayCanvas frame={current} />
        <ReplayMeta
          baseTs={baseTs}
          elapsedSec={elapsedSec}
          frame={current}
          frameIdx={safeIdx}
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
 *  glyph when the node has visible copy. */
function ReplayCanvas({ frame }: { frame?: ReplayFrame }) {
  if (!frame) {
    return (
      <div className="flex h-[420px] items-center justify-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] text-[color:var(--ink-muted)]">
        no frame
      </div>
    )
  }
  // Cap height; aspect locked to the device viewport from the
  // sampler so the proportions match what the user actually saw.
  return (
    <div className="bg-[color:var(--paper-2)]">
      <svg
        className="block w-full"
        preserveAspectRatio="xMidYMid meet"
        style={{ maxHeight: '420px' }}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
      >
        {frame.nodes.map((n, i) => (
          <NodeShape key={i} node={n} />
        ))}
      </svg>
    </div>
  )
}

function NodeShape({ node }: { node: ReplayFrame['nodes'][number] }) {
  const fill =
    node.kind === 'mask'
      ? '#000'
      : node.kind === 'image'
        ? 'var(--ink-muted)'
        : node.color || 'rgba(255,255,255,0.06)'
  const stroke = node.kind === 'text' ? 'none' : 'rgba(255,255,255,0.12)'
  return (
    <g>
      <rect
        fill={fill}
        height={node.h}
        rx={node.kind === 'image' || node.kind === 'rect' ? 2 : 0}
        stroke={stroke}
        strokeWidth={0.5}
        width={node.w}
        x={node.x}
        y={node.y}
      />
      {node.kind === 'text' && node.text && (
        <text
          dominantBaseline="middle"
          fill="rgba(255,255,255,0.78)"
          fontFamily="system-ui"
          fontSize={Math.max(8, Math.min(node.h * 0.6, 14))}
          x={node.x + 2}
          y={node.y + node.h / 2}
        >
          {truncate(node.text, 60)}
        </text>
      )}
    </g>
  )
}

function ReplayMeta({
  baseTs,
  elapsedSec,
  frame,
  frameIdx,
  totalFrames,
}: {
  baseTs: number
  elapsedSec: number
  frame?: ReplayFrame
  frameIdx: number
  totalFrames: number
}) {
  void baseTs
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
    </div>
  )
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

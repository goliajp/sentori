import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
import {
  asV2OrUpgradeV1,
  type Node,
  type ReconstructedFrame,
  ReplayTimeline,
} from '@/lib/replay-reconstruct'
import { qk } from '@/api/query-keys'

/**
 * Wireframe replay player — inline rendering under
 * "Captured at error → Session replay" on the issue-detail page.
 *
 * rc.9 v2 model:
 *   - Replay attachment is keyframe + delta NDJSON (see
 *     docs/replay-encoding-v2.md). `ReplayTimeline` does the
 *     reconstruction; this component just drives the playback clock.
 *   - Seek axis is real time (ms relative to clip start), not a
 *     frame index. The scrubber bar reads `0.0s / 60.0s`.
 *   - Playback is a rAF loop. Each rendered frame finds the two
 *     bracketing captures and cross-fades between them via stacked
 *     `<g opacity>` layers, so the perceived smoothness is 60 fps
 *     even though the SDK captures at 4 Hz.
 *   - The left-side panel lists keyframes only (clickable seek
 *     targets) — deltas show up implicitly as the wireframe
 *     animating between keyframes.
 */

async function fetchReplayLines(eventId: string, ref: string): Promise<ReplayTimeline> {
  const url = `/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(ref)}`
  const resp = await fetch(url, { credentials: 'include' })
  if (!resp.ok) throw new Error(`replay ${resp.status}`)
  const text = await resp.text()
  const lines = asV2OrUpgradeV1(text)
  return new ReplayTimeline(lines)
}

export function ReplayPlayer({
  attachmentRef,
  eventId,
}: {
  attachmentRef: string
  eventId: string
}) {
  const { data, error, isLoading } = useQuery({
    // v1.1 #ux: hold the prior event's replay frames painted while the
    // new event's NDJSON is in flight. Without this every [ / ] press
    // flashed the wireframe pane back to a skeleton.
    placeholderData: (prev) => prev,
    queryFn: () => fetchReplayLines(eventId, attachmentRef),
    queryKey: qk.event.replay(eventId, attachmentRef),
    staleTime: Infinity,
  })

  const timeline = data ?? null
  const duration = timeline?.durationMs() ?? 0
  const captureTimes = useMemo(() => timeline?.captureTimes() ?? [], [timeline])
  const keyframeTimes = useMemo(() => timeline?.keyframeTimes() ?? [], [timeline])
  const startTs = timeline?.startTs() ?? 0

  const [playheadRel, setPlayheadRel] = useState(0) // ms relative to clip start
  const [playing, setPlaying] = useState(false)

  const playStartRef = useRef<{ replayStartRel: number; wallStart: number } | null>(null)
  const rafRef = useRef<null | number>(null)

  // rAF playback loop. Drives `playheadRel` from wall-clock so playback
  // speed matches real time regardless of render rate.
  useEffect(() => {
    if (!playing || !timeline || duration <= 0) return
    playStartRef.current = {
      replayStartRel: playheadRel,
      wallStart: performance.now(),
    }
    const tick = () => {
      const info = playStartRef.current
      if (!info) return
      const now = performance.now()
      const next = info.replayStartRel + (now - info.wallStart)
      if (next >= duration) {
        setPlayheadRel(duration)
        setPlaying(false)
        return
      }
      setPlayheadRel(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, timeline, duration])

  const seekToRel = useCallback(
    (relMs: number) => {
      setPlayheadRel((prev) => {
        const clamped = Math.max(0, Math.min(duration, relMs))
        // If we're playing, restart the wall-clock anchor at the new position.
        if (playStartRef.current !== null) {
          playStartRef.current = { replayStartRel: clamped, wallStart: performance.now() }
        }
        return clamped === prev ? prev : clamped
      })
    },
    [duration]
  )

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (!timeline) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekToRel(playheadRel - 250)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekToRel(playheadRel + 250)
      } else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      }
    },
    [timeline, playheadRel, seekToRel]
  )
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  if (isLoading) return <Hint>Loading replay…</Hint>
  if (error) return <Hint tone="danger">Failed to load wireframe replay.</Hint>
  if (!timeline || captureTimes.length === 0) {
    return <Hint>No frames in replay attachment.</Hint>
  }

  // Render: compute bracketing captures + alpha.
  const playheadAbs = startTs + playheadRel
  const { left, right, alpha } = pickBrackets(timeline, captureTimes, playheadAbs)

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[200px_1fr] gap-4">
        <KeyframeList
          keyframeTimes={keyframeTimes}
          onSeek={(absTs) => seekToRel(absTs - startTs)}
          playheadAbs={playheadAbs}
          startTs={startTs}
        />
        <CanvasFrame alpha={alpha} left={left} right={right} />
      </div>

      <TimeScrubber
        canBack={playheadRel > 0}
        canForward={playheadRel < duration}
        captureTimes={captureTimes}
        durationMs={duration}
        keyframeTimes={keyframeTimes}
        onPlayPause={() => {
          if (playheadRel >= duration) setPlayheadRel(0)
          setPlaying((p) => !p)
        }}
        onSeek={seekToRel}
        playheadRelMs={playheadRel}
        playing={playing}
        startTs={startTs}
      />
    </div>
  )
}

function pickBrackets(
  timeline: ReplayTimeline,
  captureTimes: number[],
  playheadAbs: number
): { alpha: number; left: null | ReconstructedFrame; right: null | ReconstructedFrame } {
  if (captureTimes.length === 0) return { alpha: 0, left: null, right: null }
  // Find rightmost captureTime <= playheadAbs.
  let leftIdx = 0
  for (let i = 0; i < captureTimes.length; i++) {
    if (captureTimes[i]! <= playheadAbs) leftIdx = i
    else break
  }
  const leftTs = captureTimes[leftIdx]!
  const rightTs = leftIdx + 1 < captureTimes.length ? captureTimes[leftIdx + 1]! : leftTs
  const span = rightTs - leftTs
  const alpha = span <= 0 ? 0 : Math.max(0, Math.min(1, (playheadAbs - leftTs) / span))
  return {
    alpha,
    left: timeline.reconstructAt(leftTs),
    right: timeline.reconstructAt(rightTs),
  }
}

function CanvasFrame({
  alpha,
  left,
  right,
}: {
  alpha: number
  left: null | ReconstructedFrame
  right: null | ReconstructedFrame
}) {
  const ref = right ?? left
  if (!ref) {
    return (
      <div className="flex h-[420px] items-center justify-center border border-[color:var(--rule)] text-[12px] text-[color:var(--ink-muted)]">
        Empty replay.
      </div>
    )
  }
  const aspect = ref.width / ref.height
  return (
    <div
      className="mx-auto border border-[color:var(--rule)] bg-[color:var(--paper-2)]"
      style={{
        aspectRatio: `${aspect}`,
        maxHeight: 480,
        width: `min(100%, calc(480px * ${aspect}))`,
      }}
    >
      <WireframeSvg alpha={alpha} left={left} right={right} />
    </div>
  )
}

function WireframeSvg({
  alpha,
  left,
  right,
}: {
  alpha: number
  left: null | ReconstructedFrame
  right: null | ReconstructedFrame
}) {
  const ref = right ?? left
  if (!ref) return null
  const w = ref.width
  const h = ref.height
  return (
    <svg
      overflow="hidden"
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', height: '100%', width: '100%', overflow: 'hidden' }}
      viewBox={`0 0 ${w} ${h}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <clipPath id="wf-viewport-clip">
          <rect height={h} width={w} x={0} y={0} />
        </clipPath>
      </defs>
      <g clipPath="url(#wf-viewport-clip)">
        {/* Cross-fade: left at (1 - α), right at α. Matched nodes
         *  with identical color sit at full opacity (cumulative); a
         *  color-changed node visibly tweens between the two; an
         *  added or removed node fades in / out. */}
        {left && (
          <g opacity={1 - alpha}>
            {left.nodes.map((n, i) => (
              <NodeRender key={`l${i}`} node={n} />
            ))}
          </g>
        )}
        {right && right !== left && (
          <g opacity={alpha}>
            {right.nodes.map((n, i) => (
              <NodeRender key={`r${i}`} node={n} />
            ))}
          </g>
        )}
        {/* Single-state case (left === right or only one): render once at α=1 */}
        {right && right === left && (
          <g>
            {right.nodes.map((n, i) => (
              <NodeRender key={i} node={n} />
            ))}
          </g>
        )}
      </g>
    </svg>
  )
}

function NodeRender({ node }: { node: Node }) {
  if (node.kind === 'text' && node.text) {
    const fontSize = Math.min(14, Math.max(8, node.h * 0.6))
    return (
      <text
        fill={WIREFRAME_TEXT_FILL}
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize={fontSize}
        x={node.x}
        y={node.y + node.h * 0.7}
      >
        {node.text}
      </text>
    )
  }
  if (node.kind === 'mask') {
    return <rect fill={WIREFRAME_MASK_FILL} height={node.h} width={node.w} x={node.x} y={node.y} />
  }

  const isImage = node.kind === 'image'
  const hasExplicitColor = !isImage && !!node.color
  const fill = isImage ? WIREFRAME_IMAGE_FILL : (node.color ?? WIREFRAME_RECT_FILL)
  const fillOpacity = isImage
    ? WIREFRAME_IMAGE_OPACITY
    : hasExplicitColor
      ? WIREFRAME_RECT_OPACITY
      : WIREFRAME_RECT_FALLBACK_OPACITY

  if (isImage && isCircleShape(node.w, node.h)) {
    const r = Math.min(node.w, node.h) / 2
    return (
      <circle
        cx={node.x + node.w / 2}
        cy={node.y + node.h / 2}
        fill={fill}
        fillOpacity={fillOpacity}
        r={r}
      />
    )
  }

  const rx = isImage ? 8 : 0
  return (
    <rect
      fill={fill}
      fillOpacity={fillOpacity}
      height={node.h}
      rx={rx}
      width={node.w}
      x={node.x}
      y={node.y}
    />
  )
}

function KeyframeList({
  keyframeTimes,
  onSeek,
  playheadAbs,
  startTs,
}: {
  keyframeTimes: number[]
  onSeek: (absTs: number) => void
  playheadAbs: number
  startTs: number
}) {
  // Index of the keyframe currently in effect (largest <= playhead).
  let activeIdx = 0
  for (let i = 0; i < keyframeTimes.length; i++) {
    if (keyframeTimes[i]! <= playheadAbs) activeIdx = i
    else break
  }
  return (
    <div>
      <ol
        aria-label="Replay keyframe list"
        className="max-h-[420px] overflow-y-auto border-y border-[color:var(--rule)]"
        role="listbox"
      >
        {keyframeTimes.map((ts, i) => {
          const rel = ts - startTs
          const active = i === activeIdx
          return (
            <li key={ts}>
              <button
                aria-selected={active}
                className={`block w-full border-b border-[color:var(--rule-soft)] px-2.5 py-1.5 text-left transition-colors last:border-b-0 ${
                  active
                    ? 'bg-[color:var(--accent-soft)] text-[color:var(--ink)]'
                    : 'text-[color:var(--ink-soft)] hover:bg-[color:var(--paper-2)]'
                }`}
                onClick={() => onSeek(ts)}
                role="option"
                type="button"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[12px] tabular-nums">
                    K{String(i + 1).padStart(2, '0')}
                  </span>
                  <span className="font-mono text-[10px] text-[color:var(--ink-muted)] tabular-nums">
                    {formatSecond(rel)}
                  </span>
                </div>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mt-2 font-mono text-[10px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase">
        keyframes · scrub between for detail
      </p>
    </div>
  )
}

function TimeScrubber({
  canBack,
  canForward,
  captureTimes,
  durationMs,
  keyframeTimes,
  onPlayPause,
  onSeek,
  playheadRelMs,
  playing,
  startTs,
}: {
  canBack: boolean
  canForward: boolean
  captureTimes: number[]
  durationMs: number
  keyframeTimes: number[]
  onPlayPause: () => void
  onSeek: (relMs: number) => void
  playheadRelMs: number
  playing: boolean
  startTs: number
}) {
  return (
    <div className="space-y-1 border-t border-[color:var(--rule)] pt-3">
      <div className="flex items-center gap-3">
        <button
          aria-label="Step back 250 ms"
          className="inline-flex h-7 items-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink)] uppercase disabled:opacity-40"
          disabled={!canBack}
          onClick={() => onSeek(playheadRelMs - 250)}
          type="button"
        >
          ◀ −0.25 s
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
          aria-label="Step forward 250 ms"
          className="inline-flex h-7 items-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink)] uppercase disabled:opacity-40"
          disabled={!canForward}
          onClick={() => onSeek(playheadRelMs + 250)}
          type="button"
        >
          +0.25 s ▶
        </button>
        <input
          aria-label="Replay seek (seconds)"
          className="flex-1 accent-[color:var(--accent)]"
          max={Math.max(durationMs, 0)}
          min={0}
          onChange={(e) => onSeek(Number(e.target.value))}
          step={10}
          type="range"
          value={playheadRelMs}
        />
        <span className="font-mono text-[11px] text-[color:var(--ink-muted)] tabular-nums">
          {formatSecond(playheadRelMs)} / {formatSecond(durationMs)}
        </span>
      </div>
      {/* Keyframe ticks on a parallel SVG strip so the operator sees
       *  cadence + capture density at a glance. */}
      <KeyframeTicks
        captureTimes={captureTimes}
        durationMs={durationMs}
        keyframeTimes={keyframeTimes}
        startTs={startTs}
      />
    </div>
  )
}

function KeyframeTicks({
  captureTimes,
  durationMs,
  keyframeTimes,
  startTs,
}: {
  captureTimes: number[]
  durationMs: number
  keyframeTimes: number[]
  startTs: number
}) {
  if (durationMs <= 0) return null
  return (
    <svg
      aria-hidden="true"
      className="block h-2 w-full"
      preserveAspectRatio="none"
      viewBox={`0 0 1000 10`}
    >
      {captureTimes.map((ts) => {
        const rel = ts - startTs
        const x = (rel / durationMs) * 1000
        return (
          <line
            key={`c${ts}`}
            stroke="var(--rule)"
            strokeOpacity={0.4}
            strokeWidth={0.5}
            x1={x}
            x2={x}
            y1={3}
            y2={7}
          />
        )
      })}
      {keyframeTimes.map((ts) => {
        const rel = ts - startTs
        const x = (rel / durationMs) * 1000
        return (
          <line
            key={`k${ts}`}
            stroke="var(--accent)"
            strokeOpacity={0.8}
            strokeWidth={1.2}
            x1={x}
            x2={x}
            y1={0}
            y2={10}
          />
        )
      })}
    </svg>
  )
}

function formatSecond(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return `${s.toFixed(2)}s`
}

function Hint({ children, tone }: { children: React.ReactNode; tone?: 'danger' }) {
  return (
    <p
      className={`border-y border-[color:var(--rule)] py-3 text-[12px] ${
        tone === 'danger' ? 'text-[color:var(--danger)]' : 'text-[color:var(--ink-muted)]'
      }`}
    >
      {children}
    </p>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { adminApi } from '@/api/client'
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
 * rc.9 Replay tab — dedicated detail surface for the wireframe
 * session-replay attachment. Layout:
 *
 *   ┌──────────────────────────────────────────────────┐
 *   │  Wireframe replay · 12.34 s · ref 9c2…           │
 *   ├──────────────────────────────────────────────────┤
 *   │   ┌─────────────┐    Frame meta                  │
 *   │   │  cross-fade │    ts: +X.XXs                  │
 *   │   │   render    │    nodes (interpolated): N      │
 *   │   │             │                                │
 *   │   └─────────────┘                                │
 *   │   capture/key tick strip ───────────             │
 *   │   [◀ −0.25s] [▶ play] [+0.25s ▶]  ◯───── 0:00 / 0:60│
 *   └──────────────────────────────────────────────────┘
 *
 * Same data layer as the inline `<ReplayPlayer>`: fetch raw
 * attachment NDJSON, parse with v2 reconstructor, drive a rAF
 * playback loop with cross-fade between bracketing captures.
 */
export function ReplayTab({ eventId, projectId }: { eventId: string; projectId: string }) {
  const attsQ = useQuery({
    enabled: !!projectId && !!eventId,
    // v1.1 #ux: hold prior event's attachment list while next loads.
    placeholderData: (prev) => prev,
    queryFn: () => adminApi.listEventAttachments(projectId, eventId),
    queryKey: qk.event.attachments(projectId, eventId),
    staleTime: 60_000,
  })

  const replayRef = useMemo(
    () => (attsQ.data ?? []).find((a) => a.kind === 'replay')?.ref ?? null,
    [attsQ.data]
  )

  const ndjsonQ = useQuery({
    enabled: !!replayRef,
    placeholderData: (prev) => prev,
    queryFn: () => fetchReplayNdjson(eventId, replayRef!),
    queryKey: qk.event.replayNdjson(eventId, replayRef),
    staleTime: Infinity,
  })

  const timeline = ndjsonQ.data ?? null
  const duration = timeline?.durationMs() ?? 0
  const captureTimes = useMemo(() => timeline?.captureTimes() ?? [], [timeline])
  const keyframeTimes = useMemo(() => timeline?.keyframeTimes() ?? [], [timeline])
  const startTs = timeline?.startTs() ?? 0

  const [playheadRel, setPlayheadRel] = useState(0)
  const [playing, setPlaying] = useState(false)
  const playStartRef = useRef<{ replayStartRel: number; wallStart: number } | null>(null)
  const rafRef = useRef<null | number>(null)

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
        if (playStartRef.current !== null) {
          playStartRef.current = { replayStartRel: clamped, wallStart: performance.now() }
        }
        return clamped === prev ? prev : clamped
      })
    },
    [duration]
  )

  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    const onKey = (e: KeyboardEvent) => {
      if (!timeline) return
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        seekToRel(playheadRel + 250)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        seekToRel(playheadRel - 250)
      } else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === 'Home') {
        seekToRel(0)
      } else if (e.key === 'End') {
        seekToRel(duration)
      }
    }
    el.addEventListener('keydown', onKey)
    return () => el.removeEventListener('keydown', onKey)
  }, [timeline, playheadRel, duration, seekToRel])

  if (attsQ.isLoading || ndjsonQ.isLoading) {
    return <Empty hint="Fetching replay frames…" title="Replay" />
  }
  if (attsQ.error || ndjsonQ.error) {
    return <Empty hint="Failed to load replay frames." title="Replay" />
  }
  if (!replayRef) {
    return (
      <Empty
        hint="No replay attachment on this event. Enable wireframe replay in your SDK init: capture.replay = { mode: 'wireframe' } — the SDK will then ship the last 60 seconds of wireframe snapshots with every captureException."
        title="No replay captured"
      />
    )
  }
  if (!timeline || captureTimes.length === 0) {
    return <Empty hint="The replay attachment was empty." title="Replay" />
  }

  const playheadAbs = startTs + playheadRel
  const { left, right, alpha } = pickBrackets(timeline, captureTimes, playheadAbs)
  const visibleNodeCount = right ? right.nodes.length : (left?.nodes.length ?? 0)

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
          {formatSecond(duration)} · {captureTimes.length} capture
          {captureTimes.length === 1 ? '' : 's'} · {keyframeTimes.length} key
        </span>
        <span className="ml-auto font-mono text-[11px] text-[color:var(--ink-muted)]">
          ref {replayRef.slice(0, 8)}…
        </span>
      </header>

      <div className="grid grid-cols-[minmax(0,1fr)_220px] gap-5">
        <ReplayCanvas alpha={alpha} left={left} right={right} />
        <ReplayMeta nodeCount={visibleNodeCount} playheadRelMs={playheadRel} />
      </div>

      <TimeScrubber
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
    </section>
  )
}

async function fetchReplayNdjson(eventId: string, ref: string): Promise<ReplayTimeline> {
  const url = `/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(ref)}`
  const resp = await fetch(url, { credentials: 'include' })
  if (!resp.ok) throw new Error(`replay ${resp.status}`)
  const text = await resp.text()
  return new ReplayTimeline(asV2OrUpgradeV1(text))
}

function pickBrackets(
  timeline: ReplayTimeline,
  captureTimes: number[],
  playheadAbs: number
): { alpha: number; left: null | ReconstructedFrame; right: null | ReconstructedFrame } {
  if (captureTimes.length === 0) return { alpha: 0, left: null, right: null }
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

function ReplayCanvas({
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
        no frame
      </div>
    )
  }
  return (
    <div className="bg-[color:var(--paper-2)]">
      <svg
        aria-label={`Wireframe at ${ref.ts}`}
        className="block w-full"
        overflow="hidden"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        style={{ maxHeight: '420px', overflow: 'hidden' }}
        viewBox={`0 0 ${ref.width} ${ref.height}`}
      >
        <title>{`Wireframe frame at ${ref.ts}`}</title>
        <desc>Wireframe snapshot of the host app at the selected timeline frame.</desc>
        <defs>
          <clipPath id="wf-tab-viewport-clip">
            <rect height={ref.height} width={ref.width} x={0} y={0} />
          </clipPath>
        </defs>
        <g clipPath="url(#wf-tab-viewport-clip)">
          {left && (
            <g opacity={1 - alpha}>
              {left.nodes.map((n, i) => (
                <NodeShape key={`l${i}`} node={n} />
              ))}
            </g>
          )}
          {right && right !== left && (
            <g opacity={alpha}>
              {right.nodes.map((n, i) => (
                <NodeShape key={`r${i}`} node={n} />
              ))}
            </g>
          )}
          {right && right === left && (
            <g>
              {right.nodes.map((n, i) => (
                <NodeShape key={i} node={n} />
              ))}
            </g>
          )}
        </g>
      </svg>
    </div>
  )
}

function NodeShape({ node }: { node: Node }) {
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
  const isMask = node.kind === 'mask'
  const isImage = node.kind === 'image'
  const hasExplicitColor = !isMask && !isImage && !!node.color
  const fill = isMask
    ? WIREFRAME_MASK_FILL
    : isImage
      ? WIREFRAME_IMAGE_FILL
      : (node.color ?? WIREFRAME_RECT_FILL)
  const fillOpacity = isMask
    ? 1
    : isImage
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

  return (
    <rect
      fill={fill}
      fillOpacity={fillOpacity}
      height={node.h}
      rx={isImage ? 8 : 0}
      width={node.w}
      x={node.x}
      y={node.y}
    />
  )
}

function ReplayMeta({ nodeCount, playheadRelMs }: { nodeCount: number; playheadRelMs: number }) {
  return (
    <dl className="space-y-2 font-mono text-[11px] tabular-nums">
      <Row label="time" value={formatSecond(playheadRelMs)} />
      <Row label="visible" value={`${nodeCount} nodes`} />
      <p className="pt-2 text-[10px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase">
        ← / → ±0.25 s · space play
      </p>
    </dl>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-baseline gap-x-3">
      <dt className="text-[10px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </dt>
      <dd className="text-[color:var(--ink)]">{value}</dd>
    </div>
  )
}

function TimeScrubber({
  captureTimes,
  durationMs,
  keyframeTimes,
  onPlayPause,
  onSeek,
  playheadRelMs,
  playing,
  startTs,
}: {
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
          disabled={playheadRelMs <= 0}
          onClick={() => onSeek(playheadRelMs - 250)}
          type="button"
        >
          ◀ −0.25s
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
          disabled={playheadRelMs >= durationMs}
          onClick={() => onSeek(playheadRelMs + 250)}
          type="button"
        >
          +0.25s ▶
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

function Empty({ hint, title }: { hint: string; title: string }) {
  return (
    <section aria-label="Wireframe replay" className="space-y-3">
      <header className="border-b border-[color:var(--rule)] pb-2">
        <span className="text-[15px] font-medium text-[color:var(--ink)]">{title}</span>
      </header>
      <p className="font-mono text-[12px] text-[color:var(--ink-muted)]">{hint}</p>
    </section>
  )
}

function formatSecond(ms: number): string {
  const s = Math.max(0, ms) / 1000
  return `${s.toFixed(2)}s`
}

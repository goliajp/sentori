/**
 * Replay encoding v2 reconstructor.
 *
 * Parses the NDJSON the rc.9 SDK ships (keyframe + delta lines) and
 * exposes `reconstructAt(ts)` so the player can render any timestamp
 * inside the clip. Memoises the last reconstructed (ts, state) so
 * scrubbing forward at 24 fps usually pays for one or two deltas
 * per render instead of a full rewind to the most-recent keyframe.
 *
 * See `docs/replay-encoding-v2.md` for the wire schema.
 */

export type Node = {
  x: number
  y: number
  w: number
  h: number
  kind?: string
  text?: string
  color?: string
}

export type KeyLine = {
  ts: number
  kind: 'key'
  width: number
  height: number
  nodes: Node[]
}

export type DeltaLine = {
  ts: number
  kind: 'delta'
  added: Node[]
  changed: Node[]
  removed: Pick<Node, 'x' | 'y' | 'w' | 'h'>[]
}

export type Line = DeltaLine | KeyLine

export type ReconstructedFrame = {
  ts: number
  width: number
  height: number
  nodes: Node[]
}

function fingerprint(n: Pick<Node, 'x' | 'y' | 'w' | 'h'>): string {
  return `${n.x | 0},${n.y | 0},${n.w | 0},${n.h | 0}`
}

/** Split NDJSON, drop malformed lines (don't crash the player just
 *  because one line is corrupt). Returns lines in input order. */
export function parseLines(text: string): Line[] {
  if (!text) return []
  const out: Line[] = []
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed) as Partial<Line> & Record<string, unknown>
      if (typeof obj.ts !== 'number') continue
      if (obj.kind === 'key' && Array.isArray((obj as KeyLine).nodes)) {
        out.push(obj as KeyLine)
      } else if (
        obj.kind === 'delta' &&
        Array.isArray((obj as DeltaLine).added) &&
        Array.isArray((obj as DeltaLine).changed) &&
        Array.isArray((obj as DeltaLine).removed)
      ) {
        out.push(obj as DeltaLine)
      }
    } catch {
      // skip malformed
    }
  }
  return out
}

/**
 * Stateful reconstructor. Cheap to construct (no work until first
 * `reconstructAt`); maintains a small memo so forward-scrubbing is
 * effectively O(1) per render.
 */
export class ReplayTimeline {
  private lines: Line[]
  private keyframeIndexes: number[]
  private memoTs = -Infinity
  private memoState: Map<string, Node> = new Map()
  private memoWidth = 0
  private memoHeight = 0

  constructor(lines: Line[]) {
    this.lines = lines
    this.keyframeIndexes = []
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]!.kind === 'key') this.keyframeIndexes.push(i)
    }
  }

  /** Smallest ts in the clip — useful for mapping wall-clock to play time. */
  startTs(): number {
    return this.lines.length > 0 ? this.lines[0]!.ts : 0
  }

  /** Largest ts in the clip. */
  endTs(): number {
    return this.lines.length > 0 ? this.lines[this.lines.length - 1]!.ts : 0
  }

  durationMs(): number {
    return Math.max(0, this.endTs() - this.startTs())
  }

  /** Distinct keyframe timestamps — for rendering tick marks on the scrubber. */
  keyframeTimes(): number[] {
    return this.keyframeIndexes.map((i) => this.lines[i]!.ts)
  }

  /** All capture timestamps (keyframes + deltas). */
  captureTimes(): number[] {
    return this.lines.map((l) => l.ts)
  }

  /**
   * Reconstruct the wireframe state visible at `targetTs`. Clamps to
   * the clip bounds. Returns null if the clip is empty.
   */
  reconstructAt(targetTs: number): null | ReconstructedFrame {
    if (this.lines.length === 0) return null
    const clamped = Math.max(this.startTs(), Math.min(this.endTs(), targetTs))

    // Fast path: forward step from memo if (a) target is at or after
    // the memo, AND (b) no keyframe sits between memo and target
    // (a keyframe in between resets state and forward-walking would
    // be wrong; rebuild from that keyframe instead).
    if (clamped >= this.memoTs && this.memoTs !== -Infinity) {
      let hasIntermediateKey = false
      for (let i = 0; i < this.lines.length; i++) {
        const l = this.lines[i]!
        if (l.ts > this.memoTs && l.ts <= clamped && l.kind === 'key') {
          hasIntermediateKey = true
          break
        }
      }
      if (!hasIntermediateKey) {
        for (let i = 0; i < this.lines.length; i++) {
          const l = this.lines[i]!
          if (l.ts <= this.memoTs) continue
          if (l.ts > clamped) break
          this.applyLine(l)
        }
        this.memoTs = clamped
        return this.snapshot()
      }
    }

    // Rebuild from the nearest keyframe ≤ clamped.
    const keyIdx = this.lastKeyframeAtOrBefore(clamped)
    if (keyIdx < 0) {
      // First keyframe is after target. Render empty (clip hasn't started yet).
      this.memoTs = -Infinity
      this.memoState = new Map()
      this.memoWidth = 0
      this.memoHeight = 0
      return null
    }
    const key = this.lines[keyIdx] as KeyLine
    this.memoState = new Map()
    for (const n of key.nodes) this.memoState.set(fingerprint(n), n)
    this.memoWidth = key.width
    this.memoHeight = key.height
    this.memoTs = key.ts

    for (let i = keyIdx + 1; i < this.lines.length; i++) {
      const l = this.lines[i]!
      if (l.ts > clamped) break
      this.applyLine(l)
    }
    this.memoTs = clamped
    return this.snapshot()
  }

  private lastKeyframeAtOrBefore(ts: number): number {
    // Binary search would be marginally faster on huge clips but the
    // keyframe count is bounded by clip-duration / keyframe-interval ≈
    // 15 at default cadence; linear is fine and obviously correct.
    let best = -1
    for (const idx of this.keyframeIndexes) {
      if (this.lines[idx]!.ts <= ts) best = idx
      else break
    }
    return best
  }

  private applyLine(l: Line): void {
    if (l.kind === 'key') {
      this.memoState = new Map()
      for (const n of l.nodes) this.memoState.set(fingerprint(n), n)
      this.memoWidth = l.width
      this.memoHeight = l.height
      return
    }
    for (const r of l.removed) this.memoState.delete(fingerprint(r))
    for (const a of l.added) this.memoState.set(fingerprint(a), a)
    for (const c of l.changed) this.memoState.set(fingerprint(c), c)
  }

  private snapshot(): ReconstructedFrame {
    return {
      ts: this.memoTs,
      width: this.memoWidth,
      height: this.memoHeight,
      nodes: Array.from(this.memoState.values()),
    }
  }
}

/** rc.9 → rc.8 fallback: if the NDJSON has no `kind` field on any
 *  line, treat each line as a standalone keyframe so archived
 *  pre-rc.9 events still play (just without cross-fade smoothness).
 *  Mutates the input lines to attach `kind: 'key'`. */
export function asV2OrUpgradeV1(rawText: string): Line[] {
  const trimmed = rawText.trim()
  if (!trimmed) return []
  const parsed = parseLines(trimmed)
  if (parsed.length > 0) return parsed

  // Try v1 — each line is a full snapshot without `kind`. Adapt.
  const out: Line[] = []
  for (const raw of trimmed.split('\n')) {
    const t = raw.trim()
    if (!t) continue
    try {
      const obj = JSON.parse(t) as {
        ts?: number
        width?: number
        height?: number
        nodes?: Node[]
      }
      if (
        typeof obj.ts === 'number' &&
        typeof obj.width === 'number' &&
        typeof obj.height === 'number' &&
        Array.isArray(obj.nodes)
      ) {
        out.push({
          ts: obj.ts,
          kind: 'key',
          width: obj.width,
          height: obj.height,
          nodes: obj.nodes,
        })
      }
    } catch {
      // skip
    }
  }
  return out
}

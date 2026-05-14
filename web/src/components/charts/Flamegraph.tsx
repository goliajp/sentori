import { useMemo, useState } from 'react'

/**
 * Phase 50 sub-A6 — span tree flamegraph.
 *
 * Renders a trace's span tree as a horizontal flamegraph: x = time,
 * y = depth (root at top), bar width = duration, bar color = status.
 * Hover surfaces a tooltip with span name + op + duration + status.
 *
 *     <Flamegraph spans={spans} />
 *
 * Pure SVG, no d3-flame-graph dep. Suits monitoring use-case where
 * trees are typically < 200 spans; for larger trees the caller should
 * sub-sample.
 */

export type FlamegraphSpan = {
  durationMs: number
  id: string
  name: string
  op: string
  parentSpanId: null | string
  startedAt: string
  status: 'cancelled' | 'error' | 'ok'
}

type Node = FlamegraphSpan & {
  children: Node[]
  depth: number
  endMs: number
  startMs: number
}

const ROW_H = 22

export function Flamegraph({ height = 360, spans }: { height?: number; spans: FlamegraphSpan[] }) {
  const tree = useMemo(() => buildTree(spans), [spans])
  const [hover, setHover] = useState<null | Node>(null)

  if (tree.length === 0) {
    return (
      <div
        className="text-fg-muted bg-bg-secondary border-border flex items-center justify-center rounded-md border text-[12px]"
        style={{ height }}
      >
        No spans in this trace.
      </div>
    )
  }

  // Compute global time window from the visible root forest.
  const minMs = Math.min(...tree.map((n) => n.startMs))
  const maxMs = Math.max(...tree.map((n) => n.endMs))
  const span = Math.max(1, maxMs - minMs)
  const depthMax = Math.max(...tree.map(maxDepth))
  const svgH = (depthMax + 1) * ROW_H + 16

  return (
    <div className="border-border bg-bg-secondary relative overflow-hidden rounded-md border">
      <svg
        height={Math.min(height, svgH)}
        preserveAspectRatio="none"
        role="img"
        viewBox={`0 0 1000 ${svgH}`}
        width="100%"
      >
        {tree.flatMap((root) =>
          flatten(root).map((node) => (
            <Bar
              fill={statusFill(node.status)}
              hovered={hover?.id === node.id}
              key={node.id}
              node={node}
              onHover={setHover}
              span={span}
              start={minMs}
            />
          ))
        )}
      </svg>
      {hover && (
        <div
          className="border-border bg-bg-tertiary pointer-events-none absolute rounded-md border px-2 py-1 text-[11px] shadow-lg"
          style={{ left: 8, top: 8 }}
        >
          <div className="text-fg font-medium">{hover.name}</div>
          <div className="text-fg-muted flex items-center gap-2 font-mono text-[10px]">
            <span>{hover.op}</span>
            <span>·</span>
            <span>{hover.durationMs.toFixed(1)} ms</span>
            <span>·</span>
            <span
              className={
                hover.status === 'ok'
                  ? 'text-[color:var(--color-success)]'
                  : hover.status === 'error'
                    ? 'text-[color:var(--color-danger)]'
                    : 'text-fg-muted'
              }
            >
              {hover.status}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function Bar({
  fill,
  hovered,
  node,
  onHover,
  span,
  start,
}: {
  fill: string
  hovered: boolean
  node: Node
  onHover: (n: null | Node) => void
  span: number
  start: number
}) {
  const xPct = ((node.startMs - start) / span) * 1000
  const wPct = (node.durationMs / span) * 1000
  const y = node.depth * ROW_H + 4
  return (
    <g
      onMouseEnter={() => onHover(node)}
      onMouseLeave={() => onHover(null)}
      style={{ cursor: 'pointer' }}
    >
      <rect
        fill={fill}
        height={ROW_H - 3}
        opacity={hovered ? 1 : 0.85}
        rx={2}
        stroke={hovered ? 'var(--color-fg)' : 'transparent'}
        strokeWidth={0.5}
        width={Math.max(1, wPct)}
        x={xPct}
        y={y}
      />
      {wPct > 60 && (
        <text fill="var(--color-bg)" fontSize="10" x={xPct + 4} y={y + ROW_H / 2 + 1}>
          {node.name.slice(0, Math.floor(wPct / 6))}
        </text>
      )}
    </g>
  )
}

function statusFill(s: FlamegraphSpan['status']): string {
  if (s === 'error') return 'var(--color-danger)'
  if (s === 'cancelled') return 'var(--color-warning)'
  return 'var(--color-accent)'
}

function buildTree(spans: FlamegraphSpan[]): Node[] {
  const byId: Map<string, Node> = new Map()
  for (const s of spans) {
    const start = new Date(s.startedAt).getTime()
    byId.set(s.id, {
      ...s,
      children: [],
      depth: 0,
      endMs: start + s.durationMs,
      startMs: start,
    })
  }
  const roots: Node[] = []
  for (const node of byId.values()) {
    if (node.parentSpanId && byId.has(node.parentSpanId)) {
      const parent = byId.get(node.parentSpanId)!
      parent.children.push(node)
      node.depth = parent.depth + 1
    } else {
      roots.push(node)
    }
  }
  // BFS to assign depths properly (in case nodes were inserted out of order).
  const queue: Node[] = [...roots]
  while (queue.length > 0) {
    const n = queue.shift()!
    for (const c of n.children) {
      c.depth = n.depth + 1
      queue.push(c)
    }
  }
  // Sort children by start time so the flamegraph reads left-to-right.
  for (const n of byId.values()) {
    n.children.sort((a, b) => a.startMs - b.startMs)
  }
  roots.sort((a, b) => a.startMs - b.startMs)
  return roots
}

function flatten(n: Node, acc: Node[] = []): Node[] {
  acc.push(n)
  for (const c of n.children) flatten(c, acc)
  return acc
}

function maxDepth(n: Node): number {
  if (n.children.length === 0) return n.depth
  return Math.max(...n.children.map(maxDepth))
}

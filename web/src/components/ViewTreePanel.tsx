import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { frameKey, useFrameHover } from '@/lib/frame-hover'

/**
 * Phase 42 sub-G.07/08/09 — render an event's `viewTree` attachment.
 *
 * The attachment payload is the JSON the native SDK wrote at crash
 * time, conforming to this shape:
 *
 *     {
 *       "rootId": "n1",
 *       "nodes": {
 *         "n1": {
 *           "type":  "UIView" | "View" | "FiberNode",
 *           "name":  "MyButton",
 *           "props_summary": { "frame": "0,0,393,852", "alpha": "1.00", ... },
 *           "children": ["n2", "n3"]
 *         },
 *         ...
 *       }
 *     }
 *
 * Component fetches the blob from
 * `/admin/api/events/<eventId>/attachments/<ref>` and renders the
 * tree with click-to-expand collapsing + a text search box that
 * filters by node `name` / `accessibilityLabel`.
 *
 * For dashboards with very deep / wide trees (1000+ nodes) the
 * default render flattens out — every expanded node is a DOM node.
 * Virtualisation with react-window is left for a follow-up; in
 * practice, real RN apps cap out around 200-400 nodes per screen
 * and the depth cap (10) keeps the DOM bounded.
 */

type ViewNode = {
  type: string
  name: string
  props_summary?: Record<string, string>
  children: string[]
  file?: string
  line?: number
}

type ViewTree = {
  rootId: string
  nodes: Record<string, ViewNode>
}

async function fetchViewTree(eventId: string, ref: string): Promise<ViewTree> {
  const url = `/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(ref)}`
  const resp = await fetch(url, { credentials: 'include' })
  if (!resp.ok) throw new Error(`view tree ${resp.status}`)
  return (await resp.json()) as ViewTree
}

export function ViewTreePanel({
  attachmentRef,
  eventId,
}: {
  attachmentRef: string
  eventId: string
}) {
  const { data, error, isLoading } = useQuery({
    queryFn: () => fetchViewTree(eventId, attachmentRef),
    queryKey: ['view-tree', eventId, attachmentRef],
    staleTime: 60 * 60 * 1000,
  })

  const [query, setQuery] = useState('')
  const [openSet, setOpenSet] = useState<null | Set<string>>(null)
  // Phase 47.02: sibling hover state from <FrameRow>. We turn the
  // hoveredKey ("file:line") into the set of node ids whose
  // `file + line` match, and highlight them on top of the search
  // highlight palette. Independent state slot so the search filter
  // and the frame hover don't fight.
  const { hoveredKey } = useFrameHover()

  // Default open: root + its direct children. Computed once when
  // the tree first arrives.
  const initialOpen = useMemo(() => {
    if (!data) return new Set<string>()
    const root = data.nodes[data.rootId]
    if (!root) return new Set<string>()
    return new Set<string>([data.rootId, ...root.children])
  }, [data])

  const open = openSet ?? initialOpen
  const toggle = (id: string) => {
    setOpenSet((cur) => {
      const next = new Set(cur ?? initialOpen)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Search-match set: every node whose name / accessibility label
  // contains the query (case-insensitive). When matching, also
  // expand all ancestors so the match is visible.
  const visibleHighlight = useMemo(() => {
    if (!data || !query.trim()) return null
    const q = query.toLowerCase()
    const matched = new Set<string>()
    for (const [id, n] of Object.entries(data.nodes)) {
      if (
        n.name.toLowerCase().includes(q) ||
        (n.props_summary?.accessibilityLabel ?? '').toLowerCase().includes(q) ||
        (n.props_summary?.contentDescription ?? '').toLowerCase().includes(q)
      ) {
        matched.add(id)
      }
    }
    return matched
  }, [data, query])

  // Phase 47.02: nodes matching the hovered stack frame's file:line.
  // Recomputed only when `hoveredKey` changes — Object.entries scan
  // is cheap for the ≤ a few hundred nodes we typically see.
  const hoverHighlight = useMemo(() => {
    if (!data || !hoveredKey) return null
    const matched = new Set<string>()
    for (const [id, n] of Object.entries(data.nodes)) {
      if (n.file && n.line !== undefined && frameKey(n.file, n.line) === hoveredKey) {
        matched.add(id)
      }
    }
    return matched.size > 0 ? matched : null
  }, [data, hoveredKey])

  // Auto-scroll the first hovered node into view. `scrollIntoView` on
  // an inner button without `block: 'nearest'` triggers the *outer*
  // scroll container too (the issue-detail tab body), which would
  // jolt the user away from the stack — so we scope to the panel's
  // own viewport and stay inside `nearest` to avoid yo-yoing.
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!hoverHighlight || hoverHighlight.size === 0 || !panelRef.current) return
    const firstId = hoverHighlight.values().next().value
    const el = panelRef.current.querySelector<HTMLElement>(`[data-node-id="${firstId}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [hoverHighlight])

  if (isLoading) {
    return <p className="text-fg-muted px-2 py-4 text-[12px]">Loading view tree…</p>
  }
  if (error) {
    return (
      <p className="px-2 py-4 text-[12px] text-[color:var(--color-danger)]">
        Failed to load view tree.
      </p>
    )
  }
  if (!data) return null

  const total = Object.keys(data.nodes).length

  return (
    <div className="space-y-2">
      <div className="text-fg-muted flex items-center gap-3 text-[11px]">
        <span>{total} nodes</span>
        <input
          aria-label="Search view tree"
          className="border-border bg-bg-tertiary text-fg ml-auto w-60 rounded-md border px-2 py-1 text-[11px]"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name / a11y label"
          type="text"
          value={query}
        />
      </div>
      <div
        className="border-border bg-bg-tertiary/30 max-h-[60vh] overflow-auto rounded-md border p-2 font-mono text-[11px]"
        ref={panelRef}
      >
        <TreeNode
          depth={0}
          highlight={visibleHighlight}
          hoverHighlight={hoverHighlight}
          id={data.rootId}
          nodes={data.nodes}
          onToggle={toggle}
          open={open}
        />
      </div>
    </div>
  )
}

function TreeNode({
  depth,
  highlight,
  hoverHighlight,
  id,
  nodes,
  onToggle,
  open,
}: {
  depth: number
  highlight: null | Set<string>
  hoverHighlight: null | Set<string>
  id: string
  nodes: Record<string, ViewNode>
  onToggle: (id: string) => void
  open: Set<string>
}) {
  const n = nodes[id]
  // Auto-expand any node on the path to a matched descendant. Hook
  // must run unconditionally — derive a stable input list even when
  // the node is missing so the early-return below doesn't violate
  // rules-of-hooks. Both the search highlight and the frame-hover
  // highlight should force open the ancestor chain.
  const childrenForExpand: string[] = n?.children ?? []
  const hasMatchedDescendant = useMemo(() => {
    const sources: Array<null | Set<string>> = [highlight, hoverHighlight]
    if (sources.every((s) => !s)) return false
    const stack = [...childrenForExpand]
    while (stack.length > 0) {
      const cid = stack.pop()!
      for (const s of sources) if (s?.has(cid)) return true
      const c = nodes[cid]
      if (c) stack.push(...c.children)
    }
    return false
  }, [highlight, hoverHighlight, childrenForExpand, nodes])
  if (!n) return null
  const hasChildren = n.children.length > 0
  const isOpen = open.has(id)
  const isMatched = highlight?.has(id) ?? false
  const isHovered = hoverHighlight?.has(id) ?? false
  const reallyOpen = isOpen || hasMatchedDescendant

  return (
    <div>
      <button
        className={`hover:bg-bg-tertiary/60 flex w-full items-baseline gap-1 rounded px-1 py-0.5 text-left ${
          isHovered
            ? 'text-fg ring-accent/60 bg-accent/20 ring-1'
            : isMatched
              ? 'text-fg bg-accent/10'
              : 'text-fg-muted'
        }`}
        data-node-id={id}
        onClick={() => hasChildren && onToggle(id)}
        style={{ paddingLeft: depth * 12 }}
        type="button"
      >
        {hasChildren ? (
          <span className="text-fg-muted/60 inline-block w-3">{reallyOpen ? '▾' : '▸'}</span>
        ) : (
          <span className="inline-block w-3" />
        )}
        <span className="text-fg whitespace-nowrap">{n.name}</span>
        <span className="text-fg-muted/70">·</span>
        <span className="text-fg-muted/80 whitespace-nowrap">{n.type}</span>
        {n.props_summary && Object.keys(n.props_summary).length > 0 && (
          <span className="text-fg-muted/60 truncate text-[10px]">{summary(n.props_summary)}</span>
        )}
      </button>
      {reallyOpen &&
        n.children.map((cid) => (
          <TreeNode
            depth={depth + 1}
            highlight={highlight}
            hoverHighlight={hoverHighlight}
            id={cid}
            key={cid}
            nodes={nodes}
            onToggle={onToggle}
            open={open}
          />
        ))}
    </div>
  )
}

function summary(props: Record<string, string>): string {
  // Show 1-2 most-useful props per row to keep lines tight.
  const order = ['accessibilityLabel', 'contentDescription', 'frame', 'alpha', 'hidden']
  const parts: string[] = []
  for (const k of order) {
    const v = props[k]
    if (v) parts.push(`${k}=${v}`)
    if (parts.length >= 2) break
  }
  return parts.join(' · ')
}

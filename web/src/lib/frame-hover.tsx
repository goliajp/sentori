import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

/**
 * Phase 47.02 — shared hover state between stack frames and view-tree
 * nodes inside the issue-detail Stack tab.
 *
 * The two components (FrameRow + ViewTreePanel/TreeNode) live in
 * different branches of the StackTab subtree, and the link between
 * them is purely `(file, line)` — there's no parent / child
 * relationship we can prop-drill through cleanly. A context is the
 * smallest hammer that fits.
 *
 * `hoveredKey` is the canonical "file:line" string of whatever frame
 * the user is currently hovering. ViewTreePanel turns that into a
 * set of node ids whose `file + line` match and renders them with a
 * distinct background. When the user moves off the frame
 * (`onMouseLeave`), the hover clears and the tree returns to its
 * normal render.
 *
 * Wrapping cost is one renamed div per Stack tab. The provider only
 * re-renders consumers when `hoveredKey` actually changes, so we
 * don't churn the (often deep) view-tree DOM on every mousemove
 * inside StackTab.
 */
type FrameHoverState = {
  hoveredKey: null | string
  setHoveredKey: (key: null | string) => void
}

const ctx = createContext<FrameHoverState | null>(null)

export function FrameHoverProvider({ children }: { children: ReactNode }) {
  const [hoveredKey, setHoveredKey] = useState<null | string>(null)
  const value = useMemo(() => ({ hoveredKey, setHoveredKey }), [hoveredKey])
  return <ctx.Provider value={value}>{children}</ctx.Provider>
}

export function useFrameHover(): FrameHoverState {
  // No provider → noop state. Lets components live both inside and
  // outside StackTab without crashing (e.g. ViewTreePanel could be
  // rendered standalone in a future view).
  return useContext(ctx) ?? { hoveredKey: null, setHoveredKey: () => {} }
}

export function frameKey(file: string, line: number): string {
  return `${file}:${line}`
}

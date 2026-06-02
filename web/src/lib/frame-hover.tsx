import { type ReactNode, useMemo, useState } from 'react'

import { FrameHoverContext } from './frame-hover-util'

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
 *
 * The hook (`useFrameHover`) and the `frameKey` util live in
 * [frame-hover-util.ts] so this file stays a pure component module —
 * lets Vite's Fast Refresh treat it as a hot-replaceable component
 * boundary.
 */
export function FrameHoverProvider({ children }: { children: ReactNode }) {
  const [hoveredKey, setHoveredKey] = useState<null | string>(null)
  const value = useMemo(() => ({ hoveredKey, setHoveredKey }), [hoveredKey])
  return <FrameHoverContext.Provider value={value}>{children}</FrameHoverContext.Provider>
}

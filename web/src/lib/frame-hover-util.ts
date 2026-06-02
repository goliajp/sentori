import { createContext, useContext } from 'react'

export type FrameHoverState = {
  hoveredKey: null | string
  setHoveredKey: (key: null | string) => void
}

export const FrameHoverContext = createContext<FrameHoverState | null>(null)

export function useFrameHover(): FrameHoverState {
  // No provider → noop state. Lets components live both inside and
  // outside StackTab without crashing (e.g. ViewTreePanel could be
  // rendered standalone in a future view).
  return useContext(FrameHoverContext) ?? { hoveredKey: null, setHoveredKey: () => {} }
}

export function frameKey(file: string, line: number): string {
  return `${file}:${line}`
}

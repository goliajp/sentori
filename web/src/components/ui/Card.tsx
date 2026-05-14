import { createElement, type ReactNode } from 'react'

/**
 * Phase 49 sub-K — bordered container surface.
 *
 * The base of the visual stack:
 *
 *   - default — `border` + `bg-bg-secondary` + `rounded-md`. Use it
 *     for stats, sub-section grouping, or anything that should read
 *     as "an object" against the page background.
 *   - `interactive` — adds a hover-state border + cursor-pointer; for
 *     full-card click targets (a release row, an issue chip strip).
 *   - `compact` — halves the padding.
 *
 * Keeps the dashboard from accumulating ten different border-radius +
 * background combinations as new sections land.
 */

export function Card({
  as = 'div',
  children,
  className,
  compact,
  interactive,
}: {
  as?: 'a' | 'article' | 'div' | 'li' | 'section'
  children: ReactNode
  className?: string
  compact?: boolean
  interactive?: boolean
}) {
  const base = 'border-border bg-bg-secondary block rounded-md border transition-colors'
  const pad = compact ? 'p-3' : 'p-4'
  const hov = interactive ? 'hover:border-accent/40 hover:bg-bg-tertiary/50 cursor-pointer' : ''
  return createElement(as, { className: `${base} ${pad} ${hov} ${className ?? ''}` }, children)
}

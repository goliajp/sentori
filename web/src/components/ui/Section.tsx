import type { ReactNode } from 'react'

/**
 * Phase 49 sub-A — consistent section wrapper.
 *
 * Pages used to render their own `<h2 className="text-fg-muted text-[11px] tracking-wider uppercase">`
 * + ad-hoc spacing for every grouping, so spacing and label style
 * drifted page to page. This component is the single shape:
 *
 *   - 11px uppercase tracked label on the left
 *   - optional `right`-aligned action area (toggle / chip / count)
 *   - `bordered` lifts the body into a card with a thin border
 *   - `compact` halves the padding for tight grids
 *
 *     <Section title="Stack" right={<RawToggle/>}>{frames}</Section>
 *     <Section title="Context" bordered>{kvs}</Section>
 */

export function Section({
  bordered,
  children,
  compact,
  right,
  title,
}: {
  bordered?: boolean
  children: ReactNode
  compact?: boolean
  right?: ReactNode
  title: string
}) {
  return (
    <section className="space-y-2">
      <header className="flex min-h-5 items-center justify-between gap-3">
        <h2 className="text-fg-muted text-[11px] font-medium tracking-[0.06em] uppercase">
          {title}
        </h2>
        {right && <div className="text-fg-muted flex items-center gap-2 text-[12px]">{right}</div>}
      </header>
      {bordered ? (
        <div
          className={`border-border bg-bg-secondary rounded-md border ${compact ? 'p-2.5' : 'p-3.5'}`}
        >
          {children}
        </div>
      ) : (
        <div className={compact ? 'space-y-2' : 'space-y-3'}>{children}</div>
      )}
    </section>
  )
}

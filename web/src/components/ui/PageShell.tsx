import type { ReactNode } from 'react'

/**
 * Phase 49 sub-E — consistent app-shell containers.
 *
 * The dashboard is an app, not a marketing site: every page should
 * fill the viewport width, share the same header rhythm, and stop
 * each view from inventing its own `mx-auto max-w-Xxl p-6` chord.
 * Three primitives here:
 *
 *   - `<PageShell>` — the outer flex column. Use it as the immediate
 *     child of the route's render. Fills `h-full` of the org layout.
 *   - `<PageHeader>` — fixed 48px sticky header strip with a title
 *     and right-aligned `actions`. Optional `subtitle` flows on the
 *     same row truncated; optional `meta` (chip row / status badge)
 *     wraps to a second row. Tab bars (still rendered by the page)
 *     sit underneath the header inside the shell, not inside the
 *     header itself.
 *   - `<PageBody>` — scrolling content region. Fills available
 *     vertical space, has consistent horizontal `px-6` and vertical
 *     `py-6` padding. Form-heavy views can pass `prose` to clamp
 *     interior text width to a readable column without rolling
 *     their own max-width container.
 *
 * Anything that needs a different inner width (a 320px settings
 * form, a 80ch prose column) clamps that inside `<PageBody>`, not
 * at the shell — the shell itself is always full-width.
 */

export function PageShell({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-w-0 flex-col">{children}</div>
}

export function PageHeader({
  actions,
  meta,
  subtitle,
  title,
}: {
  actions?: ReactNode
  /** Optional second row — chip strip, status banner, etc. */
  meta?: ReactNode
  /** Optional inline subtitle on the same row as the title; truncates. */
  subtitle?: ReactNode
  title: ReactNode
}) {
  return (
    <header className="border-border bg-bg shrink-0 border-b">
      <div className="flex h-12 min-w-0 items-center gap-3 px-6">
        <h1 className="text-fg min-w-0 shrink truncate text-base font-semibold">{title}</h1>
        {subtitle && (
          <div className="text-fg-muted min-w-0 shrink truncate text-[13px]">{subtitle}</div>
        )}
        {actions && <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {meta && <div className="border-border/60 border-t px-6 py-2">{meta}</div>}
    </header>
  )
}

export function PageBody({
  bleed,
  children,
  className,
  prose,
}: {
  /** `bleed` skips the horizontal padding — for table views that
   *  want to butt the table border up against the viewport. */
  bleed?: boolean
  children: ReactNode
  /** Pass-through for unusual cases (e.g. needs `flex-1 overflow-hidden`). */
  className?: string
  /** Clamp interior text width to ~80ch for form / prose pages. */
  prose?: boolean
}) {
  const pad = bleed ? 'py-6' : 'px-6 py-6'
  const width = prose ? 'mx-auto w-full max-w-3xl' : ''
  return (
    <div className={`min-w-0 flex-1 overflow-y-auto ${pad} ${width} ${className ?? ''}`}>
      {children}
    </div>
  )
}

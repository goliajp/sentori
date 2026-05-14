import type { ReactNode } from 'react'

/**
 * Standard page-level header for list / index / detail pages.
 *
 *   • h1 in t-lg + count chip + subtitle
 *   • Optional right-side `actions` slot
 *
 * Layout rules:
 *   1. Pages always use the full available width — no `mx-auto max-w-*`
 *      on page roots.
 *   2. Forms that *create* an entity are modals (URL-tracked), not pages.
 *   3. Auth pages are the one exception — centered narrow card.
 */
export function PageHeader({
  actions,
  count,
  subtitle,
  title,
}: {
  actions?: ReactNode
  count?: number
  subtitle?: ReactNode
  title: ReactNode
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h1 className="text-fg t-lg font-semibold">
        {title}
        {count !== undefined && (
          <span className="text-fg-muted t-md ml-2 font-normal">({count})</span>
        )}
        {subtitle && <span className="text-fg-muted t-md ml-2 font-normal">{subtitle}</span>}
      </h1>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

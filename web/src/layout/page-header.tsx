import type { ReactNode } from 'react'

/**
 * Page-level title strip. No horizontal rules — the page's first data
 * block (a `.bench` thead, a `.rule-grid`, a hero) provides the first
 * visible line and the title floats above it. Hierarchy comes from
 * type scale alone (26px Plex Sans condensed for page · 15px for
 * in-page sections · 10px mono for column labels).
 *
 * No `num` prop. Numbering belongs only between completely sibling,
 * sequential items (steps of a wizard, ordered stack frames). Page
 * titles, sidebar groups, and unrelated sub-sections are not
 * sequences — they don't get numbers.
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
    <header className="page-head">
      <h1 className="page-head-title">{title}</h1>
      {count !== undefined && (
        <span className="page-head-count">{count.toLocaleString()}</span>
      )}
      {subtitle && <span className="page-head-sub">{subtitle}</span>}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  )
}

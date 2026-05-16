import type { ReactNode } from 'react'

/**
 * Editorial page header — tri-part pattern matching the section-head
 * utility but pitched for the page-level title.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │ 02   Issues                          subtitle · last 24h    │  ← top rule
 *   │ ╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴╴ │  ← bottom rule
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The number is opt-in. Pages that have an obvious sequence (Issues →
 * Traces → Vitals → …) supply theirs from `modules/registry`. Pages
 * that don't (Settings, Audit) leave it blank.
 */
export function PageHeader({
  actions,
  count,
  num,
  subtitle,
  title,
}: {
  actions?: ReactNode
  count?: number
  num?: string
  subtitle?: ReactNode
  title: ReactNode
}) {
  return (
    <header className="sec-head">
      {num && <span className="sec-head-num">{num}</span>}
      <h1 className="sec-head-title">
        {title}
        {count !== undefined && (
          <span
            className="tnum ml-3 font-mono text-[12px] tracking-[0.05em] text-[color:var(--ink-muted)]"
            style={{ fontVariationSettings: 'unset' }}
          >
            {count.toLocaleString()}
          </span>
        )}
      </h1>
      {subtitle && (
        <span className="sec-head-sub flex items-center gap-2">
          {typeof subtitle === 'string' ? subtitle : subtitle}
        </span>
      )}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </header>
  )
}

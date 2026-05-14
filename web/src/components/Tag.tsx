import type { ReactNode } from 'react'

/**
 * Unified tag/chip primitive — the ONE way to render an inline pill of
 * any kind across the dashboard. Replaces hand-rolled
 * `<span className="rounded border bg-X px-1.5 py-0.5 …">` patterns so
 * padding, size, and color treatment are guaranteed consistent.
 *
 * Variants are intentionally limited to five so designers can't drift:
 *   default  → neutral chip (short id, release name, generic label)
 *   accent   → selected / "this is the active filter"
 *   success  → ok / healthy / closed
 *   warning  → degraded / silenced
 *   danger   → failing / regressed / fatal
 *
 * Size is fixed (t-sm, 11px). If a tag needs to be bigger it's not a
 * tag anymore — promote it to a heading or stat value.
 *
 * `mono` switches to JetBrains Mono / system mono for IDs and release
 * strings; everything else stays in the sans body font.
 */
export type TagVariant = 'accent' | 'danger' | 'default' | 'success' | 'warning'

const VARIANT_CLS: Record<TagVariant, string> = {
  accent: 'bg-accent/10 text-accent border-accent/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
  default: 'bg-bg-tertiary text-fg-muted border-border',
  success: 'bg-success/10 text-success border-success/30',
  warning: 'bg-warning/10 text-warning border-warning/30',
}

export function Tag({
  children,
  className = '',
  mono = false,
  variant = 'default',
}: {
  children: ReactNode
  className?: string
  mono?: boolean
  variant?: TagVariant
}) {
  return (
    <span
      className={`t-sm inline-flex items-center gap-1 rounded border px-1.5 py-0.5 ${
        mono ? 'font-mono' : ''
      } ${VARIANT_CLS[variant]} ${className}`}
    >
      {children}
    </span>
  )
}

import type { ReactNode } from 'react'

/**
 * Unified tag/chip primitive — the ONE way to render an inline pill of
 * any kind across the dashboard. Replaces hand-rolled
 * `<span className="rounded border bg-X px-1.5 py-0.5 …">` patterns so
 * padding, size, and colour treatment are guaranteed consistent.
 *
 * Variants are intentionally limited to five so callers can't drift:
 *   default  → neutral chip (short id, release name, generic label)
 *   accent   → selected / "this is the active filter"
 *   success  → ok / healthy / closed
 *   warning  → degraded / silenced
 *   danger   → failing / regressed / fatal
 *
 * Each variant maps to a designed (bg / text / border) triple from the
 * semantic palette in index.css — NOT alpha-on-accent. Alpha
 * composites washed out on the warm paper background; the dedicated
 * `--info-bg / --success-bg / …` tokens give intentional contrast in
 * both light and dark modes.
 *
 * `mono` switches to Roboto Mono for IDs / release strings; everything
 * else stays in the sans body font.
 */
export type TagVariant = 'accent' | 'danger' | 'default' | 'success' | 'warning'

const VARIANT_CLS: Record<TagVariant, string> = {
  accent: 'bg-accent/10 text-accent border-accent',
  danger: 'bg-danger/15 text-danger border-danger/30',
  default: 'bg-bg-secondary text-fg-secondary border-border',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
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
      className={`inline-flex items-center gap-1 border px-1.5 py-px text-[11px] leading-[1.4] tracking-[0.02em] ${
        mono ? 'font-mono' : ''
      } ${VARIANT_CLS[variant]} ${className}`}
    >
      {children}
    </span>
  )
}

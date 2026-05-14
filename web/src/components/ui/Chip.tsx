import type { ReactNode } from 'react'

/**
 * Phase 49 sub-A — small inline label.
 *
 * Replaces the scattered `<span className="text-fg-muted bg-bg-tertiary rounded px-1 py-[1px] text-[10px] uppercase">`
 * stand-alone spans across the dashboard. Three weights:
 *
 *   - `neutral` — default `bg-bg-tertiary text-fg-muted`
 *   - `accent`  — `bg-accent/10 text-accent`, used on the active state
 *   - `outline` — transparent bg, just border + muted text
 *
 * `tone` adds a semantic color (success / warning / danger / info).
 * When provided it overrides the variant background — chips that
 * communicate state should always pick a tone.
 */

type Variant = 'accent' | 'neutral' | 'outline'
type Tone = 'danger' | 'info' | 'success' | 'warning'

const variantClass: Record<Variant, string> = {
  accent: 'bg-accent/10 text-accent',
  neutral: 'bg-bg-tertiary text-fg-muted',
  outline: 'border-border text-fg-muted border bg-transparent',
}

const toneClass: Record<Tone, string> = {
  danger:
    'bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)] border-[color:var(--color-danger-border)] border',
  info: 'bg-[color:var(--color-info-bg)] text-[color:var(--color-info)] border-[color:var(--color-info-border)] border',
  success:
    'bg-[color:var(--color-success-bg)] text-[color:var(--color-success)] border-[color:var(--color-success-border)] border',
  warning:
    'bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)] border-[color:var(--color-warning-border)] border',
}

export function Chip({
  children,
  tone,
  uppercase = true,
  variant = 'neutral',
}: {
  children: ReactNode
  tone?: Tone
  uppercase?: boolean
  variant?: Variant
}) {
  const cls = tone ? toneClass[tone] : variantClass[variant]
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-[2px] text-[10px] font-medium tracking-wide ${uppercase ? 'uppercase' : ''} ${cls}`}
    >
      {children}
    </span>
  )
}

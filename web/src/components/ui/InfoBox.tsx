import type { ReactNode } from 'react'

/**
 * Phase 49 sub-A — inline status callout.
 *
 * Replaces the scattered ad-hoc `<p className="text-fg-muted text-[12px]">…</p>`
 * "no data / hint / warning" lines that read as bare paragraphs and
 * make the dashboard feel unfinished. An InfoBox carries a border +
 * a left-tinted background per variant, so the user immediately reads
 * it as a callout rather than a fragment of body copy.
 *
 *     <InfoBox variant="info">No attachments captured for this event.</InfoBox>
 *     <InfoBox variant="warning" title="Dev build">
 *       Source maps are only uploaded for production releases.
 *     </InfoBox>
 *
 * Variants map to the semantic color tokens added in the same sub:
 *   - `info`    — blue, neutral hint / "this is how it works"
 *   - `success` — green, opt-in feature is on / something just shipped
 *   - `warning` — amber, "you might want to do X" / non-blocking
 *   - `danger`  — red, real failure / blocking issue
 */

type Variant = 'danger' | 'info' | 'success' | 'warning'

const variantClass: Record<Variant, string> = {
  // Hard-coded class strings (no template interpolation) so Tailwind's
  // JIT compiler can statically extract them.
  danger:
    'border-[color:var(--color-danger-border)] bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)]',
  info: 'border-[color:var(--color-info-border)] bg-[color:var(--color-info-bg)] text-[color:var(--color-info)]',
  success:
    'border-[color:var(--color-success-border)] bg-[color:var(--color-success-bg)] text-[color:var(--color-success)]',
  warning:
    'border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)]',
}

const iconFor: Record<Variant, string> = {
  danger: '⊗',
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
}

export function InfoBox({
  children,
  title,
  variant = 'info',
}: {
  children: ReactNode
  title?: string
  variant?: Variant
}) {
  return (
    <div
      className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[12px] leading-relaxed ${variantClass[variant]}`}
      role={variant === 'danger' ? 'alert' : 'status'}
    >
      <span aria-hidden className="mt-[1px] shrink-0 font-mono text-[13px] leading-none">
        {iconFor[variant]}
      </span>
      <div className="min-w-0">
        {title && <div className="text-fg mb-0.5 font-medium">{title}</div>}
        <div className="text-fg-secondary">{children}</div>
      </div>
    </div>
  )
}

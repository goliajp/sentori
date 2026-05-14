import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

/**
 * Phase 49 sub-K — single button primitive across the dashboard.
 *
 * Variants, in the spirit of Linear / Vercel / Stripe dashboards:
 *
 *   - `primary`    — accent fill, white-on-accent text. One per
 *                    screen, max — reserved for the affirmative
 *                    action ("Save", "+ New rule", "Resolve").
 *   - `secondary`  — border + neutral bg, for "Cancel" / "Filter"
 *                    style actions.
 *   - `ghost`      — no border / no fill, just hover bg. Most
 *                    common shape in lists and headers.
 *   - `danger`     — danger-token border + text. Destructive
 *                    affordances ("Revoke", "Delete").
 *
 * Sizes use a tight 3-step scale tuned to the 13px body type:
 *
 *   - `sm` — h-7 px-2.5 text-[11px] (table-row inline actions)
 *   - `md` — h-8 px-3 text-[12px]   (default — headers, forms)
 *   - `lg` — h-9 px-4 text-[13px]   (page-level primary CTAs)
 */

type Variant = 'danger' | 'ghost' | 'primary' | 'secondary'
type Size = 'lg' | 'md' | 'sm'

const variantClass: Record<Variant, string> = {
  danger:
    'border border-[color:var(--color-danger-border)] bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)] hover:bg-[color:var(--color-danger-bg)]/80',
  ghost: 'text-fg-muted hover:bg-bg-tertiary hover:text-fg',
  primary: 'bg-accent text-bg hover:opacity-90',
  secondary: 'border border-border text-fg-muted hover:bg-bg-tertiary hover:text-fg',
}

const sizeClass: Record<Size, string> = {
  lg: 'h-9 px-4 text-[13px]',
  md: 'h-8 px-3 text-[12px]',
  sm: 'h-7 px-2.5 text-[11px]',
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  block?: boolean
  /** Disable + show a "…" spinner-ish placeholder text instead of the kids. */
  loading?: boolean
  loadingLabel?: string
  prefix?: ReactNode
  size?: Size
  suffix?: ReactNode
  variant?: Variant
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    block,
    children,
    className,
    disabled,
    loading,
    loadingLabel = 'Working…',
    prefix,
    size = 'md',
    suffix,
    type = 'button',
    variant = 'secondary',
    ...rest
  },
  ref
) {
  return (
    <button
      className={`focus-visible:ring-accent inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 ${
        block ? 'w-full' : ''
      } ${variantClass[variant]} ${sizeClass[size]} ${className ?? ''}`}
      disabled={disabled || loading}
      ref={ref}
      type={type}
      {...rest}
    >
      {prefix && <span className="shrink-0">{prefix}</span>}
      <span className="min-w-0 truncate">{loading ? loadingLabel : children}</span>
      {suffix && <span className="shrink-0">{suffix}</span>}
    </button>
  )
})

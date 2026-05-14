import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'

/**
 * Phase 49 sub-K — single input primitive across the dashboard.
 *
 * Two sizes (matching `Button`):
 *   - `sm` — h-7
 *   - `md` — h-8 (default)
 *
 * `prefix` / `suffix` slots render decorations inside the same border
 * — the canonical Linear shape (icon-then-input, no double-border
 * jankiness). Pass an icon glyph or text. Use a `<Chip>` for
 * inline-unit suffixes (e.g. "ms", "MB").
 *
 * The focus ring is the same accent colour the buttons use, so every
 * interactive surface in the dashboard agrees on what "focus" looks
 * like.
 */

type Size = 'md' | 'sm'

const heightClass: Record<Size, string> = {
  md: 'h-8 text-[12px]',
  sm: 'h-7 text-[11px]',
}

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix' | 'size'> & {
  block?: boolean
  prefix?: ReactNode
  size?: Size
  suffix?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { block, className, prefix, size = 'md', suffix, ...rest },
  ref
) {
  return (
    <div
      className={`focus-within:ring-accent border-border bg-bg-tertiary inline-flex items-center gap-1.5 rounded-md border px-2 focus-within:ring-1 ${
        block ? 'w-full' : ''
      } ${heightClass[size]}`}
    >
      {prefix && <span className="text-fg-muted shrink-0">{prefix}</span>}
      <input
        className={`text-fg placeholder:text-fg-muted/70 min-w-0 flex-1 bg-transparent focus:outline-none ${className ?? ''}`}
        ref={ref}
        {...rest}
      />
      {suffix && <span className="text-fg-muted shrink-0">{suffix}</span>}
    </div>
  )
})

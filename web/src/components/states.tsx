import type { ReactNode } from 'react'

/**
 * Phase 28 sub-E + Phase 49 sub-C — shared empty / loading / error
 * states. One visual shape across the dashboard so adding a new
 * list-shaped view never reinvents this layer.
 *
 *  - `<LoadingState>`  — single muted line, low-noise. Used in-place
 *                        while data settles.
 *  - `<EmptyState>`    — centered card with an icon mark, large
 *                        title, supporting hint, optional CTA. The
 *                        face the user sees on a fresh project.
 *  - `<ErrorState>`    — danger-tinted box with a retry escape.
 *
 * Phase 49 sub-C bumped `EmptyState` from a flat paragraph to a
 * centered icon-led card so a brand-new project doesn't feel like a
 * dead page — and `ErrorState` from a single red line to a labelled
 * danger box that lines up with the new `<InfoBox>` family.
 */

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="text-fg-muted px-6 py-6 text-sm" role="status">
      {label}
    </div>
  )
}

export function ErrorState({
  detail,
  label = 'Something went wrong.',
  onRetry,
}: {
  detail?: string
  label?: string
  onRetry?: () => void
}) {
  return (
    <div className="px-6 py-6" role="alert">
      <div className="mx-auto max-w-md rounded-md border border-[color:var(--color-danger-border)] bg-[color:var(--color-danger-bg)] px-4 py-3 text-center">
        <div className="text-[13px] font-medium text-[color:var(--color-danger)]">{label}</div>
        {detail && <p className="text-fg-muted mt-1 text-[12px]">{detail}</p>}
        {onRetry && (
          <button
            className="text-fg-muted hover:text-fg mt-3 text-[12px] underline underline-offset-2"
            onClick={onRetry}
            type="button"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

export function EmptyState({
  cta,
  hint,
  icon = '∅',
  title,
}: {
  cta?: ReactNode
  hint?: ReactNode
  /** Single-glyph mark; defaults to the empty-set symbol. Keep
   *  monospace-friendly. */
  icon?: ReactNode
  title: string
}) {
  return (
    <div className="px-6 py-16" role="status">
      <div className="mx-auto flex max-w-md flex-col items-center text-center">
        <div
          aria-hidden
          className="border-border bg-bg-tertiary text-fg-muted flex h-10 w-10 items-center justify-center rounded-full border text-[18px]"
        >
          {icon}
        </div>
        <div className="text-fg mt-4 text-[14px] font-medium">{title}</div>
        {hint && (
          <div className="text-fg-muted mt-1.5 max-w-[28rem] text-[12px] leading-relaxed">
            {hint}
          </div>
        )}
        {cta && <div className="mt-4">{cta}</div>}
      </div>
    </div>
  )
}

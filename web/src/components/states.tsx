/**
 * Phase 28 sub-E: shared empty / loading / error states.
 *
 * Every list-shaped view used to render its own one-off `<div>Loading…</div>`
 * /  `<p>Failed to load.</p>` / inline empty hint. They drifted in
 * spelling, padding, and colour. These three components are the
 * single source of truth — views replace their inline blobs with a
 * `<LoadingState/>` / `<ErrorState/>` / `<EmptyState/>` and pick up
 * any future polish for free.
 */

import type { ReactNode } from 'react'

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
    <div className="px-6 py-6 text-sm" role="alert">
      <p className="text-red-400">{label}</p>
      {detail && <p className="text-fg-muted mt-1 text-[12px]">{detail}</p>}
      {onRetry && (
        <button
          className="text-fg-muted hover:text-fg mt-3 text-[12px] underline"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      )}
    </div>
  )
}

export function EmptyState({
  cta,
  hint,
  title,
}: {
  cta?: ReactNode
  hint?: ReactNode
  title: string
}) {
  return (
    <div className="text-fg-muted px-6 py-10 text-sm" role="status">
      <div className="text-fg text-[14px] font-medium">{title}</div>
      {hint && <div className="text-fg-muted mt-1 text-[12px]">{hint}</div>}
      {cta && <div className="mt-3">{cta}</div>}
    </div>
  )
}

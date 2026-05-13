/**
 * Phase 42 sub-A.14 — loading skeleton for the issue-detail page.
 *
 * Mirrors the real layout (header bar, tab bar, stack section, etc.)
 * with shimmering placeholder blocks so users perceive progress
 * before the first network round-trip resolves. Used in place of
 * the generic `<LoadingState />` text on issue detail; we keep
 * `<LoadingState />` for short-lived spinners elsewhere.
 *
 * No animations beyond the standard Tailwind `animate-pulse`. CSS
 * animations stop on `prefers-reduced-motion: reduce` automatically
 * via the Tailwind default config.
 */

function Bar({ className = '' }: { className?: string }) {
  return <div className={`bg-fg-muted/15 animate-pulse rounded ${className}`} />
}

export function IssueDetailSkeleton() {
  return (
    <div className="flex h-full flex-col">
      {/* Header row */}
      <header className="border-border flex h-12 shrink-0 items-center gap-3 border-b px-6">
        <Bar className="h-4 w-12" />
        <Bar className="h-5 w-48" />
        <Bar className="h-5 w-72" />
        <div className="ml-auto flex items-center gap-2">
          <Bar className="h-7 w-28" />
          <Bar className="h-7 w-20" />
          <Bar className="h-7 w-20" />
        </div>
      </header>

      {/* Tab bar */}
      <div className="border-border flex h-9 shrink-0 items-center gap-1 border-b px-4">
        <Bar className="h-5 w-16" />
        <Bar className="h-5 w-16" />
        <Bar className="h-5 w-24" />
        <Bar className="h-5 w-12" />
        <Bar className="h-5 w-20" />
      </div>

      {/* Stack section */}
      <section className="flex-1 overflow-y-auto px-6 py-4">
        <div className="space-y-3">
          <Bar className="h-3 w-24" />
          <div className="border-border space-y-2 rounded-md border p-4">
            <Bar className="h-4 w-3/4" />
            <Bar className="h-3 w-1/2" />
            <Bar className="h-3 w-2/3" />
            <Bar className="h-3 w-1/3" />
          </div>
          <Bar className="h-3 w-32" />
          <div className="border-border space-y-2 rounded-md border p-4">
            <Bar className="h-4 w-2/3" />
            <Bar className="h-3 w-1/2" />
            <Bar className="h-3 w-1/4" />
          </div>
        </div>
      </section>
    </div>
  )
}

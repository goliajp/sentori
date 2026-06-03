/**
 * v2.1 — shared skeleton placeholder primitives.
 *
 * Replaces "Loading…" text hints with shimmer rectangles so the
 * dashboard reads as "rendering" instead of "stuck". The shimmer
 * itself is the existing `.sentori-skeleton` class in `index.css`
 * (Phase 47 polish); these components are just sized wrappers that
 * fit the common table / rail layouts.
 *
 * Picking the right primitive:
 *
 *   <RowSkeleton />            single-row in a list / rail
 *   <RowSkeleton count={8} />  N rows at once (a typical empty list)
 *   <CardSkeleton />           grid card / KPI cell
 *   <Skeleton />               raw block — pick your own size via className
 */

type SkeletonProps = {
  className?: string
}

export function Skeleton({ className }: SkeletonProps) {
  return <div className={`sentori-skeleton ${className ?? ''}`} aria-hidden />
}

export function RowSkeleton({ count = 1, height = '52px' }: { count?: number; height?: string }) {
  return (
    <div aria-busy="true" role="status">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sentori-skeleton border-border-muted border-b" style={{ height }} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}

export function CardSkeleton({ count = 1, height = '120px' }: { count?: number; height?: string }) {
  return (
    <div className="grid gap-3" aria-busy="true" role="status">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sentori-skeleton border-border border" style={{ height }} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}

export function InlineSkeleton({ width = '6em' }: { width?: string }) {
  return (
    <span
      className="sentori-skeleton inline-block align-middle"
      style={{ width, height: '0.9em' }}
      aria-hidden
    />
  )
}

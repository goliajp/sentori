/**
 * Sentori-specific skeleton layout variants.
 *
 * GDS provides the primitive `<Skeleton variant="rect" width={…} />` for
 * single-block shimmer. Use that for arbitrary-shaped placeholders.
 *
 * This file owns the multi-row list-shaped variant that recurs in
 * sentori dashboards — N stacked rows divided by hairline borders,
 * the standard "table is loading" placeholder. The shimmer itself is
 * the `.sentori-skeleton` class in `index.css` (Phase 47 polish).
 */

export function RowSkeleton({ count = 1, height = '52px' }: { count?: number; height?: string }) {
  return (
    <div aria-busy="true" role="status">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="sentori-skeleton border-border/40 border-b" style={{ height }} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  )
}

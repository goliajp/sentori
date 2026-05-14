/**
 * Phase 50 sub-B1 — shimmer-animated placeholder block.
 *
 * Drop in anywhere a loading row / card / chip should live so the
 * UI keeps the same shape while data is in-flight. Pulses are CSS
 * keyframes (no JS rAF), 1.4s ease-in-out — slow enough to read as
 * "still loading", fast enough to not look stuck.
 *
 *     <Skeleton h={20} w="60%" />
 *     <Skeleton className="rounded-full" h={40} w={40} />
 *
 * `h`/`w` accept px-number or any valid CSS length string. The
 * background is two stops between `bg-tertiary` and `bg-secondary`,
 * so the shimmer reads in both light + dark themes.
 */

export function Skeleton({
  className,
  h = 16,
  rounded = 'md',
  w = '100%',
}: {
  className?: string
  h?: number | string
  rounded?: 'full' | 'lg' | 'md' | 'none' | 'sm'
  w?: number | string
}) {
  const radius = `rounded-${rounded === 'none' ? 'none' : rounded}`
  return (
    <div
      aria-hidden
      className={`sentori-skeleton ${radius} ${className ?? ''}`}
      style={{
        height: typeof h === 'number' ? `${h}px` : h,
        width: typeof w === 'number' ? `${w}px` : w,
      }}
    />
  )
}

export function SkeletonRow({ cells = 4 }: { cells?: number }) {
  return (
    <div className="flex items-center gap-3 py-2">
      {Array.from({ length: cells }).map((_, i) => (
        <Skeleton h={14} key={i} w={`${100 / cells}%`} />
      ))}
    </div>
  )
}

export function SkeletonStat() {
  return (
    <div className="space-y-2">
      <Skeleton h={11} w={80} />
      <Skeleton h={26} w={120} />
      <Skeleton h={11} w={140} />
    </div>
  )
}

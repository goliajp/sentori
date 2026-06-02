/**
 * Lower-level section container — title + optional sub + body.
 * Pulled out of 4 duplicate definitions (vitals / privacy / settings /
 * cert-monitor) on 2026-05-23.
 *
 * Layout:
 *   <header class="sec-head">
 *     <span class="sec-head-title">{title}</span>
 *     <span class="sec-head-sub">{sub}</span>   ← optional
 *   </header>
 *   <div>{children}</div>
 *
 * Default top margin `mt-2` matches the original vitals / privacy
 * usage where SubSection follows another SubSection. Pass
 * `className=""` (or any other) when the caller wants the section
 * flush with whatever sits above (settings stacks them differently).
 *
 * `id` is honored as the section's HTML id — used by settings'
 * hash-deep-link scroll into a specific section.
 */
export function SubSection({
  children,
  className = 'mt-2',
  id,
  sub,
  title,
}: {
  children: React.ReactNode
  className?: string
  id?: string
  sub?: string
  title: string
}) {
  return (
    <section className={className} id={id}>
      <header className="sec-head">
        <span className="sec-head-title">{title}</span>
        {sub != null && <span className="sec-head-sub">{sub}</span>}
      </header>
      <div>{children}</div>
    </section>
  )
}

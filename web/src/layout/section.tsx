import type { ReactNode } from 'react'

export function Section({
  children,
  count,
  title,
}: {
  children: ReactNode
  count?: number | string
  title: string
}) {
  return (
    <section>
      <div className="text-fg-muted t-sm mb-2 font-semibold tracking-wider uppercase">
        {title}
        {count != null && <span className="ml-2 font-normal">{count}</span>}
      </div>
      {children}
    </section>
  )
}

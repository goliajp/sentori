import { useLocation } from 'react-router'

import { PageHeader } from '@/layout/page-header'

/** Placeholder for modules that haven't been re-implemented in v2 yet. */
export function StubView() {
  const { pathname } = useLocation()
  const last = pathname.replace(/\/$/, '').split('/').pop() ?? 'view'
  const title = last.charAt(0).toUpperCase() + last.slice(1)
  return (
    <div className="space-y-3">
      <PageHeader subtitle="Not yet implemented in v2" title={title} />
      <div className="border-border bg-bg-secondary/30 rounded-md border px-4 py-12 text-center">
        <div className="text-fg-muted t-sm mb-1 font-semibold tracking-wider uppercase">
          Coming soon
        </div>
        <div className="text-fg t-md">
          <span className="text-accent font-mono">{title}</span> is wired into the router but the
          view body lands in a follow-up commit.
        </div>
      </div>
    </div>
  )
}

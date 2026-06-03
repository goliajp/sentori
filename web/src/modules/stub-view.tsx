import { useLocation } from 'react-router'

import { PageHeader } from '@/layout/page-header'

/** Placeholder for modules that haven't been re-implemented in v2 yet. */
export function StubView() {
  const { pathname } = useLocation()
  const last = pathname.replace(/\/$/, '').split('/').pop() ?? 'view'
  const title = last.charAt(0).toUpperCase() + last.slice(1)
  return (
    <div className="sentori-page-in">
      <PageHeader subtitle="not yet implemented" title={title} />
      <div className="border-border border-y px-4 py-10 text-center">
        <div className="text-accent mb-1.5 font-mono text-[10px] tracking-[0.22em] uppercase">
          Coming soon
        </div>
        <div className="text-fg-secondary text-[13px]">
          <span className="text-fg font-mono">{title}</span> is wired into the router but the view
          body lands in a follow-up.
        </div>
      </div>
    </div>
  )
}

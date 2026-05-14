import { useQuery } from '@tanstack/react-query'

import { orgsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'

export function SettingsView() {
  const { currentOrg } = useOrg()
  const membersQ = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => orgsApi.listMembers(currentOrg.slug),
    queryKey: ['members', currentOrg.slug],
  })

  const members = membersQ.data ?? []

  return (
    <div className="space-y-3">
      <PageHeader subtitle="Org-level configuration" title="Settings" />

      <Pane title="Organization">
        <Row label="slug">
          <span className="text-fg font-mono">{currentOrg.slug}</span>
        </Row>
        <Row label="name">
          <span className="text-fg">{currentOrg.name}</span>
        </Row>
        <Row label="your role">
          <span className="text-accent font-medium">{currentOrg.role}</span>
        </Row>
      </Pane>

      <Pane title={`Members (${members.length})`}>
        {membersQ.isLoading ? (
          <div className="text-fg-muted t-md">Loading…</div>
        ) : members.length === 0 ? (
          <div className="text-fg-muted t-md">No members.</div>
        ) : (
          <div className="space-y-1">
            {members.map((m) => (
              <div className="t-md flex items-center justify-between" key={m.userId}>
                <span className="text-fg">{m.email}</span>
                <span className="text-fg-muted">{m.role}</span>
              </div>
            ))}
          </div>
        )}
      </Pane>
    </div>
  )
}

function Pane({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="border-border bg-bg-secondary/30 overflow-hidden rounded-md border">
      <header className="border-border border-b px-3 py-2">
        <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">{title}</span>
      </header>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  )
}

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="t-md mb-1.5 flex items-baseline justify-between gap-3 last:mb-0">
      <span className="text-fg-muted t-sm tracking-wide">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  )
}

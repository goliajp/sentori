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
    <div className="sentori-page-in">
      <PageHeader subtitle="org configuration" title="Settings" />

      <SubSection title="Organization">
        <Row label="slug">
          <span className="font-mono">{currentOrg.slug}</span>
        </Row>
        <Row label="name">{currentOrg.name}</Row>
        <Row label="your role">
          <span className="font-mono text-[color:var(--accent)]">{currentOrg.role}</span>
        </Row>
      </SubSection>

      <SubSection sub={`${members.length} total`} title="Members">
        {membersQ.isLoading && (
          <p className="border-y border-[color:var(--rule)] py-4 text-[13px] text-[color:var(--ink-soft)]">
            Loading…
          </p>
        )}
        {!membersQ.isLoading && members.length === 0 && (
          <p className="border-y border-[color:var(--rule)] py-4 text-[13px] text-[color:var(--ink-soft)]">
            No members.
          </p>
        )}
        {members.length > 0 && (
          <ul>
            {members.map((m, i) => (
              <li
                className={`flex items-baseline justify-between gap-3 border-b border-[color:var(--rule-soft)] py-2 ${
                  i === 0 ? 'border-t border-[color:var(--rule)]' : ''
                }`}
                key={m.userId}
              >
                <span className="text-[13px] text-[color:var(--ink)]">{m.email}</span>
                <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SubSection>
    </div>
  )
}

function SubSection({
  children,
  sub,
  title,
}: {
  children: React.ReactNode
  sub?: string
  title: string
}) {
  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">{title}</span>
        {sub && <span className="sec-head-sub">{sub}</span>}
      </header>
      <div>{children}</div>
    </section>
  )
}

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--rule-soft)] py-2 first:border-t first:border-[color:var(--rule)]">
      <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-[13px] text-[color:var(--ink)]">
        {children}
      </span>
    </div>
  )
}

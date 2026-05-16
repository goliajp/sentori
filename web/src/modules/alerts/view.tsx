import { useQuery } from '@tanstack/react-query'

import { orgsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'

export function AlertsView() {
  const { currentOrg } = useOrg()
  const { data, error, isLoading } = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => orgsApi.listAlertRules(currentOrg.slug),
    queryKey: ['alert-rules', currentOrg.slug],
  })

  const rules = data ?? []

  return (
    <div className="sentori-page-in">
      <PageHeader
        count={rules.length}
        subtitle="new issue · regression · threshold"
        title="Alert rules"
      />

      {isLoading && <Hint>Loading…</Hint>}
      {error && <Hint>Failed to load alert rules.</Hint>}
      {!isLoading && !error && rules.length === 0 && (
        <Hint>No rules yet — create one in org settings.</Hint>
      )}

      {rules.length > 0 && (
        <table className="bench">
          <thead>
            <tr>
              <th>name</th>
              <th>trigger</th>
              <th>status</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="lead">{r.name}</td>
                <td>{r.triggerKind}</td>
                <td
                  className={
                    r.enabled ? 'text-[color:var(--success)]' : 'text-[color:var(--ink-muted)]'
                  }
                >
                  {r.enabled ? 'enabled' : 'disabled'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-y border-[color:var(--rule)] py-6 text-center text-[13px] text-[color:var(--ink-soft)]">
      {children}
    </p>
  )
}

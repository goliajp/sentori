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
    <div className="space-y-3">
      <PageHeader
        count={rules.length}
        subtitle="Notify when issues land, regressions appear, or thresholds break"
        title="Alert rules"
      />

      {isLoading && <Empty hint="Loading…" title="Alerts" />}
      {error && <Empty hint="Failed to load alert rules." title="Error" />}
      {!isLoading && !error && rules.length === 0 && (
        <Empty hint="No rules yet. Create one in this org's settings." title="No rules" />
      )}

      {rules.length > 0 && (
        <div className="std-table border-border overflow-hidden rounded-md border">
          <table>
            <thead>
              <tr className="text-fg-muted t-sm tracking-wider uppercase">
                <th className="text-left font-medium">Name</th>
                <th className="w-32 text-left font-medium">Trigger</th>
                <th className="w-24 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr className="hover:bg-bg-tertiary/40" key={r.id}>
                  <td className="text-fg t-md">{r.name}</td>
                  <td className="text-fg-muted t-md font-mono">{r.triggerKind}</td>
                  <td>
                    <span
                      className={`t-md ${r.enabled ? 'text-success font-medium' : 'text-fg-muted'}`}
                    >
                      {r.enabled ? 'enabled' : 'disabled'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Empty({ hint, title }: { hint: string; title: string }) {
  return (
    <div className="border-border bg-bg-secondary/30 rounded-md border px-6 py-12 text-center">
      <div className="text-fg-muted t-sm mb-1 font-semibold tracking-wider uppercase">{title}</div>
      <div className="text-fg t-md">{hint}</div>
    </div>
  )
}

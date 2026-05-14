import { useQuery } from '@tanstack/react-query'

import { auditApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'

export function AuditLogView() {
  const { currentOrg } = useOrg()
  const { data, error, isLoading } = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => auditApi.list(currentOrg.slug, { limit: 100 }),
    queryKey: ['audit', currentOrg.slug],
  })

  const rows = data ?? []

  return (
    <div className="space-y-3">
      <PageHeader
        count={rows.length}
        subtitle="Append-only log of every mutating action"
        title="Audit log"
      />

      {isLoading && <Empty hint="Loading…" title="Audit" />}
      {error && <Empty hint="Failed to load audit log." title="Error" />}
      {!isLoading && !error && rows.length === 0 && <Empty hint="No entries yet." title="Empty" />}

      {rows.length > 0 && (
        <div className="std-table border-border overflow-hidden rounded-md border">
          <table>
            <thead>
              <tr className="text-fg-muted t-sm tracking-wider uppercase">
                <th className="w-24 text-left font-medium">When</th>
                <th className="w-40 text-left font-medium">Actor</th>
                <th className="w-48 text-left font-medium">Action</th>
                <th className="text-left font-medium">Target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr className="hover:bg-bg-tertiary/40" key={e.id}>
                  <td className="text-fg-muted t-md tabular-nums">{formatRelative(e.createdAt)}</td>
                  <td className="text-accent t-md">{e.actorEmail ?? 'system'}</td>
                  <td className="text-fg t-md font-mono">{e.action}</td>
                  <td className="text-fg-muted t-md font-mono">
                    {e.targetType}:{e.targetId ?? '—'}
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

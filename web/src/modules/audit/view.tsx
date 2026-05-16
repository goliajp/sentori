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
    <div className="sentori-page-in">
      <PageHeader
        count={rows.length}
        subtitle="append-only · every mutating action"
        title="Audit"
      />

      {isLoading && <Hint>Loading…</Hint>}
      {error && <Hint>Failed to load audit log.</Hint>}
      {!isLoading && !error && rows.length === 0 && <Hint>No entries yet.</Hint>}

      {rows.length > 0 && (
        <table className="bench">
          <thead>
            <tr>
              <th>when</th>
              <th>actor</th>
              <th>action</th>
              <th>target</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id}>
                <td className="num">{formatRelative(e.createdAt)}</td>
                <td className="text-[color:var(--accent)]">{e.actorEmail ?? 'system'}</td>
                <td className="lead">{e.action}</td>
                <td className="text-[color:var(--ink-soft)]">
                  {e.targetType}:{e.targetId ?? '—'}
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

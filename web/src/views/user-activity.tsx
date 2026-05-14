import { useQuery } from '@tanstack/react-query'

import { userActivityApi } from '@/api/client'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'

export function UserActivityView() {
  const { data, error, isLoading } = useQuery({
    queryFn: () => userActivityApi.list({ limit: 100 }),
    queryKey: ['user-activity'],
  })
  const rows = data ?? []

  return (
    <div className="space-y-3">
      <PageHeader
        count={rows.length}
        subtitle="Recent actions you took across all orgs"
        title="Activity"
      />
      {isLoading && <Empty hint="Loading…" title="Activity" />}
      {error && <Empty hint="Failed to load." title="Error" />}
      {!isLoading && !error && rows.length === 0 && <Empty hint="Nothing yet." title="Empty" />}
      {rows.length > 0 && (
        <div className="std-table border-border overflow-hidden rounded-md border">
          <table>
            <thead>
              <tr className="text-fg-muted t-sm tracking-wider uppercase">
                <th className="w-24 text-left font-medium">When</th>
                <th className="w-40 text-left font-medium">Org</th>
                <th className="text-left font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr className="hover:bg-bg-tertiary/40" key={r.id}>
                  <td className="text-fg-muted t-md tabular-nums">{formatRelative(r.createdAt)}</td>
                  <td className="text-fg-muted t-md font-mono">{r.orgSlug ?? '—'}</td>
                  <td className="text-fg t-md font-mono">{r.action}</td>
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

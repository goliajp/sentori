import { useQuery } from '@tanstack/react-query'

import { adminApi } from '@/api/client'
import { PageHeader } from '@/layout/page-header'

export function IntegrationsView() {
  const { data, error, isLoading } = useQuery({
    queryFn: adminApi.listIntegrations,
    queryKey: ['integrations'],
  })

  const items = data ?? []

  return (
    <div className="space-y-3">
      <PageHeader
        count={items.length}
        subtitle="External destinations: Slack, webhook, archive…"
        title="Integrations"
      />

      {isLoading && <Empty hint="Loading…" title="Integrations" />}
      {error && <Empty hint="Failed to load." title="Error" />}
      {!isLoading && !error && items.length === 0 && <Empty hint="None connected." title="Empty" />}

      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((it) => (
            <div className="border-border bg-bg-secondary/30 rounded-md border p-3" key={it.id}>
              <div className="t-md text-fg font-semibold">{it.kind}</div>
              <div className="text-fg-muted t-sm mt-1 font-mono">
                {Object.entries(it.display)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(' · ') || '—'}
              </div>
              <div className="text-success t-md mt-2">connected</div>
            </div>
          ))}
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

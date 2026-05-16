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
    <div className="sentori-page-in">
      <PageHeader count={items.length} subtitle="Slack · webhook · archive" title="Integrations" />

      {isLoading && <Hint>Loading…</Hint>}
      {error && <Hint>Failed to load integrations.</Hint>}
      {!isLoading && !error && items.length === 0 && <Hint>None connected yet.</Hint>}

      {items.length > 0 && (
        <ul>
          {items.map((it) => (
            <li
              className="border-b border-[color:var(--rule-soft)] py-3 first:border-t first:border-[color:var(--rule)]"
              key={it.id}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className="text-[color:var(--ink)]"
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontVariationSettings: "'wdth' 86, 'opsz' 24, 'wght' 600",
                    fontSize: '15px',
                  }}
                >
                  {it.kind}
                </span>
                <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--success)] uppercase">
                  ● connected
                </span>
              </div>
              <div className="mt-1 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink-muted)]">
                {Object.entries(it.display)
                  .filter(([, v]) => v)
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(' · ') || '—'}
              </div>
            </li>
          ))}
        </ul>
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

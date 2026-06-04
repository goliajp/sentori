import { useQuery } from '@tanstack/react-query'

import { adminApi, type TopRouteRow } from '@/api/client'
import { ModuleEmpty } from '@/components/Hint'
import { qk } from '@/api/query-keys'

/**
 * Audience > Behavior — v1.1 chunk D.
 *
 * Reads `/admin/api/projects/{id}/audience/top-routes` and renders
 * the busiest routes from $pageview events. Sankey drop-off lands
 * in v1.2 once the dataset shape stabilises; the table view answers
 * the headline question ("where do users spend their time?")
 * without it.
 */
export function AudienceBehaviorView({ projectId }: { projectId: string }) {
  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    meta: { persist: true },
    queryFn: () => adminApi.topRoutes(projectId, { limit: 50 }),
    queryKey: qk.audience.topRoutes(projectId, '7d'),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  if (isLoading && !data) return <ModuleEmpty eyebrow="behavior">Loading…</ModuleEmpty>
  if (error) return <ModuleEmpty eyebrow="behavior">Failed to read top routes.</ModuleEmpty>
  const rows = data ?? []

  return (
    <div className="space-y-6">
      <p className="text-fg-muted font-mono text-[11px]">
        most-viewed routes from $pageview events · last 7 days
      </p>
      {rows.length === 0 ? (
        <ModuleEmpty eyebrow="behavior">
          No $pageview events yet. Wire `useTraceNavigation` in your RN app and pageviews show up
          here automatically.
        </ModuleEmpty>
      ) : (
        <RouteList rows={rows} />
      )}
    </div>
  )
}

function RouteList({ rows }: { rows: TopRouteRow[] }) {
  const max = Math.max(...rows.map((r) => r.views), 1)
  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">Top routes</span>
        <span className="sec-head-sub">{rows.length} entries</span>
      </header>
      <ul className="pt-3">
        {rows.map((r) => {
          const pct = (r.views / max) * 100
          return (
            <li
              className="border-border/40 flex items-baseline gap-3 border-b py-2 last:border-b-0"
              key={r.route}
            >
              <span className="text-fg min-w-0 flex-1 truncate font-mono text-[13px]">
                {r.route}
              </span>
              <span className="basis-[60%]">
                <span
                  aria-hidden
                  className="bg-accent block h-[6px]"
                  style={{
                    opacity: 0.25 + (pct / 100) * 0.6,
                    width: `${Math.max(pct, 1)}%`,
                  }}
                />
              </span>
              <span className="text-fg font-mono text-[12px] tabular-nums">
                {r.views.toLocaleString()} view{r.views === 1 ? '' : 's'}
              </span>
              <span className="text-fg-secondary font-mono text-[11px] tabular-nums">
                {r.uniqueUsers.toLocaleString()} user{r.uniqueUsers === 1 ? '' : 's'}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

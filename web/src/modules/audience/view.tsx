import { useQuery } from '@tanstack/react-query'

import { adminApi } from '@/api/client'
import { ModuleEmpty } from '@/components/Hint'
import { useOrg } from '@/auth/orgContext'
import { useUrlParam } from '@/lib/url-state'

import { AudienceBehaviorView } from './behavior-view'
import { AudienceMetricsView } from './metrics-view'
import { AudienceUserDetailView } from './user-detail-view'
import { qk } from '@/api/query-keys'

type AudienceTab = 'behavior' | 'live' | 'metrics' | 'user'
const AUDIENCE_TABS: AudienceTab[] = ['behavior', 'live', 'metrics', 'user']

/**
 * Audience module entry — Live / Metrics / Behavior / User tabs.
 *
 * - Live (chunk A): /admin/api/projects/{id}/live, 5s polling.
 * - Metrics (chunk C): DAU + pageviews + errors over 7d.
 * - Behavior (chunk D): top routes from $pageview events.
 * - User (chunk D): merged track + error timeline for a user id.
 *
 * v2.1 — selected tab persists in `?tab=` URL param so refresh + share
 * keep the same view. Default `live`.
 */
export function AudienceView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [tab, setTab] = useUrlParam<AudienceTab>('tab', 'live', (raw) =>
    AUDIENCE_TABS.includes(raw as AudienceTab) ? (raw as AudienceTab) : null
  )

  if (!projectId) {
    return (
      <ModuleEmpty eyebrow="audience">
        Create a project in org settings to start collecting presence data.
      </ModuleEmpty>
    )
  }

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-3">
        <div className="flex items-baseline gap-3">
          <h1
            className="text-fg"
            style={{
              fontSize: '17px',
              fontVariationSettings: "'wdth' 95, 'opsz' 24, 'wght' 550",
              letterSpacing: '-0.01em',
            }}
          >
            Audience
          </h1>
          <TabSwitcher tab={tab} onChange={setTab} />
        </div>
      </header>

      {tab === 'live' && <LivePanel projectId={projectId} />}
      {tab === 'metrics' && <AudienceMetricsView projectId={projectId} />}
      {tab === 'behavior' && <AudienceBehaviorView projectId={projectId} />}
      {tab === 'user' && <AudienceUserDetailView projectId={projectId} />}
    </div>
  )
}

const TABS: AudienceTab[] = ['live', 'metrics', 'behavior', 'user']

function TabSwitcher({
  onChange,
  tab,
}: {
  onChange: (next: AudienceTab) => void
  tab: AudienceTab
}) {
  return (
    <div className="flex items-baseline gap-3 font-mono text-[11px] tracking-[0.18em] uppercase">
      {TABS.map((t, i) => (
        <span key={t} className="flex items-baseline gap-3">
          {i > 0 && <span className="text-border">/</span>}
          <button
            className={tab === t ? 'text-accent' : 'text-fg-muted hover:text-fg-secondary'}
            onClick={() => onChange(t)}
            type="button"
          >
            {t}
          </button>
        </span>
      ))}
    </div>
  )
}

function LivePanel({ projectId }: { projectId: string }) {
  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    meta: { persist: true },
    queryFn: () => adminApi.liveSnapshot(projectId),
    queryKey: qk.audience.live(projectId),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
    staleTime: 4_000,
  })

  if (isLoading && !data) return <ModuleEmpty eyebrow="audience">Loading…</ModuleEmpty>
  if (error) return <ModuleEmpty eyebrow="audience">Failed to read live presence.</ModuleEmpty>

  const snap = data ?? {
    byCountry: [],
    byOs: [],
    byRelease: [],
    byRoute: [],
    concurrent: 0,
    windowSeconds: 120,
  }

  return (
    <div className="space-y-6">
      <p className="text-fg-muted font-mono text-[11px]">
        users seen in the last {snap.windowSeconds}s · refreshes every 5s
      </p>

      <section className="border-border border-b pb-6">
        <div
          className="text-fg font-mono tabular-nums"
          style={{
            fontSize: 'clamp(48px, 8vw, 80px)',
            fontVariationSettings: "'wdth' 95, 'opsz' 96, 'wght' 500",
            letterSpacing: '-0.02em',
            lineHeight: '1',
          }}
        >
          {snap.concurrent.toLocaleString()}
        </div>
        <div className="text-fg-muted mt-1 font-mono text-[10px] tracking-[0.22em] uppercase">
          concurrent
        </div>
      </section>

      <div className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
        <BreakdownCard rows={snap.byRelease} title="Release" />
        <BreakdownCard rows={snap.byOs} title="OS" />
        <BreakdownCard rows={snap.byRoute} title="Route" />
        <BreakdownCard rows={snap.byCountry} title="Country" />
      </div>
    </div>
  )
}

function BreakdownCard({
  rows,
  title,
}: {
  rows: { count: number; label: string }[]
  title: string
}) {
  return (
    <div>
      <header className="border-border mb-2 flex items-baseline justify-between border-b pb-1">
        <span className="text-accent font-mono text-[10px] tracking-[0.22em] uppercase">
          {title}
        </span>
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          top {Math.min(rows.length, 5)}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="text-fg-muted py-2 font-mono text-[11px]">no data yet</p>
      ) : (
        <ul>
          {rows.map((r) => {
            const max = Math.max(...rows.map((x) => x.count), 1)
            const pct = (r.count / max) * 100
            return (
              <li
                key={r.label}
                className="border-border-muted flex items-baseline gap-3 border-b py-1.5 last:border-b-0"
              >
                <span className="text-fg min-w-0 flex-1 truncate font-mono text-[12px]">
                  {r.label}
                </span>
                <span className="text-fg-secondary font-mono text-[11px] tabular-nums">
                  {r.count.toLocaleString()}
                </span>
                <span
                  aria-hidden
                  className="bg-accent block h-[2px] basis-[80px]"
                  style={{ opacity: 0.25 + (pct / 100) * 0.6, width: `${pct}%` }}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

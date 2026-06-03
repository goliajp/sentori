// v2.1 W4 part 3 — endpoint health dashboard.
// v2.1.3 split — the parent component is now a router shell that
// renders either the list (when on `/health`) or the active child
// route (when on `/health/new`, `/health/:checkId`, `/health/:checkId/edit`).
// Children live in `form-view.tsx` and `detail-view.tsx`; primitives
// (status dot / sparkline / probe log) live in `_shared.tsx`.

import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useLocation } from 'react-router'

import { type EndpointCheck, adminApi } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { CenteredEmpty } from '@/components/Hint'
import { RowSkeleton } from '@/components/Skeleton'

import { Sparkline, StatusDot } from './_shared'
import { computeStatusBadge, lastP95 } from './_status'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * ONE_DAY_MS).toISOString()
}

function isoNow(): string {
  return new Date().toISOString()
}

/** Router shell. Sub-routes (`new`, `:checkId`, `:checkId/edit`)
 *  render via `<Outlet />`; the bare `/health` route renders the
 *  list. Detected by inspecting the trailing path segment so we
 *  don't have to thread an `index` prop through the registry. */
export function HealthView() {
  const location = useLocation()
  const isSubRoute = /\/health\/[^/]+/.test(location.pathname)
  if (isSubRoute) return <Outlet />
  return <HealthListView />
}

function HealthListView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const orgSlug = currentOrg.slug

  const checksQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listEndpointChecks(projectId!),
    queryKey: qk.endpointChecks.list(projectId),
  })

  if (!projectId) return null

  return (
    <div className="sentori-page-in space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
            endpoint health
          </div>
          <h1
            className="mt-1 text-[color:var(--ink)]"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '26px',
              fontVariationSettings: "'wdth' 95, 'opsz' 48, 'wght' 600",
              letterSpacing: '-0.018em',
              lineHeight: 1.05,
            }}
          >
            Health
          </h1>
          <div className="mt-2 text-[12px] text-[color:var(--ink-muted)]">
            Outside-in synthetic probes. Auto-opens an issue on two consecutive failures and
            auto-resolves on recovery.
          </div>
        </div>
        <Link
          className="rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-1.5 text-[12px] text-white"
          to={`/main/org/${orgSlug}/health/new`}
        >
          + New check
        </Link>
      </header>

      {checksQ.isLoading && <RowSkeleton count={4} height="56px" />}
      {checksQ.error && <CenteredEmpty>Failed to load checks.</CenteredEmpty>}
      {checksQ.data && checksQ.data.length === 0 && (
        <CenteredEmpty>
          No endpoint checks yet.
          <br />
          Create one to start the 60 s probe cycle.
        </CenteredEmpty>
      )}

      {checksQ.data && checksQ.data.length > 0 && (
        <ul className="divide-y divide-[color:var(--rule)] rounded border border-[color:var(--rule)]">
          {checksQ.data.map((c) => (
            <CheckRow check={c} key={c.id} orgSlug={orgSlug} projectId={projectId} />
          ))}
        </ul>
      )}
    </div>
  )
}

function CheckRow({
  check,
  orgSlug,
  projectId,
}: {
  check: EndpointCheck
  orgSlug: string
  projectId: string
}) {
  // List-row sparkline uses the same 24h window across every row so
  // the visuals are comparable. Detail page widens this on demand.
  const from = isoDaysAgo(1)
  const to = isoNow()
  const rollupQ = useQuery({
    queryFn: () => adminApi.listEndpointRollup(projectId, check.id, { from, to }),
    queryKey: qk.endpointChecks.rollup(projectId, check.id, from, to),
  })
  const rollup = rollupQ.data ?? []
  const status = computeStatusBadge(rollup, check.paused)
  const p95 = lastP95(rollup)

  return (
    <li className="bg-[color:var(--paper)]">
      <Link
        className="flex items-center gap-3 px-4 py-3 hover:bg-[color:var(--paper-2)]"
        to={`/main/org/${orgSlug}/health/${check.id}`}
      >
        <StatusDot kind={status.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] text-[color:var(--ink)]">{check.name}</span>
            <span className="truncate font-mono text-[10px] text-[color:var(--ink-muted)]">
              {check.method} {check.targetUrl}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 font-mono text-[10px] text-[color:var(--ink-muted)]">
            <span>every {check.intervalSec}s</span>
            <span>
              status ∈ [{check.assertionStatusCodes.join(', ')}]
              {check.assertionMaxLatencyMs ? `, < ${check.assertionMaxLatencyMs}ms` : ''}
              {check.assertionBodySubstring ? `, body ⊃ "${check.assertionBodySubstring}"` : ''}
            </span>
          </div>
        </div>
        <Sparkline rollup={rollup} />
        <div className="w-20 text-right font-mono text-[11px] text-[color:var(--ink-muted)]">
          {p95 !== null ? `${p95}ms p95` : '—'}
        </div>
      </Link>
    </li>
  )
}

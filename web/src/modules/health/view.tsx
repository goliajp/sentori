import { Alert, Button, Card, EmptyState, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, useLocation, useNavigate } from 'react-router'

import { type EndpointCheck, adminApi } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'

import { Sparkline, StatusDot } from './_shared'
import { computeStatusBadge, lastP95 } from './_status'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const isoDaysAgo = (d: number) => new Date(Date.now() - d * ONE_DAY_MS).toISOString()
const isoNow = () => new Date().toISOString()

/**
 * Endpoint health — list view + nested router shell. Sub-routes
 * (`new`, `:checkId`, `:checkId/edit`) render via `<Outlet />`; the
 * bare `/health` route shows the list of checks as a stack of GDS
 * Cards with per-row sparkline + p95 + status dot.
 */
export function HealthView() {
  const location = useLocation()
  const isSubRoute = /\/health\/[^/]+/.test(location.pathname)
  if (isSubRoute) return <Outlet />
  return <HealthListView />
}

function HealthListView() {
  const { currentOrg, currentProject } = useOrg()
  const navigate = useNavigate()
  const projectId = currentProject?.id ?? null
  const orgSlug = currentOrg.slug

  const checksQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listEndpointChecks(projectId!),
    queryKey: qk.endpointChecks.list(projectId),
  })

  if (!projectId) return null

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <Button
            onClick={() => navigate(`/main/org/${orgSlug}/health/new`)}
            size="sm"
            variant="primary"
          >
            + New check
          </Button>
        }
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          { label: currentOrg.name ?? currentOrg.slug, href: `/main/org/${orgSlug}/overview` },
          { label: 'health' },
        ]}
        subtitle="Outside-in synthetic probes · auto-issues on 2× consecutive failure"
        title="Health"
      />

      {checksQ.error && (
        <Alert title="Failed to load checks" variant="danger">
          Refresh to retry.
        </Alert>
      )}

      {checksQ.data && checksQ.data.length === 0 && (
        <Card>
          <EmptyState
            description="Create one to start the 60-second probe cycle."
            title="No endpoint checks yet"
          />
        </Card>
      )}

      {checksQ.data && checksQ.data.length > 0 && (
        <ul className="space-y-2">
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
    <li>
      <Link className="block" to={`/main/org/${orgSlug}/health/${check.id}`}>
        <Card className="hover:border-accent transition-colors">
          <div className="flex items-center gap-3">
            <StatusDot kind={status.kind} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-fg truncate text-[13px] font-medium">{check.name}</span>
                <span className="text-fg-muted truncate font-mono text-[10px]">
                  {check.method} {check.targetUrl}
                </span>
              </div>
              <div className="text-fg-muted mt-0.5 flex items-center gap-3 font-mono text-[10px]">
                <span>every {check.intervalSec}s</span>
                <span>
                  status ∈ [{check.assertionStatusCodes.join(', ')}]
                  {check.assertionMaxLatencyMs ? `, < ${check.assertionMaxLatencyMs}ms` : ''}
                  {check.assertionBodySubstring ? `, body ⊃ "${check.assertionBodySubstring}"` : ''}
                </span>
              </div>
            </div>
            <Sparkline rollup={rollup} />
            <div className="text-fg-muted w-20 text-right font-mono text-[11px] tabular-nums">
              {p95 !== null ? `${p95}ms p95` : '—'}
            </div>
          </div>
        </Card>
      </Link>
    </li>
  )
}

// v2.19 — cross-project Push status (org-scoped).
//
// One row per project in the org showing:
//   * which providers are configured (badge per provider)
//   * active device count
//   * 24h sent / failed
//   * current queue depth
//   * last send timestamp
//
// Each row links to that project's Push module overview. Powers the
// "which projects registered push?" question — the user's explicit ask.
//
// Sits under the manage group, sibling of the per-project Push module.

import { Alert, Badge, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { adminApi, type OrgPushProjectRow } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

const PROVIDER_LABELS: Record<string, string> = {
  apns: 'iOS',
  fcm: 'Android',
  webpush: 'Web',
  hcm: 'HCM',
  mipush: 'MiPush',
}

export function PushFleetView() {
  const { currentOrg } = useOrg()
  const orgSlug = currentOrg.slug

  const q = useQuery({
    queryFn: () => adminApi.listOrgPushProjects(orgSlug),
    queryKey: qk.push.fleet(orgSlug),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  const items: OrgPushProjectRow[] = q.data?.items ?? []
  const configured = items.filter((r) => r.providersConfigured.length > 0)
  const totalDevices = items.reduce((acc, r) => acc + r.devicesActive, 0)
  const totalSent24h = items.reduce((acc, r) => acc + r.sent24h, 0)
  const totalFailed24h = items.reduce((acc, r) => acc + r.failed24h, 0)
  const totalQueued = items.reduce((acc, r) => acc + r.queued, 0)

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          { label: currentOrg.name ?? orgSlug, href: `/main/org/${orgSlug}/overview` },
          { label: 'push fleet' },
        ]}
        subtitle="Every project in this org and its push state — which ones registered providers, queue depth, and 24h activity."
        title="Push fleet"
      />

      {q.error && (
        <Card>
          <Alert title="Failed to load fleet" variant="danger">
            {(q.error as Error).message}
          </Alert>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <KpiCard label="Projects with push" value={`${configured.length} / ${items.length}`} />
        <KpiCard label="Active devices" value={totalDevices.toLocaleString()} />
        <KpiCard label="Sent · 24h" value={totalSent24h.toLocaleString()} tone="success" />
        <KpiCard
          label="Failed · 24h"
          value={totalFailed24h.toLocaleString()}
          tone={totalFailed24h > 0 ? 'danger' : 'neutral'}
        />
        <KpiCard
          label="Queued now"
          value={totalQueued.toLocaleString()}
          tone={totalQueued > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Projects</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {items.length} total
          </span>
        </header>

        {!q.isLoading && !q.error && items.length === 0 && (
          <EmptyState
            description="No projects in this org yet. Create one from the Settings view."
            title="Empty org"
          />
        )}

        {items.length > 0 && (
          <DataTable<OrgPushProjectRow>
            columns={[
              {
                key: 'projectName',
                label: 'Project',
                render: (_v, r) => (
                  <Link
                    to={`/main/org/${orgSlug}/project/${r.projectId}/push`}
                    className="text-fg hover:text-primary font-mono text-[13px]"
                  >
                    {r.projectName}
                  </Link>
                ),
              },
              {
                key: 'providers',
                label: 'Providers',
                width: '220px',
                render: (_v, r) =>
                  r.providersConfigured.length === 0 ? (
                    <span className="text-fg-muted font-mono text-[11px]">— none —</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {r.providersConfigured.map((p) => (
                        <Badge
                          key={p}
                          className="font-mono text-[10px] tracking-[0.18em] uppercase"
                          variant="default"
                        >
                          {PROVIDER_LABELS[p] ?? p}
                        </Badge>
                      ))}
                    </div>
                  ),
              },
              {
                key: 'devicesActive',
                label: 'Devices',
                align: 'right',
                width: '100px',
                render: (_v, r) => (
                  <span className="text-fg font-mono text-[12px] tabular-nums">
                    {r.devicesActive}
                  </span>
                ),
              },
              {
                key: 'sent24h',
                label: 'Sent 24h',
                align: 'right',
                width: '100px',
                render: (_v, r) => (
                  <span className="text-fg font-mono text-[12px] tabular-nums">{r.sent24h}</span>
                ),
              },
              {
                key: 'failed24h',
                label: 'Failed 24h',
                align: 'right',
                width: '110px',
                render: (_v, r) => (
                  <span
                    className={`font-mono text-[12px] tabular-nums ${r.failed24h > 0 ? 'text-danger' : 'text-fg-muted'}`}
                  >
                    {r.failed24h}
                  </span>
                ),
              },
              {
                key: 'queued',
                label: 'Queued',
                align: 'right',
                width: '90px',
                render: (_v, r) => (
                  <span
                    className={`font-mono text-[12px] tabular-nums ${r.queued > 0 ? 'text-warning' : 'text-fg-muted'}`}
                  >
                    {r.queued}
                  </span>
                ),
              },
              {
                key: 'lastSendAt',
                label: 'Last send',
                width: '140px',
                render: (_v, r) => (
                  <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                    {r.lastSendAt ? formatRelative(r.lastSendAt) : '—'}
                  </span>
                ),
              },
            ]}
            density="compact"
            rowKey={(r) => r.projectId}
            rows={items}
            striped
          />
        )}
      </Card>
    </div>
  )
}

function KpiCard({
  label,
  value,
  tone = 'neutral',
}: {
  label: string
  value: number | string
  tone?: 'danger' | 'neutral' | 'success' | 'warning'
}) {
  const toneClass = {
    danger: 'text-danger',
    neutral: 'text-fg',
    success: 'text-success',
    warning: 'text-warning',
  }[tone]
  return (
    <Card>
      <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
        {label}
      </span>
      <div className={`mt-2 font-mono text-[24px] font-semibold tabular-nums ${toneClass}`}>
        {value}
      </div>
    </Card>
  )
}

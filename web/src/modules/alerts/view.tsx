// v2.16 — Alerts module (cross-cutting redesign + flip visible).
//
// Router shell — swaps between list / detail / form depending on
// the matched route. Same shape as the Health module
// (`:checkId` / `:checkId/edit` / `new`).
//
// The list shows every AlertRule in the org with trigger / status
// / last-fired columns; click-row navigates to the detail page,
// "+ New rule" navigates to the form.
//
// Cross-cutting rationale (per audit doc):alerts isn't a lens —
// every lens's measures can feed a trigger, so alerts lives in
// `manage` group as a utility surface.

import { Alert, Button, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { Outlet, useNavigate, useParams } from 'react-router'

import { type AlertRule, orgsApi } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'

import { triggerLabel } from './_shared'

export function AlertsView() {
  const params = useParams<{ ruleId: string }>()
  if (params.ruleId) return <Outlet />
  // Pathname-based detection for /new (no param)
  if (typeof window !== 'undefined' && window.location.pathname.endsWith('/alerts/new')) {
    return <Outlet />
  }
  return <AlertList />
}

function AlertList() {
  const { currentOrg } = useOrg()
  const navigate = useNavigate()
  const slug = currentOrg.slug

  const rulesQ = useQuery({
    enabled: !!slug,
    queryFn: () => orgsApi.listAlertRules(slug),
    queryKey: qk.alertRules(slug),
  })

  const rules = rulesQ.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <Button onClick={() => navigate(`/main/org/${slug}/alerts/new`)} variant="primary">
            + New rule
          </Button>
        }
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          { label: currentOrg.name ?? currentOrg.slug, href: `/main/org/${slug}/overview` },
          { label: 'alerts' },
        ]}
        subtitle={`${rules.length.toLocaleString()} rules · new issue / regression / threshold / crash-free drop`}
        title="Alert rules"
      />

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Rules</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {rules.length} rule{rules.length === 1 ? '' : 's'}
          </span>
        </header>

        {rulesQ.error && (
          <Alert title="Failed to load alert rules" variant="danger">
            Refresh to retry.
          </Alert>
        )}

        {!rulesQ.isLoading && !rulesQ.error && rules.length === 0 && (
          <EmptyState
            description='Click "+ New rule" above to create your first one. Alert rules fire on new issues, regressions, event-count thresholds, or crash-free drops; each rule can route to a webhook.'
            title="No alert rules yet"
          />
        )}

        {rules.length > 0 && (
          <DataTable<AlertRule>
            columns={[
              {
                key: 'name',
                label: 'Name',
                render: (_v, r) => <span className="text-fg font-mono text-[13px]">{r.name}</span>,
              },
              {
                key: 'triggerKind',
                label: 'Trigger',
                width: '220px',
                render: (_v, r) => (
                  <span className="text-fg-secondary font-mono text-[11px]">
                    {triggerLabel(r.triggerKind, r.triggerConfig)}
                  </span>
                ),
              },
              {
                key: 'enabled',
                label: 'Status',
                width: '100px',
                render: (_v, r) => (
                  <span
                    className={`font-mono text-[12px] ${
                      r.muted ? 'text-warning' : r.enabled ? 'text-success' : 'text-fg-muted'
                    }`}
                  >
                    {r.muted ? 'muted' : r.enabled ? 'enabled' : 'disabled'}
                  </span>
                ),
              },
              {
                align: 'right',
                key: 'lastFiredAt',
                label: 'Last fired',
                width: '140px',
                render: (_v, r) => (
                  <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                    {r.lastFiredAt ? new Date(r.lastFiredAt).toLocaleDateString() : '—'}
                  </span>
                ),
              },
            ]}
            density="compact"
            onRowClick={(r) => navigate(`/main/org/${slug}/alerts/${r.id}`)}
            rowKey={(r) => r.id}
            rows={rules}
            striped
          />
        )}
      </Card>
    </div>
  )
}

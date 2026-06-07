// v2.16 — Alert rule detail view.
//
// Pulls the rule from the same `listAlertRules` query the list view
// uses (React Query cache hit if already loaded). Shows full
// config + manage buttons (enable/disable toggle, mute toggle,
// delete, edit link).
//
// No separate /alert-rules/:id GET endpoint — list returns
// everything needed, and the cache layer avoids duplicate fetches.

import { Alert, Button, Card, EmptyState, PageHeader } from '@goliapkg/gds'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'

import { type AlertChannel, orgsApi } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'

import { triggerLabel } from './_shared'

export function AlertDetailView() {
  const { ruleId } = useParams<{ ruleId: string }>()
  const { currentOrg } = useOrg()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const slug = currentOrg.slug

  const rulesQ = useQuery({
    enabled: !!slug,
    queryFn: () => orgsApi.listAlertRules(slug),
    queryKey: qk.alertRules(slug),
  })

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.alertRules(slug) })
  }

  const patchM = useMutation({
    mutationFn: (body: Parameters<typeof orgsApi.patchAlertRule>[2]) =>
      orgsApi.patchAlertRule(slug, ruleId!, body),
    onSuccess: invalidate,
  })

  const deleteM = useMutation({
    mutationFn: () => orgsApi.deleteAlertRule(slug, ruleId!),
    onSuccess: () => {
      invalidate()
      navigate(`/main/org/${slug}/alerts`)
    },
  })

  if (!ruleId) return null

  const rule = (rulesQ.data ?? []).find((r) => r.id === ruleId)

  if (rulesQ.isLoading && !rule) {
    return (
      <div className="space-y-4">
        <PageHeader title="Alert rule" />
        <Card>
          <EmptyState description="Fetching rule…" title="Loading" />
        </Card>
      </div>
    )
  }

  if (!rule) {
    return (
      <div className="space-y-4">
        <PageHeader
          breadcrumb={[
            { label: 'sentori', href: '/main' },
            { label: currentOrg.name ?? slug, href: `/main/org/${slug}/overview` },
            { label: 'alerts', href: `/main/org/${slug}/alerts` },
            { label: ruleId },
          ]}
          title="Alert rule"
        />
        <Card>
          <EmptyState
            description="The rule may have been deleted in another tab. Go back to the list to refresh."
            title="Rule not found"
          />
        </Card>
      </div>
    )
  }

  const webhookChannel = rule.channels.find(
    (c): c is Extract<AlertChannel, { type: 'webhook' }> => c.type === 'webhook'
  )

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <div className="flex items-center gap-2">
            <Link to={`/main/org/${slug}/alerts/${ruleId}/edit`}>
              <Button variant="secondary">Edit</Button>
            </Link>
            <Button
              onClick={() => {
                if (
                  window.confirm(
                    `Delete alert rule "${rule.name}"? This stops future firings; past delivery history stays.`
                  )
                ) {
                  deleteM.mutate()
                }
              }}
              variant="danger"
            >
              Delete
            </Button>
          </div>
        }
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          { label: currentOrg.name ?? slug, href: `/main/org/${slug}/overview` },
          { label: 'alerts', href: `/main/org/${slug}/alerts` },
          { label: rule.name },
        ]}
        subtitle={triggerLabel(rule.triggerKind, rule.triggerConfig)}
        title={rule.name}
      />

      <div className="flex">
        <Link
          className="text-fg-muted hover:text-accent inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.08em] uppercase transition-colors"
          to={`/main/org/${slug}/alerts`}
        >
          ← back to rules
        </Link>
      </div>

      {patchM.error && (
        <Alert title="Update failed" variant="danger">
          {(patchM.error as Error).message}
        </Alert>
      )}
      {deleteM.error && (
        <Alert title="Delete failed" variant="danger">
          {(deleteM.error as Error).message}
        </Alert>
      )}

      <Card>
        <div className="grid grid-cols-3 gap-4">
          <KpiCell
            label="status"
            tone={rule.muted ? 'warning' : !rule.enabled ? 'muted' : 'success'}
            value={rule.muted ? 'muted' : rule.enabled ? 'enabled' : 'disabled'}
          />
          <KpiCell
            label="last fired"
            value={rule.lastFiredAt ? new Date(rule.lastFiredAt).toLocaleString() : '—'}
          />
          <KpiCell
            label="throttle"
            value={rule.throttleMinutes > 0 ? `${rule.throttleMinutes} min` : 'none'}
          />
        </div>

        <div className="border-border/40 mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
          <Button onClick={() => patchM.mutate({ enabled: !rule.enabled })} variant="secondary">
            {rule.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button onClick={() => patchM.mutate({ muted: !rule.muted })} variant="secondary">
            {rule.muted ? 'Unmute' : 'Mute'}
          </Button>
        </div>
      </Card>

      <Card>
        <header className="border-border/40 mb-3 border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Trigger</h2>
        </header>
        <DefRow label="kind">{rule.triggerKind}</DefRow>
        {rule.triggerConfig.count != null && (
          <DefRow label="count threshold">{rule.triggerConfig.count}</DefRow>
        )}
        {rule.triggerConfig.threshold != null && (
          <DefRow label="rate threshold">{rule.triggerConfig.threshold}</DefRow>
        )}
        {rule.triggerConfig.windowMinutes != null && (
          <DefRow label="window">{rule.triggerConfig.windowMinutes} min</DefRow>
        )}
      </Card>

      <Card>
        <header className="border-border/40 mb-3 border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Filters</h2>
        </header>
        {!rule.filterConfig.environment && !rule.filterConfig.release && (
          <EmptyState
            description="The rule fires on every matched trigger regardless of environment or release."
            title="No filters configured"
          />
        )}
        {rule.filterConfig.environment && (
          <DefRow label="environment">{rule.filterConfig.environment}</DefRow>
        )}
        {rule.filterConfig.release && <DefRow label="release">{rule.filterConfig.release}</DefRow>}
        {rule.filterConfig.errorTypeRegex && (
          <DefRow label="error type regex">{rule.filterConfig.errorTypeRegex}</DefRow>
        )}
      </Card>

      <Card>
        <header className="border-border/40 mb-3 border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Channels</h2>
        </header>
        {!webhookChannel && (
          <EmptyState
            description="The rule has no webhook attached; firings produce internal notifications only. Edit to wire a webhook."
            title="No channels configured"
          />
        )}
        {webhookChannel && (
          <>
            <DefRow label="webhook URL">
              <span className="font-mono text-[12px] break-all">{webhookChannel.url}</span>
            </DefRow>
            <DefRow label="HMAC secret">
              <span className="font-mono text-[12px]">
                {webhookChannel.secret ? '••• (set)' : '(no secret)'}
              </span>
            </DefRow>
          </>
        )}
      </Card>
    </div>
  )
}

function KpiCell({
  label,
  tone,
  value,
}: {
  label: string
  tone?: 'muted' | 'success' | 'warning'
  value: React.ReactNode
}) {
  const cls =
    tone === 'success'
      ? 'text-success'
      : tone === 'warning'
        ? 'text-warning'
        : tone === 'muted'
          ? 'text-fg-muted'
          : 'text-fg'
  return (
    <div className="flex flex-col gap-1">
      <span className="text-fg-muted font-mono text-[10px] tracking-[0.22em] uppercase">
        {label}
      </span>
      <span className={`${cls} font-mono text-[16px] tabular-nums`}>{value}</span>
    </div>
  )
}

function DefRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-border/40 grid grid-cols-[140px_1fr] items-baseline gap-x-4 border-b py-2 first:border-t">
      <span className="text-fg-muted font-mono text-[10px] tracking-[0.22em] uppercase">
        {label}
      </span>
      <span className="text-fg min-w-0 text-[13px]">{children}</span>
    </div>
  )
}

// v2.16 — Alert rule create/edit form.
//
// Same form serves both `/alerts/new` and `/alerts/:ruleId/edit`
// routes — the param tells us which mode + which rule to seed.
// GDS Input / Button / Alert / Card. Behaviour matches the pre-v2.16
// inline form (4 triggers, optional webhook channel, env/release
// filters, throttle), just GDS-aligned.

import { Alert, Button, Card, EmptyState, Input, PageHeader } from '@goliapkg/gds'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import {
  type AlertChannel,
  type AlertRule,
  type AlertRuleInput,
  type AlertTriggerKind,
  orgsApi,
} from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'

const TRIGGER_OPTIONS: { description: string; label: string; value: AlertTriggerKind }[] = [
  {
    description: 'fires when a never-seen-before issue is created',
    label: 'New issue',
    value: 'new_issue',
  },
  {
    description: 'fires when a resolved issue comes back in a later release',
    label: 'Regression',
    value: 'regression',
  },
  {
    description: 'fires when an issue accumulates N events in M minutes',
    label: 'Event count threshold',
    value: 'event_count',
  },
  {
    description: 'fires when the crash-free-sessions rate drops below a threshold',
    label: 'Crash-free rate drop',
    value: 'crash_free_drop',
  },
]

export function AlertFormView() {
  const { ruleId } = useParams<{ ruleId: string }>()
  const isEdit = !!ruleId
  const { currentOrg } = useOrg()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const slug = currentOrg.slug

  const rulesQ = useQuery({
    enabled: !!slug && isEdit,
    queryFn: () => orgsApi.listAlertRules(slug),
    queryKey: qk.alertRules(slug),
  })

  const existing = isEdit ? (rulesQ.data ?? []).find((r) => r.id === ruleId) : null

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: qk.alertRules(slug) })
  }

  const createM = useMutation({
    mutationFn: (body: AlertRuleInput) => orgsApi.createAlertRule(slug, body),
    onSuccess: (resp) => {
      invalidate()
      navigate(`/main/org/${slug}/alerts/${resp.id}`)
    },
  })

  const patchM = useMutation({
    mutationFn: (body: Partial<AlertRuleInput>) => orgsApi.patchAlertRule(slug, ruleId!, body),
    onSuccess: () => {
      invalidate()
      navigate(`/main/org/${slug}/alerts/${ruleId}`)
    },
  })

  if (isEdit && rulesQ.isLoading && !existing) {
    return (
      <div className="space-y-4">
        <PageHeader title="Edit alert rule" />
        <Card>
          <EmptyState description="Fetching rule…" title="Loading" />
        </Card>
      </div>
    )
  }

  if (isEdit && !existing) {
    return (
      <div className="space-y-4">
        <PageHeader title="Edit alert rule" />
        <Card>
          <EmptyState
            description="The rule may have been deleted in another tab."
            title="Rule not found"
          />
        </Card>
      </div>
    )
  }

  return (
    // `key` swaps the RuleForm subtree when the target rule changes
    // (or between new/edit modes), so initial useState values re-run
    // — no useEffect reset needed.
    <RuleForm
      error={errOf(createM.error) ?? errOf(patchM.error)}
      existing={existing ?? null}
      key={existing?.id ?? 'new'}
      onSubmit={(body) => {
        if (isEdit) patchM.mutate(body)
        else createM.mutate(body)
      }}
      orgSlug={slug}
      orgName={currentOrg.name ?? slug}
      pending={createM.isPending || patchM.isPending}
    />
  )
}

function RuleForm({
  error,
  existing,
  onSubmit,
  orgSlug,
  orgName,
  pending,
}: {
  error: null | string
  existing: AlertRule | null
  onSubmit: (body: AlertRuleInput) => void
  orgSlug: string
  orgName: string
  pending: boolean
}) {
  const initialChannel = existing?.channels.find(
    (c): c is Extract<AlertChannel, { type: 'webhook' }> => c.type === 'webhook'
  )

  const [name, setName] = useState(existing?.name ?? '')
  const [triggerKind, setTriggerKind] = useState<AlertTriggerKind>(
    existing?.triggerKind ?? 'new_issue'
  )
  const [threshold, setThreshold] = useState(
    String(existing?.triggerConfig.threshold ?? existing?.triggerConfig.count ?? 10)
  )
  const [windowMinutes, setWindowMinutes] = useState(
    String(existing?.triggerConfig.windowMinutes ?? 15)
  )
  const [webhookUrl, setWebhookUrl] = useState(initialChannel?.url ?? '')
  const [webhookSecret, setWebhookSecret] = useState(initialChannel?.secret ?? '')
  const [throttleMinutes, setThrottleMinutes] = useState(String(existing?.throttleMinutes ?? 0))
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [envFilter, setEnvFilter] = useState(existing?.filterConfig.environment ?? '')
  const [releaseFilter, setReleaseFilter] = useState(existing?.filterConfig.release ?? '')

  const needsThreshold = triggerKind === 'event_count' || triggerKind === 'crash_free_drop'
  const triggerHelp = TRIGGER_OPTIONS.find((o) => o.value === triggerKind)?.description ?? ''

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          { label: orgName, href: `/main/org/${orgSlug}/overview` },
          { label: 'alerts', href: `/main/org/${orgSlug}/alerts` },
          { label: existing ? `edit ${existing.name}` : 'new rule' },
        ]}
        title={existing ? `Edit ${existing.name}` : 'New alert rule'}
      />

      <div className="flex">
        <Link
          className="text-fg-muted hover:text-accent inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.08em] uppercase transition-colors"
          to={
            existing ? `/main/org/${orgSlug}/alerts/${existing.id}` : `/main/org/${orgSlug}/alerts`
          }
        >
          ← cancel
        </Link>
      </div>

      {error && (
        <Alert title="Couldn't save" variant="danger">
          {error}
        </Alert>
      )}

      <Card>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            const body: AlertRuleInput = {
              channels: webhookUrl.trim()
                ? [
                    {
                      secret: webhookSecret.trim(),
                      type: 'webhook',
                      url: webhookUrl.trim(),
                    },
                  ]
                : [],
              enabled,
              filterConfig: {
                ...(envFilter.trim() ? { environment: envFilter.trim() } : {}),
                ...(releaseFilter.trim() ? { release: releaseFilter.trim() } : {}),
              },
              name: name.trim(),
              throttleMinutes: Math.max(0, Number.parseInt(throttleMinutes, 10) || 0),
              triggerConfig: needsThreshold
                ? {
                    ...(triggerKind === 'event_count'
                      ? { count: Math.max(1, Number.parseInt(threshold, 10) || 1) }
                      : { threshold: Math.max(0, Number.parseFloat(threshold) || 0.95) }),
                    windowMinutes: Math.max(1, Number.parseInt(windowMinutes, 10) || 15),
                  }
                : {},
              triggerKind,
            }
            onSubmit(body)
          }}
        >
          <Field label="Name *">
            <Input
              onChange={(e) => setName(e.target.value)}
              placeholder="High-volume regression alert"
              required
              value={name}
            />
          </Field>

          <Field help={triggerHelp} label="Trigger *">
            <select
              className="border-border bg-bg text-fg gds-h-sm gds-pad-x w-full rounded border font-mono text-[13px]"
              onChange={(e) => setTriggerKind(e.target.value as AlertTriggerKind)}
              value={triggerKind}
            >
              {TRIGGER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>

          {needsThreshold && (
            <>
              <Field label={triggerKind === 'event_count' ? 'Count threshold' : 'Crash-free rate'}>
                <Input
                  onChange={(e) => setThreshold(e.target.value)}
                  placeholder={triggerKind === 'event_count' ? '100' : '0.95'}
                  value={threshold}
                />
              </Field>
              <Field label="Window (minutes)">
                <Input
                  onChange={(e) => setWindowMinutes(e.target.value)}
                  placeholder="15"
                  value={windowMinutes}
                />
              </Field>
            </>
          )}

          <Field label="Webhook URL (optional)">
            <Input
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://hooks.slack.com/services/…"
              value={webhookUrl}
            />
          </Field>

          {webhookUrl.trim() && (
            <Field label="Webhook HMAC secret">
              <Input
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="random shared secret used for X-Sentori-Signature"
                value={webhookSecret}
              />
            </Field>
          )}

          <Field
            help="0 = no throttle. Otherwise the rule will skip firings within N minutes of its previous firing."
            label="Throttle (minutes)"
          >
            <Input
              onChange={(e) => setThrottleMinutes(e.target.value)}
              placeholder="0"
              value={throttleMinutes}
            />
          </Field>

          <Field label="Environment filter (optional)">
            <Input
              onChange={(e) => setEnvFilter(e.target.value)}
              placeholder="prod"
              value={envFilter}
            />
          </Field>

          <Field label="Release filter (optional)">
            <Input
              onChange={(e) => setReleaseFilter(e.target.value)}
              placeholder="myapp@1.2.3"
              value={releaseFilter}
            />
          </Field>

          <Field label="Enabled">
            <label className="inline-flex items-center gap-2">
              <input
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                type="checkbox"
              />
              <span className="text-fg-secondary font-mono text-[11px]">fire on match</span>
            </label>
          </Field>

          <div className="border-border/40 mt-2 flex items-center gap-2 border-t pt-3">
            <Button
              disabled={pending || !name.trim()}
              loading={pending}
              type="submit"
              variant="primary"
            >
              {existing ? 'Save' : 'Create'}
            </Button>
            <Link
              to={
                existing
                  ? `/main/org/${orgSlug}/alerts/${existing.id}`
                  : `/main/org/${orgSlug}/alerts`
              }
            >
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </Link>
          </div>
        </form>
      </Card>
    </div>
  )
}

function Field({
  children,
  help,
  label,
}: {
  children: React.ReactNode
  help?: string
  label: string
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-fg-muted font-mono text-[10px] tracking-[0.22em] uppercase">
        {label}
      </span>
      {children}
      {help && <span className="text-fg-muted font-mono text-[10px]">{help}</span>}
    </label>
  )
}

function errOf(e: unknown): null | string {
  if (!e) return null
  const body = (e as { body?: { error?: string } } | undefined)?.body
  if (body?.error) return body.error
  if (e instanceof Error) return e.message
  return 'request failed'
}

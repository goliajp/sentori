import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { type AlertRule, type AlertRuleInput, type AlertTriggerKind, orgsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { useHasPermission } from '@/auth/useHasPermission'
import { PageBody, PageHeader, PageShell } from '@/components/ui'
import { densityClasses, useDensity } from '@/lib/density'
import { formatRelative as relativeTime } from '@/lib/format'

/**
 * Phase 27 sub-C: alert rules management.
 *
 * Org-level page reachable via the NAV. Owner / admin can create,
 * edit, delete, toggle. Plain members can read but the NAV item is
 * gated by `useHasPermission('audit.read')` (same gate the audit
 * page uses for the same audience).
 *
 * Channel editing in this version is email-only — emails to notify go
 * in a comma-separated input. Webhook channel UI lands in Phase 27
 * sub-D when the channel implementation does.
 */

const TRIGGER_LABELS: Record<AlertTriggerKind, string> = {
  crash_free_drop: 'Crash-free rate drop',
  event_count: 'Event count threshold',
  new_issue: 'New issue',
  regression: 'Regression',
}

export function AlertsView() {
  const { currentOrg } = useOrg()
  const canManage = useHasPermission('alert.manage')
  const [editing, setEditing] = useState<AlertRule | null | undefined>(undefined)
  // Phase 29 sub-B: expand state for the "Recent deliveries" sub-row.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const dCls = densityClasses(useDensity().density)

  const queryClient = useQueryClient()
  const { data, error, isLoading } = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => orgsApi.listAlertRules(currentOrg.slug),
    queryKey: ['alert-rules', currentOrg.slug],
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => orgsApi.deleteAlertRule(currentOrg.slug, id),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['alert-rules', currentOrg.slug] }),
  })
  const toggleMutation = useMutation({
    mutationFn: (vars: { enabled: boolean; id: string }) =>
      orgsApi.patchAlertRule(currentOrg.slug, vars.id, { enabled: vars.enabled }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['alert-rules', currentOrg.slug] }),
  })
  const muteMutation = useMutation({
    mutationFn: (vars: { id: string; muted: boolean }) =>
      orgsApi.patchAlertRule(currentOrg.slug, vars.id, { muted: vars.muted }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['alert-rules', currentOrg.slug] }),
  })
  const snoozeMutation = useMutation({
    mutationFn: (vars: { hours: null | number; id: string }) =>
      orgsApi.patchAlertRule(currentOrg.slug, vars.id, {
        snoozedUntil:
          vars.hours == null ? null : new Date(Date.now() + vars.hours * 3_600_000).toISOString(),
      }),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['alert-rules', currentOrg.slug] }),
  })

  if (isLoading) return <div className="text-fg-muted px-6 py-6 text-sm">Loading…</div>
  if (error)
    return (
      <div className="px-6 py-6 text-sm text-[color:var(--color-danger)]">
        Failed to load alert rules.
      </div>
    )

  const rules = data ?? []

  return (
    <PageShell>
      <PageHeader
        actions={
          canManage && (
            <button
              className="bg-accent text-bg rounded-md px-3 py-1 t-md"
              onClick={() => setEditing(null)}
              type="button"
            >
              + New rule
            </button>
          )
        }
        subtitle="Trigger emails when issues land, regressions appear, event volume spikes, or crash-free rate dips."
        title="Alert rules"
      />
      <PageBody>
        <div className="space-y-4">
          {rules.length === 0 ? (
            <p className="text-fg-muted t-md">
              No rules yet. Create one to get notified when something breaks.
            </p>
          ) : (
            <table className="w-full border-collapse t-md">
              <thead>
                <tr className="text-fg-muted border-border h-7 border-b text-left t-sm tracking-wider uppercase">
                  <th className="w-8 px-2"></th>
                  <th className="px-3 font-medium">Name</th>
                  <th className="px-3 font-medium">Trigger</th>
                  <th className="px-3 font-medium">Filter</th>
                  <th className="w-20 px-3 text-right font-medium">Throttle</th>
                  <th className="w-32 px-3 font-medium">Last fired</th>
                  {canManage && <th className="w-32 px-3"></th>}
                </tr>
              </thead>
              <tbody>
                {rules.flatMap((r) => {
                  const hasWebhook = r.channels.some((c) => c.type === 'webhook')
                  const isOpen = expanded.has(r.id)
                  const colCount = canManage ? 7 : 6
                  const ruleRow = (
                    <tr className={`border-border/40 border-b ${dCls.rowClass}`} key={r.id}>
                      <td className="px-2">
                        <input
                          aria-label="Enabled"
                          checked={r.enabled}
                          disabled={!canManage || toggleMutation.isPending}
                          onChange={(e) =>
                            toggleMutation.mutate({ enabled: e.target.checked, id: r.id })
                          }
                          type="checkbox"
                        />
                      </td>
                      <td className="text-fg px-3 font-medium">
                        {hasWebhook && (
                          <button
                            aria-expanded={isOpen}
                            aria-label={
                              isOpen ? 'Hide recent deliveries' : 'Show recent deliveries'
                            }
                            className="text-fg-muted hover:text-fg mr-1.5 inline-flex h-4 w-4 items-center justify-center font-mono t-sm"
                            onClick={() =>
                              setExpanded((prev) => {
                                const next = new Set(prev)
                                if (next.has(r.id)) next.delete(r.id)
                                else next.add(r.id)
                                return next
                              })
                            }
                            type="button"
                          >
                            {isOpen ? '▾' : '▸'}
                          </button>
                        )}
                        <span>{r.name}</span>
                        {r.muted && (
                          <span
                            className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 t-sm font-medium tracking-wide text-[color:var(--color-warning)] uppercase ring-1 ring-amber-500/30"
                            title="Muted — manual unmute required"
                          >
                            Muted
                          </span>
                        )}
                        {!r.muted && r.snoozedUntil && new Date(r.snoozedUntil) > new Date() && (
                          <span
                            className="ml-2 rounded bg-blue-500/15 px-1.5 py-0.5 t-sm font-medium tracking-wide text-[color:var(--color-info)] uppercase ring-1 ring-blue-500/30"
                            title={`Snoozed until ${new Date(r.snoozedUntil).toLocaleString()}`}
                          >
                            Snoozed
                          </span>
                        )}
                      </td>
                      <td className="text-fg-muted px-3">
                        <span className="bg-bg-tertiary text-fg-muted rounded px-1.5 py-0.5 t-sm">
                          {TRIGGER_LABELS[r.triggerKind]}
                        </span>
                        <TriggerSummary kind={r.triggerKind} cfg={r.triggerConfig} />
                      </td>
                      <td className="text-fg-muted truncate px-3 font-mono t-sm">
                        {filterSummary(r.filterConfig)}
                      </td>
                      <td className="text-fg-muted px-3 text-right font-mono tabular-nums">
                        {r.throttleMinutes}m
                      </td>
                      <td className="text-fg-muted px-3 font-mono t-sm tabular-nums">
                        {r.lastFiredAt ? relativeTime(r.lastFiredAt) : '—'}
                      </td>
                      {canManage && (
                        <td className="space-x-2 px-3 text-right">
                          <button
                            className="text-fg-muted hover:text-fg t-sm"
                            onClick={() => muteMutation.mutate({ id: r.id, muted: !r.muted })}
                            title={r.muted ? 'Unmute this rule' : 'Mute this rule indefinitely'}
                            type="button"
                          >
                            {r.muted ? 'Unmute' : 'Mute'}
                          </button>
                          {!r.muted && (
                            <button
                              className="text-fg-muted hover:text-fg t-sm"
                              onClick={() => {
                                const isSnoozed =
                                  r.snoozedUntil && new Date(r.snoozedUntil) > new Date()
                                if (isSnoozed) {
                                  snoozeMutation.mutate({ hours: null, id: r.id })
                                  return
                                }
                                const choice = prompt('Snooze for how many hours?', '1')
                                const n = choice ? Number.parseFloat(choice) : NaN
                                if (Number.isFinite(n) && n > 0) {
                                  snoozeMutation.mutate({ hours: n, id: r.id })
                                }
                              }}
                              title="Snooze for N hours"
                              type="button"
                            >
                              {r.snoozedUntil && new Date(r.snoozedUntil) > new Date()
                                ? 'Wake'
                                : 'Snooze'}
                            </button>
                          )}
                          <button
                            className="text-fg-muted hover:text-fg t-sm"
                            onClick={() => setEditing(r)}
                            type="button"
                          >
                            Edit
                          </button>
                          <button
                            className="text-fg-muted t-sm hover:text-[color:var(--color-danger)]"
                            onClick={() => {
                              if (confirm(`Delete rule "${r.name}"?`)) deleteMutation.mutate(r.id)
                            }}
                            type="button"
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                  if (!isOpen || !hasWebhook) return [ruleRow]
                  return [
                    ruleRow,
                    <DeliveriesRow
                      colSpan={colCount}
                      key={`${r.id}-deliveries`}
                      orgSlug={currentOrg.slug}
                      ruleId={r.id}
                    />,
                  ]
                })}
              </tbody>
            </table>
          )}

          {editing !== undefined && canManage && (
            <RuleModal
              existing={editing}
              onClose={() => setEditing(undefined)}
              onSaved={() => {
                setEditing(undefined)
                void queryClient.invalidateQueries({
                  queryKey: ['alert-rules', currentOrg.slug],
                })
              }}
              orgSlug={currentOrg.slug}
            />
          )}
        </div>
      </PageBody>
    </PageShell>
  )
}

function DeliveriesRow({
  colSpan,
  orgSlug,
  ruleId,
}: {
  colSpan: number
  orgSlug: string
  ruleId: string
}) {
  const { data, error, isLoading } = useQuery({
    queryFn: () => orgsApi.listAlertRuleDeliveries(orgSlug, ruleId),
    queryKey: ['alert-rule-deliveries', orgSlug, ruleId],
  })
  return (
    <tr className="bg-bg-tertiary/40">
      <td className="px-3 py-2" colSpan={colSpan}>
        <div className="text-fg-muted mb-1 t-sm tracking-wider uppercase">
          Recent webhook deliveries
        </div>
        {isLoading && <span className="text-fg-muted t-md">loading…</span>}
        {error && (
          <span className="t-md text-[color:var(--color-danger)]">
            failed to load deliveries
          </span>
        )}
        {data && data.length === 0 && (
          <span className="text-fg-muted t-md italic">
            No deliveries yet — webhook will fire on the next rule match.
          </span>
        )}
        {data && data.length > 0 && (
          <table className="w-full t-sm tabular-nums">
            <thead>
              <tr className="text-fg-muted text-left">
                <th className="px-2 py-0.5 font-normal">When</th>
                <th className="px-2 py-0.5 font-normal">Status</th>
                <th className="px-2 py-0.5 font-normal">Attempt</th>
                <th className="px-2 py-0.5 font-normal">HTTP</th>
                <th className="px-2 py-0.5 font-normal">Last error</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id}>
                  <td className="text-fg-muted px-2 py-0.5 font-mono">
                    {relativeTime(d.createdAt)}
                  </td>
                  <td className="px-2 py-0.5">
                    <StatusChip status={d.status} />
                  </td>
                  <td className="text-fg-muted px-2 py-0.5">{d.attempt} / 6</td>
                  <td className="text-fg-muted px-2 py-0.5">{d.lastStatus ?? '—'}</td>
                  <td className="text-fg-muted max-w-xs truncate px-2 py-0.5">
                    {d.lastError ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </td>
    </tr>
  )
}

function StatusChip({ status }: { status: 'delivered' | 'failed' | 'pending' }) {
  const cls =
    status === 'delivered'
      ? 'bg-[color:var(--color-success-bg)] text-[color:var(--color-success)] ring-[color:var(--color-success-border)]'
      : status === 'failed'
        ? 'bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)] ring-red-500/30'
        : 'bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)] ring-[color:var(--color-warning-border)]'
  return (
    <span
      className={`rounded px-1.5 py-0.5 t-sm font-medium tracking-wide uppercase ring-1 ${cls}`}
    >
      {status}
    </span>
  )
}

function TriggerSummary({
  cfg,
  kind,
}: {
  cfg: { count?: number; threshold?: number; windowMinutes?: number }
  kind: AlertTriggerKind
}) {
  if (kind === 'event_count') {
    return (
      <span className="ml-2 t-sm">
        ≥{cfg.count ?? 0} events / {cfg.windowMinutes ?? 5}m
      </span>
    )
  }
  if (kind === 'crash_free_drop') {
    return (
      <span className="ml-2 t-sm">
        rate &lt; {((cfg.threshold ?? 0.99) * 100).toFixed(2)}% / {cfg.windowMinutes ?? 60}m
      </span>
    )
  }
  return null
}

function filterSummary(f: { environment?: string; errorTypeRegex?: string; release?: string }) {
  const parts: string[] = []
  if (f.environment) parts.push(`env:${f.environment}`)
  if (f.release) parts.push(`release:${f.release}`)
  if (f.errorTypeRegex) parts.push(`type~${f.errorTypeRegex}`)
  return parts.length ? parts.join(' ') : '—'
}

// `relativeTime` is aliased to the shared `formatRelative` (see imports).

function RuleModal({
  existing,
  onClose,
  onSaved,
  orgSlug,
}: {
  existing: AlertRule | null
  onClose: () => void
  onSaved: () => void
  orgSlug: string
}) {
  const isNew = existing == null
  const [name, setName] = useState(existing?.name ?? '')
  const [kind, setKind] = useState<AlertTriggerKind>(existing?.triggerKind ?? 'new_issue')
  const [count, setCount] = useState(existing?.triggerConfig.count?.toString() ?? '100')
  const [threshold, setThreshold] = useState(
    existing?.triggerConfig.threshold?.toString() ?? '0.99'
  )
  const [windowMinutes, setWindowMinutes] = useState(
    existing?.triggerConfig.windowMinutes?.toString() ?? '5'
  )
  const [environment, setEnvironment] = useState(existing?.filterConfig.environment ?? '')
  const [release, setRelease] = useState(existing?.filterConfig.release ?? '')
  const [regex, setRegex] = useState(existing?.filterConfig.errorTypeRegex ?? '')
  const [emails, setEmails] = useState(
    existing?.channels
      .filter((c): c is { to: string[]; type: 'email' } => c.type === 'email')
      .flatMap((c) => c.to)
      .join(', ') ?? ''
  )
  const existingWebhook = existing?.channels.find(
    (c): c is { secret: string; type: 'webhook'; url: string } => c.type === 'webhook'
  )
  const [webhookUrl, setWebhookUrl] = useState(existingWebhook?.url ?? '')
  const [webhookSecret, setWebhookSecret] = useState(existingWebhook?.secret ?? '')
  const [throttleMinutes, setThrottleMinutes] = useState(
    existing?.throttleMinutes.toString() ?? '10'
  )
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)
  const [error, setError] = useState<null | string>(null)

  const buildBody = (): AlertRuleInput => {
    const triggerConfig: AlertRuleInput['triggerConfig'] = {}
    if (kind === 'event_count') {
      triggerConfig.count = Number.parseInt(count, 10)
      triggerConfig.windowMinutes = Number.parseInt(windowMinutes, 10)
    } else if (kind === 'crash_free_drop') {
      triggerConfig.threshold = Number.parseFloat(threshold)
      triggerConfig.windowMinutes = Number.parseInt(windowMinutes, 10)
    }
    const filterConfig: AlertRuleInput['filterConfig'] = {}
    if (environment.trim()) filterConfig.environment = environment.trim()
    if (release.trim()) filterConfig.release = release.trim()
    if (regex.trim()) filterConfig.errorTypeRegex = regex.trim()

    const to = emails
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean)
    const channels: AlertRuleInput['channels'] = []
    if (to.length > 0) channels.push({ to, type: 'email' })
    if (webhookUrl.trim() && webhookSecret.trim()) {
      channels.push({
        secret: webhookSecret.trim(),
        type: 'webhook',
        url: webhookUrl.trim(),
      })
    }

    return {
      channels,
      enabled,
      filterConfig,
      name: name.trim(),
      throttleMinutes: Number.parseInt(throttleMinutes, 10),
      triggerConfig,
      triggerKind: kind,
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = buildBody()
      if (existing) {
        await orgsApi.patchAlertRule(orgSlug, existing.id, body)
      } else {
        await orgsApi.createAlertRule(orgSlug, body)
      }
    },
    onError: (e: unknown) => {
      const body = (e as { body?: { error?: string } } | undefined)?.body
      setError(body?.error ?? 'Save failed.')
    },
    onSuccess: () => onSaved(),
  })

  const canSubmit = name.trim().length >= 1 && name.trim().length <= 80

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="border-border bg-bg max-h-[90vh] w-[36rem] overflow-y-auto rounded-md border p-5 shadow-xl">
        <h2 className="text-fg text-[14px] font-semibold">
          {isNew ? 'New alert rule' : 'Edit alert rule'}
        </h2>

        <div className="mt-4 space-y-3">
          <Field label="Name">
            <input
              autoFocus
              className="border-border bg-bg-tertiary text-fg w-full rounded-md border px-2 py-1 t-md"
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Page on prod regressions"
              value={name}
            />
          </Field>

          <Field label="Trigger">
            <select
              className="border-border bg-bg-tertiary text-fg w-full rounded-md border px-2 py-1 t-md"
              onChange={(e) => setKind(e.target.value as AlertTriggerKind)}
              value={kind}
            >
              <option value="new_issue">New issue</option>
              <option value="regression">Regression</option>
              <option value="event_count">Event count threshold</option>
              <option value="crash_free_drop">Crash-free rate drop</option>
            </select>
          </Field>

          {kind === 'event_count' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Count ≥">
                <NumberInput onChange={setCount} value={count} />
              </Field>
              <Field label="Window (minutes)">
                <NumberInput onChange={setWindowMinutes} value={windowMinutes} />
              </Field>
            </div>
          )}
          {kind === 'crash_free_drop' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Threshold (0..1)">
                <NumberInput onChange={setThreshold} step="0.0001" value={threshold} />
              </Field>
              <Field label="Window (minutes)">
                <NumberInput onChange={setWindowMinutes} value={windowMinutes} />
              </Field>
            </div>
          )}

          <fieldset className="border-border rounded-md border p-3">
            <legend className="text-fg-muted px-1 t-sm tracking-wider uppercase">
              Filter (optional)
            </legend>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <TextInput
                onChange={setEnvironment}
                placeholder="env e.g. prod"
                value={environment}
              />
              <TextInput
                onChange={setRelease}
                placeholder="release e.g. myapp@1.2.3"
                value={release}
              />
              <TextInput
                onChange={setRegex}
                placeholder="errorType regex e.g. ^Type"
                value={regex}
              />
            </div>
          </fieldset>

          <Field label="Email recipients (comma-separated)">
            <input
              className="border-border bg-bg-tertiary text-fg w-full rounded-md border px-2 py-1 font-mono t-md"
              onChange={(e) => setEmails(e.target.value)}
              placeholder="oncall@example.com, alice@example.com"
              value={emails}
            />
          </Field>

          <fieldset className="border-border rounded-md border p-3">
            <legend className="text-fg-muted px-1 t-sm tracking-wider uppercase">
              Webhook (optional)
            </legend>
            <p className="text-fg-muted t-sm">
              Sentori signs the body with HMAC-SHA-256 of the secret and sends it as
              <code className="font-mono"> sentori-signature: t=&lt;ts&gt;,v1=&lt;hex&gt;</code>.
            </p>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <TextInput
                onChange={setWebhookUrl}
                placeholder="https://hooks.example.com/sentori"
                value={webhookUrl}
              />
              <TextInput
                onChange={setWebhookSecret}
                placeholder="signing secret"
                value={webhookSecret}
              />
            </div>
          </fieldset>

          <div className="grid grid-cols-2 items-end gap-3">
            <Field label="Throttle (minutes)">
              <NumberInput onChange={setThrottleMinutes} value={throttleMinutes} />
            </Field>
            <label className="text-fg flex items-center gap-2 t-md">
              <input
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                type="checkbox"
              />
              Enabled
            </label>
          </div>

          {error && <p className="t-md text-[color:var(--color-danger)]">{error}</p>}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="text-fg-muted hover:text-fg rounded-md px-3 py-1 t-md"
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            className="bg-accent text-bg disabled:bg-bg-tertiary disabled:text-fg-muted rounded-md px-3 py-1 t-md disabled:cursor-not-allowed"
            disabled={!canSubmit || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            type="button"
          >
            {saveMutation.isPending ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block">
      <div className="text-fg-muted t-sm tracking-wider uppercase">{label}</div>
      <div className="mt-1">{children}</div>
    </label>
  )
}

function TextInput({
  onChange,
  placeholder,
  value,
}: {
  onChange: (v: string) => void
  placeholder?: string
  value: string
}) {
  return (
    <input
      className="border-border bg-bg-tertiary text-fg w-full rounded-md border px-2 py-1 font-mono t-md"
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      value={value}
    />
  )
}

function NumberInput({
  onChange,
  step,
  value,
}: {
  onChange: (v: string) => void
  step?: string
  value: string
}) {
  return (
    <input
      className="border-border bg-bg-tertiary text-fg w-full rounded-md border px-2 py-1 font-mono t-md tabular-nums"
      inputMode="decimal"
      min="0"
      onChange={(e) => onChange(e.target.value)}
      step={step ?? '1'}
      type="number"
      value={value}
    />
  )
}

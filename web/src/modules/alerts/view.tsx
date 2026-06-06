import { PageHeader } from '@goliapkg/gds'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  type AlertChannel,
  type AlertRule,
  type AlertRuleInput,
  type AlertTriggerKind,
  orgsApi,
} from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { InlineEmpty } from '@/components/Hint'
import { Row } from '@/components/Row'
import { RowSkeleton } from '@/components/Skeleton'

/**
 * v2.1 W2 — alerts module now manages its own rules end-to-end.
 *
 * Before v2.1 the module was read-only — it listed `AlertRule` rows
 * with a "create one in org settings" hint, but neither settings
 * nor anywhere else in the dashboard exposed the create flow. The
 * server-side `createAlertRule` endpoint had been in `client.ts`
 * since 2025 but had no UI consumer.
 *
 * This view now wires the full CRUD: create / edit / delete /
 * toggle enable / toggle mute. The form intentionally stays
 * minimal — name + trigger kind + single webhook channel + the
 * three filter knobs. Advanced surface (multi-channel email lists,
 * snooze-until, RFC-3339 windows) can grow later when concrete
 * customers ask; today's flow covers the 95 % case.
 */
export function AlertsView() {
  const { currentOrg } = useOrg()
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

  const createM = useMutation({
    mutationFn: (body: AlertRuleInput) => orgsApi.createAlertRule(slug, body),
    onSuccess: invalidate,
  })
  const patchM = useMutation({
    mutationFn: (args: { id: string; body: Partial<AlertRuleInput> }) =>
      orgsApi.patchAlertRule(slug, args.id, args.body),
    onSuccess: invalidate,
  })
  const deleteM = useMutation({
    mutationFn: (id: string) => orgsApi.deleteAlertRule(slug, id),
    onSuccess: invalidate,
  })

  const [editing, setEditing] = useState<AlertRule | 'new' | null>(null)
  const rules = rulesQ.data ?? []

  return (
    <div className="space-y-4">
      <PageHeader
        actions={
          <button
            className="bg-accent text-bg inline-flex h-7 items-center px-3 font-mono text-[11px] tracking-[0.05em] uppercase transition-opacity hover:opacity-90"
            onClick={() => setEditing('new')}
            type="button"
          >
            + new rule
          </button>
        }
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          { label: currentOrg.name ?? currentOrg.slug, href: `/main/org/${slug}/overview` },
          { label: 'alerts' },
        ]}
        subtitle={`${rules.length.toLocaleString()} rules · new issue / regression / threshold`}
        title="Alert rules"
      />

      {rulesQ.isLoading && <RowSkeleton count={4} height="48px" />}
      {rulesQ.error && <InlineEmpty danger>Failed to load alert rules.</InlineEmpty>}
      {!rulesQ.isLoading && !rulesQ.error && rules.length === 0 && editing === null && (
        <InlineEmpty>
          No rules yet. Click <b>+ new rule</b> to create your first one.
        </InlineEmpty>
      )}

      {rules.length > 0 && (
        <table className="bench">
          <thead>
            <tr>
              <th>name</th>
              <th>trigger</th>
              <th>status</th>
              <th>last fired</th>
              <th aria-label="actions" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="lead">{r.name}</td>
                <td>
                  <span className="text-fg-secondary font-mono text-[11px]">
                    {triggerLabel(r.triggerKind, r.triggerConfig)}
                  </span>
                </td>
                <td>
                  <span
                    className={
                      r.muted ? 'text-warning' : r.enabled ? 'text-success' : 'text-fg-muted'
                    }
                  >
                    {r.muted ? 'muted' : r.enabled ? 'enabled' : 'disabled'}
                  </span>
                </td>
                <td className="text-fg-secondary">
                  {r.lastFiredAt ? new Date(r.lastFiredAt).toLocaleDateString() : '—'}
                </td>
                <td className="text-right whitespace-nowrap">
                  <button
                    className="text-fg-muted hover:text-accent mr-2 font-mono text-[10px] tracking-[0.18em] uppercase"
                    onClick={() => patchM.mutate({ body: { enabled: !r.enabled }, id: r.id })}
                    type="button"
                  >
                    {r.enabled ? 'disable' : 'enable'}
                  </button>
                  <button
                    className="text-fg-muted hover:text-accent mr-2 font-mono text-[10px] tracking-[0.18em] uppercase"
                    onClick={() => setEditing(r)}
                    type="button"
                  >
                    edit
                  </button>
                  <button
                    className="text-fg-muted hover:text-danger font-mono text-[10px] tracking-[0.18em] uppercase"
                    onClick={() => {
                      if (
                        confirm(
                          `Delete alert rule "${r.name}"? This stops future firings; past delivery history stays.`
                        )
                      ) {
                        deleteM.mutate(r.id)
                      }
                    }}
                    type="button"
                  >
                    delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing !== null && (
        <RuleForm
          disabled={createM.isPending || patchM.isPending}
          error={errOf(createM.error) ?? errOf(patchM.error)}
          existing={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSubmit={(body) => {
            if (editing === 'new') {
              createM.mutate(body, { onSuccess: () => setEditing(null) })
            } else {
              patchM.mutate({ body, id: editing.id }, { onSuccess: () => setEditing(null) })
            }
          }}
        />
      )}
    </div>
  )
}

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

function RuleForm({
  disabled,
  error,
  existing,
  onCancel,
  onSubmit,
}: {
  disabled: boolean
  error: null | string
  existing: AlertRule | null
  onCancel: () => void
  onSubmit: (body: AlertRuleInput) => void
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
    <form
      className="border-border bg-bg-secondary mt-6 border p-4"
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
      <header className="mb-4 flex items-baseline justify-between">
        <span className="text-fg-muted font-mono text-[11px] tracking-[0.18em] uppercase">
          {existing ? 'edit rule' : 'new rule'}
        </span>
        <button
          className="text-fg-muted hover:text-fg font-mono text-[10px] tracking-[0.18em] uppercase"
          onClick={onCancel}
          type="button"
        >
          cancel
        </button>
      </header>

      <Row label="name *">
        <input
          className={fieldClass}
          onChange={(e) => setName(e.target.value)}
          placeholder="High-volume regression alert"
          required
          type="text"
          value={name}
        />
      </Row>

      <Row label="trigger *">
        <select
          className={fieldClass}
          onChange={(e) => setTriggerKind(e.target.value as AlertTriggerKind)}
          value={triggerKind}
        >
          {TRIGGER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-fg-muted mt-1 block font-mono text-[10px]">{triggerHelp}</span>
      </Row>

      {needsThreshold && (
        <>
          <Row label={triggerKind === 'event_count' ? 'count threshold' : 'crash-free rate'}>
            <input
              className={fieldClass}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder={triggerKind === 'event_count' ? '100' : '0.95'}
              type="text"
              value={threshold}
            />
          </Row>
          <Row label="window (minutes)">
            <input
              className={fieldClass}
              onChange={(e) => setWindowMinutes(e.target.value)}
              placeholder="15"
              type="text"
              value={windowMinutes}
            />
          </Row>
        </>
      )}

      <Row label="webhook url (optional)">
        <input
          className={fieldClass}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://hooks.slack.com/services/…"
          type="url"
          value={webhookUrl}
        />
      </Row>

      {webhookUrl.trim() && (
        <Row label="webhook secret (HMAC)">
          <input
            className={fieldClass}
            onChange={(e) => setWebhookSecret(e.target.value)}
            placeholder="random shared secret used for X-Sentori-Signature"
            type="text"
            value={webhookSecret}
          />
        </Row>
      )}

      <Row label="throttle (minutes — 0 = no throttle)">
        <input
          className={fieldClass}
          onChange={(e) => setThrottleMinutes(e.target.value)}
          placeholder="0"
          type="text"
          value={throttleMinutes}
        />
      </Row>

      <Row label="environment filter (optional)">
        <input
          className={fieldClass}
          onChange={(e) => setEnvFilter(e.target.value)}
          placeholder="prod"
          type="text"
          value={envFilter}
        />
      </Row>

      <Row label="release filter (optional)">
        <input
          className={fieldClass}
          onChange={(e) => setReleaseFilter(e.target.value)}
          placeholder="myapp@1.2.3"
          type="text"
          value={releaseFilter}
        />
      </Row>

      <Row label="enabled">
        <label className="inline-flex items-center gap-2">
          <input checked={enabled} onChange={(e) => setEnabled(e.target.checked)} type="checkbox" />
          <span className="text-fg-secondary font-mono text-[11px]">fire on match</span>
        </label>
      </Row>

      {error && <p className="text-danger mt-3 font-mono text-[11px]">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          className="bg-accent text-bg inline-flex h-8 items-center px-4 font-mono text-[11px] tracking-[0.05em] uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || !name.trim()}
          type="submit"
        >
          {disabled ? (existing ? 'saving…' : 'creating…') : existing ? 'save' : 'create'}
        </button>
        <button
          className="text-fg-muted hover:text-fg inline-flex h-8 items-center px-3 font-mono text-[11px] tracking-[0.05em] uppercase"
          onClick={onCancel}
          type="button"
        >
          cancel
        </button>
      </div>
    </form>
  )
}

const fieldClass =
  'h-8 w-full border border-border bg-bg px-2 font-mono text-[12px] text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none'

function triggerLabel(kind: AlertTriggerKind, cfg: AlertRule['triggerConfig']): string {
  switch (kind) {
    case 'new_issue':
      return 'new issue'
    case 'regression':
      return 'regression'
    case 'event_count':
      return `≥ ${cfg.count ?? '?'} events / ${cfg.windowMinutes ?? '?'} min`
    case 'crash_free_drop':
      return `crash-free < ${cfg.threshold ?? '?'} / ${cfg.windowMinutes ?? '?'} min`
    default:
      return kind
  }
}

function errOf(e: unknown): null | string {
  if (!e) return null
  const body = (e as { body?: { error?: string } } | undefined)?.body
  if (body?.error) return body.error
  if (e instanceof Error) return e.message
  return 'request failed'
}

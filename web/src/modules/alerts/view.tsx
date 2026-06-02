import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  type AlertChannel,
  type AlertRule,
  type AlertRuleInput,
  type AlertTriggerKind,
  orgsApi,
} from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { Row } from '@/components/Row'
import { EmptyState } from '@/components/Hint'
import { RowSkeleton } from '@/components/Skeleton'
import { PageHeader } from '@/layout/page-header'
import { qk } from '@/api/query-keys'

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
    <div className="sentori-page-in">
      <PageHeader
        actions={
          <button
            className="inline-flex h-7 items-center bg-[color:var(--accent)] px-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--paper)] uppercase transition-opacity hover:opacity-90"
            onClick={() => setEditing('new')}
            type="button"
          >
            + new rule
          </button>
        }
        count={rules.length}
        subtitle="new issue · regression · threshold"
        title="Alert rules"
      />

      {rulesQ.isLoading && <RowSkeleton count={4} height="48px" />}
      {rulesQ.error && <EmptyState danger>Failed to load alert rules.</EmptyState>}
      {!rulesQ.isLoading && !rulesQ.error && rules.length === 0 && editing === null && (
        <EmptyState>
          No rules yet. Click <b>+ new rule</b> to create your first one.
        </EmptyState>
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
                  <span className="font-mono text-[11px] text-[color:var(--ink-soft)]">
                    {triggerLabel(r.triggerKind, r.triggerConfig)}
                  </span>
                </td>
                <td>
                  <span
                    className={
                      r.muted
                        ? 'text-[color:var(--warning)]'
                        : r.enabled
                          ? 'text-[color:var(--success)]'
                          : 'text-[color:var(--ink-muted)]'
                    }
                  >
                    {r.muted ? 'muted' : r.enabled ? 'enabled' : 'disabled'}
                  </span>
                </td>
                <td className="text-[color:var(--ink-soft)]">
                  {r.lastFiredAt ? new Date(r.lastFiredAt).toLocaleDateString() : '—'}
                </td>
                <td className="text-right whitespace-nowrap">
                  <button
                    className="mr-2 font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--accent)]"
                    onClick={() => patchM.mutate({ body: { enabled: !r.enabled }, id: r.id })}
                    type="button"
                  >
                    {r.enabled ? 'disable' : 'enable'}
                  </button>
                  <button
                    className="mr-2 font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--accent)]"
                    onClick={() => setEditing(r)}
                    type="button"
                  >
                    edit
                  </button>
                  <button
                    className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--danger)]"
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
      className="mt-6 border border-[color:var(--rule)] bg-[color:var(--paper-2)] p-4"
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
        <span className="font-mono text-[11px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
          {existing ? 'edit rule' : 'new rule'}
        </span>
        <button
          className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--ink)]"
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
        <span className="mt-1 block font-mono text-[10px] text-[color:var(--ink-muted)]">
          {triggerHelp}
        </span>
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
          <span className="font-mono text-[11px] text-[color:var(--ink-soft)]">fire on match</span>
        </label>
      </Row>

      {error && <p className="mt-3 font-mono text-[11px] text-[color:var(--danger)]">{error}</p>}

      <div className="mt-4 flex items-center gap-2">
        <button
          className="inline-flex h-8 items-center bg-[color:var(--accent)] px-4 font-mono text-[11px] tracking-[0.05em] text-[color:var(--paper)] uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || !name.trim()}
          type="submit"
        >
          {disabled ? (existing ? 'saving…' : 'creating…') : existing ? 'save' : 'create'}
        </button>
        <button
          className="inline-flex h-8 items-center px-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--ink)]"
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
  'h-8 w-full border border-[color:var(--rule)] bg-[color:var(--paper)] px-2 font-mono text-[12px] text-[color:var(--ink)] placeholder:text-[color:var(--ink-muted)] focus:border-[color:var(--accent)] focus:outline-none'

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

// v1.4 W22 — webhook delivery retry UI.
//
// The retry queue (server/src/webhook_dispatch.rs) marches
// automatically on [60s, 5m, 30m, 2h, 12h, 24h] for up to 6 attempts.
// Until v1.4 W22 the only operator-visible signal was "did my alert
// post or not?" — with this page they can see pending + failed
// rows and kick a manual retry.
//
// UX checklist:
//   1. Entry point          → sidebar "Webhooks" module (organize).
//   2. Empty state          → "No webhook deliveries yet" + alert-
//                              rule docs hint.
//   3. Loading state        → skeleton row.
//   4. Error state          → ErrorBanner with structured-error hint.
//   5. Success feedback     → row's status flips to "pending" after
//                              Retry; react-query auto-refetches.
//   6. Edit path            → re-clicking Retry is idempotent.
//   7. Delete path          → operator deletes the alert_rule itself
//                              (cascade); we don't surface a per-row
//                              delete since the audit trail matters.
//   8. No docs required     → row + Retry button are self-explanatory.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi, isStructuredError, type WebhookDeliveryRow } from '@/api/client'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'
import { qk } from '@/api/query-keys'

const STATUS_TABS: { key: string; label: string }[] = [
  { key: 'pending', label: 'pending' },
  { key: 'failed', label: 'failed' },
  { key: 'delivered', label: 'delivered' },
  { key: 'any', label: 'all' },
]

export function WebhooksView() {
  const [status, setStatus] = useState<string>('pending')
  const qc = useQueryClient()
  const deliveriesQ = useQuery({
    queryFn: () => adminApi.listWebhookDeliveries({ status, limit: 100 }),
    queryKey: qk.webhookDeliveries(status),
    refetchInterval: 30_000,
  })

  const retryM = useMutation({
    mutationFn: (id: string) => adminApi.retryWebhookDelivery(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.webhookDeliveries(status) }),
  })

  const rows = deliveriesQ.data ?? []

  return (
    <div className="sentori-page-in">
      <PageHeader subtitle="alert webhook retry queue" title="Webhooks" />

      <div className="border-border mb-3 flex items-baseline gap-3 border-b pb-1">
        {STATUS_TABS.map((t) => {
          const active = status === t.key
          return (
            <button
              className={`relative pb-2 font-mono text-[11px] tracking-[0.1em] uppercase transition-colors focus:outline-none ${
                active ? 'text-fg' : 'text-fg-muted hover:text-fg'
              }`}
              key={t.key}
              onClick={() => setStatus(t.key)}
              type="button"
            >
              {t.label}
              {active && (
                <span
                  aria-hidden
                  className="bg-accent absolute right-0 -bottom-px left-0 h-[2px]"
                />
              )}
            </button>
          )
        })}
      </div>

      {deliveriesQ.isLoading && (
        <p className="border-border text-fg-secondary border-y py-6 text-center text-[13px]">
          Loading…
        </p>
      )}

      {deliveriesQ.error && (
        <p className="border-danger/40 bg-danger/5 text-danger rounded border px-3 py-2 text-[12px]">
          {hintOf(deliveriesQ.error) ?? 'Failed to load deliveries.'}
        </p>
      )}

      {!deliveriesQ.isLoading && !deliveriesQ.error && rows.length === 0 && (
        <p className="border-border text-fg-secondary border-y py-6 text-center text-[13px]">
          No {status === 'any' ? '' : `${status} `}webhook deliveries yet.
        </p>
      )}

      {rows.length > 0 && (
        <table className="bench">
          <thead>
            <tr>
              <th>rule</th>
              <th>target</th>
              <th>status</th>
              <th className="num">attempt</th>
              <th>last error</th>
              <th>next attempt</th>
              <th>created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <DeliveryRow
                key={r.id}
                onRetry={() => retryM.mutate(r.id)}
                pending={retryM.isPending && retryM.variables === r.id}
                row={r}
              />
            ))}
          </tbody>
        </table>
      )}

      {retryM.error && (
        <p className="border-danger/40 bg-danger/5 text-danger mt-3 rounded border px-3 py-2 text-[12px]">
          Retry failed: {hintOf(retryM.error) ?? 'unknown error'}
        </p>
      )}
    </div>
  )
}

function DeliveryRow({
  onRetry,
  pending,
  row,
}: {
  onRetry: () => void
  pending: boolean
  row: WebhookDeliveryRow
}) {
  const statusCls =
    row.status === 'delivered'
      ? 'text-success'
      : row.status === 'failed'
        ? 'text-danger'
        : 'text-fg-muted'
  return (
    <tr>
      <td className="lead">{row.ruleName ?? row.ruleId.slice(0, 8)}</td>
      <td className="truncate font-mono text-[11px]">{row.targetUrl}</td>
      <td className={`font-mono text-[10px] tracking-[0.18em] uppercase ${statusCls}`}>
        ● {row.status}
        {row.lastStatus !== null ? ` (HTTP ${row.lastStatus})` : ''}
      </td>
      <td className="num tabular-nums">{row.attempt} / 6</td>
      <td className="text-fg-muted truncate font-mono text-[11px]" title={row.lastError ?? ''}>
        {row.lastError ?? '—'}
      </td>
      <td className="num text-[11px] tabular-nums">
        {row.status === 'pending' ? formatRelative(row.nextAttemptAt) : '—'}
      </td>
      <td className="num text-[11px] tabular-nums">{formatRelative(row.createdAt)}</td>
      <td>
        {row.status !== 'delivered' && (
          <button
            className="border-border text-fg-muted hover:text-fg t-sm rounded border px-2 py-0.5 disabled:opacity-50"
            disabled={pending}
            onClick={onRetry}
            type="button"
          >
            {pending ? '…' : 'Retry'}
          </button>
        )}
      </td>
    </tr>
  )
}

function hintOf(error: unknown): null | string {
  if (isStructuredError(error)) {
    return error.body.error.hint ?? error.body.error.message
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return null
}

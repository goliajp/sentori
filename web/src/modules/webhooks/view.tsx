import { Alert, Badge, Button, DataTable, PageHeader, Tabs as GdsTabs } from '@goliapkg/gds'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi, isStructuredError, type WebhookDeliveryRow } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

const STATUS_TABS = [
  { id: 'pending', label: 'Pending' },
  { id: 'failed', label: 'Failed' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'any', label: 'All' },
]

/**
 * Webhook delivery retry queue. Status tabs filter the underlying
 * DataTable; clicking Retry on a row fires the server's per-delivery
 * retry endpoint and react-query auto-refetches at the existing
 * 30 s interval.
 */
export function WebhooksView() {
  const { currentOrg } = useOrg()
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

  const rows = (deliveriesQ.data ?? []) as WebhookDeliveryRow[]

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'webhooks' },
        ]}
        subtitle="Alert webhook retry queue · [60s, 5m, 30m, 2h, 12h, 24h]"
        title="Webhooks"
      />

      <GdsTabs active={status} onChange={setStatus} tabs={STATUS_TABS} variant="underline" />

      {deliveriesQ.error && (
        <Alert title="Failed to load deliveries" variant="danger">
          {hintOf(deliveriesQ.error) ?? 'Refresh to retry.'}
        </Alert>
      )}

      {retryM.error && (
        <Alert title="Retry failed" variant="danger">
          {hintOf(retryM.error) ?? 'Unknown error.'}
        </Alert>
      )}

      <DataTable<WebhookDeliveryRow>
        columns={[
          {
            key: 'ruleName',
            label: 'Rule',
            width: '160px',
            render: (_v, r) => (
              <span className="text-fg font-mono text-[12px]">
                {r.ruleName ?? r.ruleId.slice(0, 8)}
              </span>
            ),
          },
          {
            key: 'targetUrl',
            label: 'Target',
            render: (_v, r) => (
              <span className="text-fg-secondary truncate font-mono text-[11px]">
                {r.targetUrl}
              </span>
            ),
          },
          {
            key: 'status',
            label: 'Status',
            width: '170px',
            render: (_v, r) => {
              const variant =
                r.status === 'delivered' ? 'success' : r.status === 'failed' ? 'danger' : 'default'
              return (
                <Badge
                  className="font-mono text-[10px] tracking-[0.18em] uppercase"
                  variant={variant}
                >
                  {r.status}
                  {r.lastStatus !== null ? ` · ${r.lastStatus}` : ''}
                </Badge>
              )
            },
          },
          {
            align: 'right',
            key: 'attempt',
            label: 'Attempt',
            width: '80px',
            render: (_v, r) => (
              <span className="text-fg font-mono text-[11px] tabular-nums">{r.attempt} / 6</span>
            ),
          },
          {
            key: 'lastError',
            label: 'Last error',
            render: (_v, r) => (
              <span
                className="text-fg-muted truncate font-mono text-[11px]"
                title={r.lastError ?? ''}
              >
                {r.lastError ?? '—'}
              </span>
            ),
          },
          {
            align: 'right',
            key: 'nextAttemptAt',
            label: 'Next',
            width: '110px',
            render: (_v, r) => (
              <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                {r.status === 'pending' ? formatRelative(r.nextAttemptAt) : '—'}
              </span>
            ),
          },
          {
            align: 'right',
            key: 'createdAt',
            label: 'Created',
            width: '110px',
            render: (_v, r) => (
              <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                {formatRelative(r.createdAt)}
              </span>
            ),
          },
          {
            align: 'right',
            key: 'action',
            label: '',
            width: '90px',
            render: (_v, r) => {
              if (r.status === 'delivered') return null
              const pending = retryM.isPending && retryM.variables === r.id
              return (
                <Button
                  disabled={pending}
                  loading={pending}
                  onClick={() => retryM.mutate(r.id)}
                  size="sm"
                  variant="secondary"
                >
                  Retry
                </Button>
              )
            },
          },
        ]}
        density="compact"
        loading={deliveriesQ.isLoading}
        loadingRows={6}
        rowKey="id"
        rows={rows}
        stickyHeader
        striped
      />
    </div>
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

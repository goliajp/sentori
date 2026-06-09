// v2.19 — single push_send detail. Shows:
//
//   1. Send envelope (status / provider / outcome / retry count / dates).
//   2. Full payload JSON (collapsible).
//   3. delivery_logs timeline (one row per attempt; vendor body
//      truncated to 2 KB by the writer).
//   4. Retry button (POST /push/sends/:sendId/retry → enqueue clone).
//   5. Device presence indicator — surfaces the case where the device
//      that originated this send was later revoked.
//
// Wired as a child route of the Push module via registry.tsx
// `children: [{ path: ':sendId', view: PushSendDetailView }]`.

import { Alert, Badge, Button, Card, PageHeader } from '@goliapkg/gds'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import {
  adminApi,
  type PushDeliveryLogEntry,
  type PushSendDetail,
  type PushSendDownstreamResponse,
} from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

export function PushSendDetailView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const { sendId } = useParams<{ sendId: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [payloadOpen, setPayloadOpen] = useState(false)

  const detailQ = useQuery({
    enabled: !!projectId && !!sendId,
    queryFn: () => adminApi.getPushSendDetail(projectId!, sendId!),
    queryKey: qk.push.sendDetail(projectId, sendId),
    refetchInterval: 10_000,
    staleTime: 5_000,
  })

  const retryM = useMutation({
    mutationFn: () => adminApi.retryPushSend(projectId!, sendId!),
    onSuccess: (data) => {
      // Re-queue lands as a new send — invalidate the list so the
      // user sees it appear, and jump to the new send's detail.
      void qc.invalidateQueries({ queryKey: qk.push.sends(projectId) })
      void qc.invalidateQueries({ queryKey: qk.push.stats(projectId) })
      navigate(`../${data.sendId}`)
    },
  })

  if (!projectId || !sendId) {
    return null
  }

  const backHref = `/main/org/${currentOrg.slug}/project/${projectId}/push`

  if (detailQ.error) {
    return (
      <div className="space-y-4">
        <PageHeader
          breadcrumb={[
            { label: 'sentori', href: '/main' },
            { label: 'push', href: backHref },
            { label: sendId.slice(0, 8) },
          ]}
          title="Send"
        />
        <Card>
          <Alert title="Failed to load send" variant="danger">
            {(detailQ.error as Error).message}
          </Alert>
        </Card>
      </div>
    )
  }

  if (!detailQ.data) {
    return (
      <div className="space-y-4">
        <PageHeader title="Send" />
        <Card>
          <span className="text-fg-muted font-mono text-[12px]">Loading…</span>
        </Card>
      </div>
    )
  }

  const d: PushSendDetail = detailQ.data
  const statusVariant =
    d.send.status === 'sent' ? 'success' : d.send.status === 'failed' ? 'danger' : 'default'

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'push', href: backHref },
          { label: sendId.slice(0, 8) },
        ]}
        title="Send"
      />

      <Card>
        <header className="border-border/40 mb-3 flex items-center justify-between gap-3 border-b pb-2">
          <div className="flex items-center gap-3">
            <Badge
              className="font-mono text-[10px] tracking-[0.18em] uppercase"
              variant={statusVariant}
            >
              {d.send.status}
            </Badge>
            <span className="text-fg-secondary font-mono text-[11px] uppercase">
              {d.send.provider}
            </span>
            <span className="text-fg-muted font-mono text-[11px]">
              {d.send.providerOutcome ?? '—'}
            </span>
          </div>
          <Button
            disabled={!d.devicePresent || retryM.isPending}
            loading={retryM.isPending}
            onClick={() => {
              if (
                window.confirm(
                  'Re-queue this send as a new attempt? Original retry chain stays in delivery_logs; the new send gets its own.'
                )
              ) {
                retryM.mutate()
              }
            }}
            size="sm"
            variant="primary"
          >
            Retry
          </Button>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] md:grid-cols-3">
          <KV label="send id" value={d.send.id} />
          <KV
            label="device"
            value={
              d.devicePresent ? (
                <span className="text-fg-secondary font-mono text-[11px]">
                  ipt_{d.send.tokenId.slice(0, 10)}…
                </span>
              ) : (
                <span className="text-warning font-mono text-[11px]">revoked / missing</span>
              )
            }
          />
          <KV label="retries" value={d.send.retryCount.toString()} />
          <KV label="created" value={formatRelative(d.send.createdAt)} />
          <KV label="sent" value={d.send.sentAt ? formatRelative(d.send.sentAt) : '—'} />
          <KV label="next attempt" value={formatRelative(d.send.nextAttemptAt)} />
          {/* v2.32 — scheduled send badge. When next_attempt_at is in
              the future AND no sent_at, the row is waiting on
              dispatch_cron. */}
          {!d.send.sentAt && new Date(d.send.nextAttemptAt) > new Date() && (
            <KV
              label="scheduled"
              value={
                <Badge className="font-mono text-[10px] uppercase" variant="default">
                  ⏰ {formatRelative(d.send.nextAttemptAt)}
                </Badge>
              }
            />
          )}
          {d.send.idempotencyKey && <KV label="idempotency key" value={d.send.idempotencyKey} />}
        </dl>

        {d.send.error && (
          <Alert className="mt-3" title="Last error" variant="danger">
            <pre className="font-mono text-[11px] whitespace-pre-wrap">{d.send.error}</pre>
          </Alert>
        )}
      </Card>

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Payload</h2>
          <Button onClick={() => setPayloadOpen((v) => !v)} size="sm" variant="ghost">
            {payloadOpen ? 'collapse' : 'expand'}
          </Button>
        </header>
        {payloadOpen ? (
          <pre className="border-border/40 bg-bg-muted gds-pad text-fg-secondary max-h-[400px] overflow-auto rounded border font-mono text-[10px]">
            {JSON.stringify(d.send.payload, null, 2)}
          </pre>
        ) : (
          <span className="text-fg-muted font-mono text-[11px]">
            {Object.keys(d.send.payload).length} top-level keys · click expand to inspect
          </span>
        )}
      </Card>

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Delivery timeline</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {d.deliveryLogs.length} attempt{d.deliveryLogs.length === 1 ? '' : 's'}
          </span>
        </header>
        {d.deliveryLogs.length === 0 ? (
          <span className="text-fg-muted font-mono text-[11px]">
            No attempts yet — this send is still queued.
          </span>
        ) : (
          <ol className="space-y-3">
            {d.deliveryLogs.map((log) => (
              <DeliveryLogRow key={`${log.attempt}-${log.createdAt}`} log={log} />
            ))}
          </ol>
        )}
      </Card>

      <DeliveryAckCard send={d.send} />

      <CampaignTagsCard send={d.send} />

      <DownstreamImpactCard projectId={projectId} sendId={sendId} />

      <Link
        to={backHref}
        className="text-fg-muted hover:text-fg inline-block font-mono text-[11px]"
      >
        ← back to Sends
      </Link>
    </div>
  )
}

// ── Delivery confirmation (v2.26 ack) ────────────────────────────────
//
// Surfaces `push_sends.acked_at` flipped when the SDK posts
// /v1/push/sends/:id/ack on receive. NULL = no ack yet (could be
// pre-v2.26 SDK, host killed before flush, or network loss).

function DeliveryAckCard({ send }: { send: PushSendDetail['send'] }) {
  const acked = !!send.ackedAt
  const sent = !!send.sentAt
  return (
    <Card>
      <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
        <h2 className="text-fg text-[14px] font-semibold">Delivery confirmation</h2>
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          v2.26 SDK ack
        </span>
      </header>
      {!sent ? (
        <p className="text-fg-muted font-mono text-[11px]">
          Send hasn&apos;t left the queue yet — ack can&apos;t arrive until provider accepts.
        </p>
      ) : acked ? (
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] md:grid-cols-3">
          <KV
            label="status"
            value={
              <Badge className="font-mono text-[10px] uppercase" variant="success">
                ✓ acked
              </Badge>
            }
          />
          <KV label="acked at" value={formatRelative(send.ackedAt!)} />
          {send.ackSessionId && <KV label="session" value={send.ackSessionId.slice(0, 12) + '…'} />}
        </div>
      ) : (
        <p className="text-fg-muted font-mono text-[11px]">
          Provider accepted at {formatRelative(send.sentAt!)} but the device hasn&apos;t confirmed
          yet. Pre-v2.26 SDK, host process killed before the 5 s ack flush, or ack POST dropped on
          the network.
        </p>
      )}
    </Card>
  )
}

// ── Campaign / BI tags (v2.25) ────────────────────────────────────────
//
// Surfaces the campaignId / templateId / audienceTag the caller passed
// on send. None set = the dashboard simply shows an empty-state copy
// so customers know the field exists.

function CampaignTagsCard({ send }: { send: PushSendDetail['send'] }) {
  const has = !!(send.campaignId || send.templateId || send.audienceTag)
  if (!has) return null
  return (
    <Card>
      <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
        <h2 className="text-fg text-[14px] font-semibold">Campaign tags</h2>
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          v2.25 BI
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[11px] md:grid-cols-3">
        {send.campaignId && <KV label="campaign" value={send.campaignId} />}
        {send.templateId && <KV label="template" value={send.templateId} />}
        {send.audienceTag && <KV label="audience" value={send.audienceTag} />}
        {send.preferenceCategory && (
          <KV
            label="preference"
            value={
              <span className="font-mono text-[11px]">
                {send.preferenceCategory} <span className="text-fg-muted text-[10px]">(v2.34)</span>
              </span>
            }
          />
        )}
      </dl>
    </Card>
  )
}

// ── Downstream impact (v2.27) ─────────────────────────────────────────
//
// Surfaces the v2.25/v2.26 wire+SDK correlation as a server-side
// query: how many events landed in the 24h after this push, including
// distinct sessions + error count. Closes the dashboard half of
// Observability link-through ironclad rule #4.

function DownstreamImpactCard({ projectId, sendId }: { projectId: string; sendId: string }) {
  const q = useQuery({
    queryFn: () => adminApi.getPushSendDownstream(projectId, sendId),
    queryKey: qk.push.sendDownstream(projectId, sendId),
    staleTime: 60_000,
  })

  if (q.error) {
    return (
      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Downstream impact</h2>
        </header>
        <Alert title="Failed to load" variant="danger">
          {(q.error as Error).message}
        </Alert>
      </Card>
    )
  }

  if (q.isLoading || !q.data) {
    return (
      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Downstream impact</h2>
        </header>
        <span className="text-fg-muted font-mono text-[12px]">Loading…</span>
      </Card>
    )
  }

  const r: PushSendDownstreamResponse = q.data
  const windowHrs = Math.round(r.windowSecs / 3600)

  if (r.correlationStatus === 'n/a') {
    return (
      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Downstream impact</h2>
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            n/a — send never delivered
          </span>
        </header>
        <p className="text-fg-muted font-mono text-[11px]">
          Correlation only fires after a push reaches the device. This send either is still queued
          or failed before delivery.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
        <h2 className="text-fg text-[14px] font-semibold">Downstream impact</h2>
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          {windowHrs} h after delivery
        </span>
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Events" value={r.eventCount} />
        <Stat
          label="Errors"
          value={r.errorEventCount}
          tone={r.errorEventCount > 0 ? 'danger' : 'neutral'}
        />
        <Stat label="Sessions" value={r.distinctSessions} />
        <Stat
          label="First seen"
          value={r.firstSeenSecs == null ? '—' : formatSecsCompact(r.firstSeenSecs)}
        />
      </div>
      {r.eventCount === 0 && (
        <p className="text-fg-muted mt-3 font-mono text-[11px]">
          No events from the recipient's session(s) in the {windowHrs} h window. The push reached
          the device, but the user has not interacted since.
        </p>
      )}
    </Card>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number | string
  tone?: 'danger' | 'neutral'
}) {
  const toneClass = tone === 'danger' ? 'text-danger' : 'text-fg'
  return (
    <div className="border-border/30 rounded border p-3">
      <div className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">{label}</div>
      <div className={`mt-1 font-mono text-[18px] tabular-nums ${toneClass}`}>{value}</div>
    </div>
  )
}

function formatSecsCompact(secs: number): string {
  if (secs < 60) return `${secs}s`
  if (secs < 3600) return `${Math.floor(secs / 60)}m`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`
  return `${Math.floor(secs / 86400)}d`
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">{label}</dt>
      <dd className="text-fg font-mono text-[11px]">{value}</dd>
    </div>
  )
}

function DeliveryLogRow({ log }: { log: PushDeliveryLogEntry }) {
  const isSent = log.outcome.toLowerCase().includes('sent') || log.providerStatus === 200
  const isRetry = log.outcome.toLowerCase().includes('transient') || log.providerStatus === 429
  const variant: 'danger' | 'default' | 'success' = isSent
    ? 'success'
    : isRetry
      ? 'default'
      : 'danger'

  return (
    <li className="border-border/40 rounded border">
      <div className="border-border/40 flex items-center justify-between border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Badge className="font-mono text-[10px] tracking-[0.18em] uppercase" variant={variant}>
            attempt {log.attempt}
          </Badge>
          <span className="text-fg font-mono text-[11px]">{log.outcome}</span>
          {log.providerStatus != null && (
            <span className="text-fg-muted font-mono text-[10px]">http {log.providerStatus}</span>
          )}
        </div>
        <div className="text-fg-muted flex items-center gap-3 font-mono text-[10px] tabular-nums">
          {log.durationMs != null && <span>{log.durationMs}ms</span>}
          <span>{formatRelative(log.createdAt)}</span>
        </div>
      </div>
      {log.providerBody && (
        <pre className="bg-bg-muted text-fg-secondary max-h-[200px] overflow-auto px-3 py-2 font-mono text-[10px] whitespace-pre-wrap">
          {log.providerBody}
        </pre>
      )}
    </li>
  )
}

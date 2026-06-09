// v2.19 — Push monitoring + management surface.
//
// Four GDS tabs:
//
//   1. Overview — per-provider 24h rollup (queued / sent / failed),
//      device counts, last-send timestamp, configured-provider gaps.
//      Highest-level "is push healthy" view.
//
//   2. Devices — paginated active device_tokens. Surfaces user link
//      (fingerprint hex prefix), env, bad_streak, last_seen.
//
//   3. Sends — paginated push_sends with status/provider filters.
//      Each row links to the send-detail sub-route.
//
//   4. Credentials — list + upsert/delete + green/red verify status.
//      Verify mutation pings the vendor's auth endpoint.
//
// The send-detail sub-route renders at `:sendId` via the Outlet
// declared by `registry.tsx` children[]. See `detail-view.tsx`.

import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  Tabs as GdsTabs,
} from '@goliapkg/gds'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Outlet, useNavigate, useParams } from 'react-router'

import {
  adminApi,
  type ProviderHealthSnapshot,
  type PushCredentialRow,
  type PushDeviceRow,
  type PushHealthResponse,
  type PushProviderKind,
  type PushSendRow,
  type PushSendStatus,
  type PushStatsResponse,
  type PushVerifyResult,
} from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

const PROVIDER_LABELS: Record<PushProviderKind, string> = {
  apns: 'APNs (iOS)',
  fcm: 'FCM v1 (Android)',
  webpush: 'Web Push (VAPID)',
  hcm: 'HCM (Huawei)',
  mipush: 'MiPush (Xiaomi)',
}

const PROVIDER_OPTIONS: PushProviderKind[] = ['apns', 'fcm', 'webpush', 'hcm', 'mipush']

type PushTab = 'credentials' | 'devices' | 'overview' | 'sends'

const TABS: { id: PushTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'devices', label: 'Devices' },
  { id: 'sends', label: 'Sends' },
  { id: 'credentials', label: 'Credentials' },
]

export function PushView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  // When a child route (`:sendId`) is active, render only the Outlet.
  // Detection: useParams gives us back `:sendId` from the parent's
  // <Route> definition in registry → AppShell.
  const params = useParams<{ sendId?: string }>()
  const [tab, setTab] = useState<PushTab>('overview')

  if (params.sendId) {
    return <Outlet />
  }

  if (!projectId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Push" />
        <Card>
          <EmptyState
            description="Pick a project from the sidebar to view push state."
            title="No project selected"
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          {
            label: currentOrg.name ?? currentOrg.slug,
            href: `/main/org/${currentOrg.slug}/overview`,
          },
          { label: 'push' },
        ]}
        subtitle="Manage credentials, watch device activity, inspect every send + its delivery timeline."
        title="Push"
      />

      <GdsTabs
        active={tab}
        onChange={(id) => setTab(id as PushTab)}
        tabs={TABS}
        variant="underline"
      />

      {tab === 'overview' && <OverviewTab projectId={projectId} />}
      {tab === 'devices' && <DevicesTab projectId={projectId} />}
      {tab === 'sends' && <SendsTab projectId={projectId} />}
      {tab === 'credentials' && <CredentialsTab projectId={projectId} />}
    </div>
  )
}

// ── Overview tab ──────────────────────────────────────────────────────

function OverviewTab({ projectId }: { projectId: string }) {
  const statsQ = useQuery({
    queryFn: () => adminApi.getPushStats(projectId),
    queryKey: qk.push.stats(projectId),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  if (statsQ.error) {
    return (
      <Card>
        <Alert title="Failed to load stats" variant="danger">
          {(statsQ.error as Error).message}
        </Alert>
      </Card>
    )
  }
  if (statsQ.isLoading || !statsQ.data) {
    return (
      <Card>
        <span className="text-fg-muted font-mono text-[12px]">Loading…</span>
      </Card>
    )
  }
  const s: PushStatsResponse = statsQ.data
  const providers = Object.keys(s.perProvider).sort() as PushProviderKind[]
  const rows = providers.map((p) => ({ provider: p, ...s.perProvider[p] }))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Queued now"
          value={s.queuedTotal}
          tone={s.queuedTotal > 0 ? 'warning' : 'neutral'}
        />
        <KpiCard label="Sent · 24h" value={s.sent24hTotal} tone="success" />
        <KpiCard
          label="Failed · 24h"
          value={s.failed24hTotal}
          tone={s.failed24hTotal > 0 ? 'danger' : 'neutral'}
        />
        <KpiCard label="Active devices" value={s.devicesActiveTotal} tone="neutral" />
      </div>

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Per-provider rollup</h2>
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            last 24 hours
          </span>
        </header>

        {rows.length === 0 ? (
          <EmptyState
            description="No credentials configured and no recorded sends. Add a provider under the Credentials tab to start."
            title="No push activity"
          />
        ) : (
          <DataTable
            columns={[
              {
                key: 'provider',
                label: 'Provider',
                render: (_v, r) => (
                  <span className="text-fg font-mono text-[13px]">
                    {PROVIDER_LABELS[r.provider]}
                  </span>
                ),
              },
              {
                key: 'devices',
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
                key: 'queued',
                label: 'Queued',
                align: 'right',
                width: '100px',
                render: (_v, r) => (
                  <span
                    className={`font-mono text-[12px] tabular-nums ${r.queued > 0 ? 'text-warning' : 'text-fg-muted'}`}
                  >
                    {r.queued}
                  </span>
                ),
              },
              {
                key: 'sent24h',
                label: 'Sent 24h',
                align: 'right',
                width: '110px',
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
                key: 'successRate',
                label: 'Success',
                align: 'right',
                width: '110px',
                render: (_v, r) => {
                  const total = r.sent24h + r.failed24h
                  if (total === 0) {
                    return <span className="text-fg-muted font-mono text-[11px]">—</span>
                  }
                  const rate = (r.sent24h / total) * 100
                  return (
                    <span
                      className={`font-mono text-[12px] tabular-nums ${rate >= 99 ? 'text-success' : rate >= 90 ? 'text-warning' : 'text-danger'}`}
                    >
                      {rate.toFixed(1)}%
                    </span>
                  )
                },
              },
            ]}
            density="compact"
            rowKey={(r) => r.provider}
            rows={rows}
            striped
          />
        )}

        {s.lastSendAt && (
          <p className="text-fg-muted mt-3 font-mono text-[11px]">
            last send · {formatRelative(s.lastSendAt)}
          </p>
        )}
      </Card>

      <ProviderHealthCard projectId={projectId} />
    </div>
  )
}

// ── Provider Health card (v2.24) ──────────────────────────────────────
//
// Surfaces the v2.23 in-memory HealthState. Operators see the rolling
// invalid-rate + "safety margin" gauge before FCM/APNs's abuse
// heuristics trip. Reads cheap process memory only — no DB query.

function ProviderHealthCard({ projectId }: { projectId: string }) {
  const q = useQuery({
    queryFn: () => adminApi.getPushHealth(projectId),
    queryKey: qk.push.health(projectId),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  if (q.error) {
    return (
      <Card>
        <Alert title="Failed to load health" variant="danger">
          {(q.error as Error).message}
        </Alert>
      </Card>
    )
  }
  if (q.isLoading || !q.data) {
    return (
      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Provider health</h2>
        </header>
        <span className="text-fg-muted font-mono text-[12px]">Loading…</span>
      </Card>
    )
  }

  const h: PushHealthResponse = q.data
  // Sort by safety margin ascending so the riskiest provider sits at
  // the top — "this is the one to look at first".
  const rows = [...h.providers].sort((a, b) => a.safetyMarginPct - b.safetyMarginPct)
  const windowMins = Math.round(h.windowSecs / 60)
  const thresholdPct = (h.thresholdRatio * 100).toFixed(0)

  return (
    <Card>
      <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
        <h2 className="text-fg text-[14px] font-semibold">Provider health</h2>
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          rolling {windowMins}m · auto-throttle at {thresholdPct}% invalid
        </span>
      </header>

      <DataTable
        columns={[
          {
            key: 'provider',
            label: 'Provider',
            render: (_v, r) => (
              <span className="text-fg font-mono text-[13px]">{PROVIDER_LABELS[r.provider]}</span>
            ),
          },
          {
            key: 'inWindowTotal',
            label: 'Sends',
            align: 'right',
            width: '90px',
            render: (_v, r) => (
              <span className="text-fg font-mono text-[12px] tabular-nums">{r.inWindowTotal}</span>
            ),
          },
          {
            key: 'invalidRate',
            label: 'Invalid',
            align: 'right',
            width: '110px',
            render: (_v, r) => {
              if (r.inWindowTotal === 0) {
                return <span className="text-fg-muted font-mono text-[11px]">—</span>
              }
              const pct = r.invalidRate * 100
              const tone = healthTone(r)
              return (
                <span className={`font-mono text-[12px] tabular-nums ${TONE_CLASS[tone]}`}>
                  {pct.toFixed(1)}%
                </span>
              )
            },
          },
          {
            key: 'safetyMarginPct',
            label: 'Safety margin',
            align: 'right',
            width: '180px',
            render: (_v, r) => <SafetyMarginBar row={r} />,
          },
          {
            key: 'autoThrottle',
            label: 'Throttled',
            align: 'right',
            width: '120px',
            render: (_v, r) =>
              r.autoThrottle ? (
                <Badge variant="danger">throttled</Badge>
              ) : r.inWindowTotal === 0 ? (
                <span className="text-fg-muted font-mono text-[11px]">idle</span>
              ) : (
                <Badge variant="success">healthy</Badge>
              ),
          },
        ]}
        density="compact"
        rowKey={(r) => r.provider}
        rows={rows}
      />

      <p className="text-fg-muted mt-3 font-mono text-[11px]">
        invalid = tokens FCM/APNs/HCM rejected as no-longer-registered. Sustained {thresholdPct}%+
        trips auto-throttle to protect sender reputation (rolling {windowMins} min window, min
        sample 20 sends).
      </p>
    </Card>
  )
}

const TONE_CLASS: Record<'danger' | 'muted' | 'success' | 'warning', string> = {
  danger: 'text-danger',
  muted: 'text-fg-muted',
  success: 'text-success',
  warning: 'text-warning',
}

function healthTone(r: ProviderHealthSnapshot): 'danger' | 'muted' | 'success' | 'warning' {
  if (r.inWindowTotal === 0) return 'muted'
  if (r.autoThrottle) return 'danger'
  if (r.safetyMarginPct < 40) return 'warning'
  return 'success'
}

function SafetyMarginBar({ row }: { row: ProviderHealthSnapshot }) {
  if (row.inWindowTotal === 0) {
    return <span className="text-fg-muted font-mono text-[11px]">—</span>
  }
  const pct = Math.max(0, Math.min(100, row.safetyMarginPct))
  const tone = healthTone(row)
  const barClass =
    tone === 'danger' ? 'bg-danger/70' : tone === 'warning' ? 'bg-warning/70' : 'bg-success/70'
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="bg-border/30 h-1.5 w-24 overflow-hidden rounded-full">
        <div className={`h-full ${barClass}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-[11px] tabular-nums ${TONE_CLASS[tone]} w-10 text-right`}>
        {pct.toFixed(0)}%
      </span>
    </div>
  )
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'danger' | 'neutral' | 'success' | 'warning'
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
      <div className={`mt-2 font-mono text-[28px] font-semibold tabular-nums ${toneClass}`}>
        {value.toLocaleString()}
      </div>
    </Card>
  )
}

// ── Devices tab ───────────────────────────────────────────────────────

function DevicesTab({ projectId }: { projectId: string }) {
  const [provider, setProvider] = useState<'' | PushProviderKind>('')
  const q = useQuery({
    queryFn: () =>
      adminApi.listPushDevices(projectId, {
        limit: 100,
        provider: provider || undefined,
      }),
    queryKey: qk.push.devices(projectId, provider || undefined),
    staleTime: 20_000,
  })

  return (
    <Card>
      <header className="border-border/40 mb-3 flex items-center justify-between gap-3 border-b pb-2">
        <h2 className="text-fg text-[14px] font-semibold">
          Devices <span className="text-fg-muted font-mono text-[11px]">· active</span>
        </h2>
        <label className="flex items-center gap-2">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            provider
          </span>
          <select
            className="border-border bg-bg text-fg gds-h-sm gds-pad-x rounded border font-mono text-[12px]"
            onChange={(e) => setProvider(e.target.value as '' | PushProviderKind)}
            value={provider}
          >
            <option value="">all</option>
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </header>

      {q.error && (
        <Alert title="Failed to load devices" variant="danger">
          {(q.error as Error).message}
        </Alert>
      )}

      {!q.isLoading && !q.error && (q.data?.items.length ?? 0) === 0 && (
        <EmptyState
          description="No client has registered a push token in this project yet. Mobile SDKs register via `sentori.pushRegister()`."
          title="No active devices"
        />
      )}

      {q.data?.items && q.data.items.length > 0 && (
        <DataTable<PushDeviceRow>
          columns={[
            {
              key: 'provider',
              label: 'Provider',
              width: '110px',
              render: (_v, r) => (
                <Badge
                  className="font-mono text-[10px] tracking-[0.18em] uppercase"
                  variant="default"
                >
                  {r.provider}
                </Badge>
              ),
            },
            {
              key: 'id',
              label: 'Device handle',
              render: (_v, r) => (
                <span className="text-fg font-mono text-[11px]">ipt_{r.id.slice(0, 10)}…</span>
              ),
            },
            {
              key: 'user',
              label: 'User',
              render: (_v, r) => (
                <span className="text-fg-secondary font-mono text-[11px]">
                  {r.userFingerprintHex ? `${r.userFingerprintHex.slice(0, 12)}…` : '—'}
                </span>
              ),
            },
            {
              key: 'env',
              label: 'Env',
              width: '90px',
              render: (_v, r) => (
                <span className="text-fg-muted font-mono text-[11px]">{r.env ?? '—'}</span>
              ),
            },
            {
              key: 'badStreak',
              label: 'Bad streak',
              align: 'right',
              width: '110px',
              render: (_v, r) => (
                <span
                  className={`font-mono text-[12px] tabular-nums ${r.badStreak > 0 ? 'text-warning' : 'text-fg-muted'}`}
                >
                  {r.badStreak}
                </span>
              ),
            },
            {
              key: 'lastSeenAt',
              label: 'Last seen',
              width: '140px',
              render: (_v, r) => (
                <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                  {formatRelative(r.lastSeenAt)}
                </span>
              ),
            },
          ]}
          density="compact"
          rowKey={(r) => r.id}
          rows={q.data.items}
          striped
        />
      )}
    </Card>
  )
}

// ── Sends tab ─────────────────────────────────────────────────────────

function SendsTab({ projectId }: { projectId: string }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState<'' | PushSendStatus>('')
  const [provider, setProvider] = useState<'' | PushProviderKind>('')
  const q = useQuery({
    queryFn: () =>
      adminApi.listPushSends(projectId, {
        limit: 100,
        status: status || undefined,
        provider: provider || undefined,
      }),
    queryKey: qk.push.sends(projectId, {
      status: status || undefined,
      provider: provider || undefined,
    }),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })

  return (
    <Card>
      <header className="border-border/40 mb-3 flex items-center justify-between gap-3 border-b pb-2">
        <h2 className="text-fg text-[14px] font-semibold">Sends</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
              status
            </span>
            <select
              className="border-border bg-bg text-fg gds-h-sm gds-pad-x rounded border font-mono text-[12px]"
              onChange={(e) => setStatus(e.target.value as '' | PushSendStatus)}
              value={status}
            >
              <option value="">all</option>
              <option value="queued">queued</option>
              <option value="sent">sent</option>
              <option value="failed">failed</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
              provider
            </span>
            <select
              className="border-border bg-bg text-fg gds-h-sm gds-pad-x rounded border font-mono text-[12px]"
              onChange={(e) => setProvider(e.target.value as '' | PushProviderKind)}
              value={provider}
            >
              <option value="">all</option>
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {q.error && (
        <Alert title="Failed to load sends" variant="danger">
          {(q.error as Error).message}
        </Alert>
      )}

      {!q.isLoading && !q.error && (q.data?.items.length ?? 0) === 0 && (
        <EmptyState
          description="No push sends recorded for this project. Backend integrators POST /v1/push/send."
          title="No sends yet"
        />
      )}

      {q.data?.items && q.data.items.length > 0 && (
        <DataTable<PushSendRow>
          columns={[
            {
              key: 'status',
              label: 'Status',
              width: '110px',
              render: (_v, r) => (
                <Badge
                  className="font-mono text-[10px] tracking-[0.18em] uppercase"
                  variant={
                    r.status === 'sent' ? 'success' : r.status === 'failed' ? 'danger' : 'default'
                  }
                >
                  {r.status}
                </Badge>
              ),
            },
            {
              key: 'provider',
              label: 'Provider',
              width: '90px',
              render: (_v, r) => (
                <span className="text-fg-secondary font-mono text-[11px] uppercase">
                  {r.provider}
                </span>
              ),
            },
            {
              key: 'title',
              label: 'Title / preview',
              render: (_v, r) => (
                <span className="text-fg font-mono text-[11px]">
                  {r.payloadPreview.title ?? r.payloadPreview.body ?? '(no title)'}
                </span>
              ),
            },
            {
              key: 'providerOutcome',
              label: 'Outcome',
              width: '180px',
              render: (_v, r) => (
                <span className="text-fg-muted font-mono text-[10px]">
                  {r.providerOutcome ?? (r.status === 'queued' ? '—' : '?')}
                </span>
              ),
            },
            {
              key: 'retryCount',
              label: 'Retries',
              align: 'right',
              width: '80px',
              render: (_v, r) => (
                <span
                  className={`font-mono text-[12px] tabular-nums ${r.retryCount > 0 ? 'text-warning' : 'text-fg-muted'}`}
                >
                  {r.retryCount}
                </span>
              ),
            },
            {
              // v2.26 — SDK confirmed-delivery ack column. ✓ when
              // the device posted /v1/push/sends/:id/ack; — for
              // queued/failed or pre-v2.26 hosts.
              key: 'ackedAt',
              label: 'Ack',
              align: 'right',
              width: '70px',
              render: (_v, r) =>
                r.ackedAt ? (
                  <span className="text-success font-mono text-[12px]" title={r.ackedAt}>
                    ✓
                  </span>
                ) : (
                  <span className="text-fg-muted font-mono text-[12px]">—</span>
                ),
            },
            {
              // v2.25 — BI campaign tag (when caller passed it on
              // /v1/push/send). Empty for legacy / untagged sends.
              key: 'campaignId',
              label: 'Campaign',
              width: '140px',
              render: (_v, r) =>
                r.campaignId ? (
                  <Badge className="font-mono text-[10px]" variant="default">
                    {r.campaignId}
                  </Badge>
                ) : (
                  <span className="text-fg-muted font-mono text-[11px]">—</span>
                ),
            },
            {
              key: 'createdAt',
              label: 'Created',
              width: '130px',
              render: (_v, r) => (
                <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                  {formatRelative(r.createdAt)}
                </span>
              ),
            },
            {
              key: 'open',
              label: '',
              align: 'right',
              width: '70px',
              render: (_v, r) => (
                <Button onClick={() => navigate(r.id)} size="sm" variant="ghost">
                  Open
                </Button>
              ),
            },
          ]}
          density="compact"
          rowKey={(r) => r.id}
          rows={q.data.items}
          striped
        />
      )}
    </Card>
  )
}

// ── Credentials tab ───────────────────────────────────────────────────

function CredentialsTab({ projectId }: { projectId: string }) {
  const qc = useQueryClient()

  const credsQ = useQuery({
    queryFn: () => adminApi.listPushCredentials(projectId),
    queryKey: qk.pushCredentials(projectId),
  })

  const upsertM = useMutation({
    mutationFn: ({
      provider,
      config,
      secret,
    }: {
      provider: PushProviderKind
      config: unknown
      secret: unknown
    }) => adminApi.upsertPushCredential(projectId, provider, config, secret),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.pushCredentials(projectId) }),
  })

  const deleteM = useMutation({
    mutationFn: (provider: PushProviderKind) => adminApi.deletePushCredential(projectId, provider),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.pushCredentials(projectId) }),
  })

  const rows = credsQ.data ?? []

  return (
    <div className="space-y-4">
      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Configured providers</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {rows.length} active
          </span>
        </header>

        {credsQ.error && (
          <Alert title="Failed to load credentials" variant="danger">
            Refresh to retry.
          </Alert>
        )}

        {!credsQ.isLoading && !credsQ.error && rows.length === 0 && (
          <EmptyState
            description="Add a credential below. Each provider can have one row per project."
            title="No push providers configured yet"
          />
        )}

        {rows.length > 0 && (
          <DataTable<PushCredentialRow>
            columns={[
              {
                key: 'provider',
                label: 'Provider',
                render: (_v, r) => (
                  <span className="text-fg font-mono text-[13px]">
                    {PROVIDER_LABELS[r.provider]}
                  </span>
                ),
              },
              {
                key: 'config',
                label: 'Config summary',
                render: (_v, r) => (
                  <span className="text-fg-secondary font-mono text-[11px]">
                    {summariseConfig(r.provider, r.config)}
                  </span>
                ),
              },
              {
                key: 'updatedAt',
                label: 'Updated',
                width: '140px',
                render: (_v, r) => (
                  <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                    {formatRelative(r.updatedAt)}
                  </span>
                ),
              },
              {
                key: 'verify',
                label: 'Status',
                width: '180px',
                render: (_v, r) => <VerifyCell projectId={projectId} provider={r.provider} />,
              },
              {
                align: 'right',
                key: 'delete',
                label: '',
                width: '90px',
                render: (_v, r) => (
                  <Button
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete the ${PROVIDER_LABELS[r.provider]} credential? Sends to this provider will start failing until a new one is uploaded.`
                        )
                      ) {
                        deleteM.mutate(r.provider)
                      }
                    }}
                    size="sm"
                    variant="ghost"
                  >
                    Delete
                  </Button>
                ),
              },
            ]}
            density="compact"
            rowKey={(r) => r.provider}
            rows={rows}
            striped
          />
        )}
      </Card>

      <UpsertCredentialForm
        onSubmit={(provider, config, secret) => upsertM.mutate({ config, provider, secret })}
        pending={upsertM.isPending}
        error={upsertM.error?.message ?? null}
      />
    </div>
  )
}

function VerifyCell({ projectId, provider }: { projectId: string; provider: PushProviderKind }) {
  const qc = useQueryClient()
  const verifyM = useMutation({
    mutationFn: () => adminApi.verifyPushCredential(projectId, provider),
    onSuccess: (data: PushVerifyResult) => {
      qc.setQueryData(qk.push.verify(projectId, provider), data)
    },
  })
  // Treat the latest cached verify as the source of truth — surfaces
  // "you already verified this 30 s ago" without burning another
  // OAuth mint when the user just hops tabs.
  const cached = qc.getQueryData<PushVerifyResult>(qk.push.verify(projectId, provider))

  const display = verifyM.data ?? cached ?? null
  const dot = display
    ? display.status === 'ok'
      ? 'bg-success'
      : display.status === 'unverified'
        ? 'bg-fg-muted'
        : display.status === 'unreachable'
          ? 'bg-warning'
          : 'bg-danger'
    : 'bg-fg-muted'

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      <span className="text-fg-secondary font-mono text-[11px]">
        {display ? display.status : 'unchecked'}
      </span>
      <Button
        onClick={() => verifyM.mutate()}
        size="sm"
        variant="ghost"
        loading={verifyM.isPending}
      >
        {verifyM.isPending ? '…' : 'Verify'}
      </Button>
      {display?.reason && display.status !== 'ok' && (
        <span className="text-fg-muted truncate font-mono text-[10px]" title={display.reason}>
          {display.reason.slice(0, 30)}
        </span>
      )}
    </div>
  )
}

function summariseConfig(provider: PushProviderKind, config: Record<string, unknown>): string {
  switch (provider) {
    case 'apns': {
      const team = config.team_id as string | undefined
      const bundle = config.bundle_id as string | undefined
      const env = config.env_default as string | undefined
      return [team, bundle, env].filter(Boolean).join(' · ')
    }
    case 'fcm': {
      const proj = config.project_id as string | undefined
      return proj ?? '(no project id)'
    }
    case 'webpush': {
      const pub = config.vapid_public as string | undefined
      const contact = config.contact as string | undefined
      return [pub ? `key ${pub.slice(0, 10)}…` : null, contact].filter(Boolean).join(' · ')
    }
    case 'hcm':
    case 'mipush': {
      const appId = (config.app_id ?? config.appId ?? config.package_name) as string | undefined
      return appId ?? '(no app id)'
    }
    default:
      return ''
  }
}

function UpsertCredentialForm({
  onSubmit,
  pending,
  error,
}: {
  onSubmit: (provider: PushProviderKind, config: unknown, secret: unknown) => void
  pending: boolean
  error: null | string
}) {
  const [provider, setProvider] = useState<PushProviderKind>('apns')
  const [configText, setConfigText] = useState('')
  const [secretText, setSecretText] = useState('')
  const [parseError, setParseError] = useState<null | string>(null)

  return (
    <Card>
      <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
        <h2 className="text-fg text-[14px] font-semibold">Add / update credential</h2>
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          Encrypted at rest
        </span>
      </header>

      {(error ?? parseError) && (
        <Alert title="Couldn't save" variant="danger">
          {error ?? parseError}
        </Alert>
      )}

      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          setParseError(null)
          let config: unknown
          let secret: unknown
          try {
            config = configText.trim() === '' ? {} : JSON.parse(configText)
          } catch (err) {
            setParseError(`config JSON parse: ${(err as Error).message}`)
            return
          }
          try {
            secret = JSON.parse(secretText)
          } catch (err) {
            setParseError(`secret JSON parse: ${(err as Error).message}`)
            return
          }
          onSubmit(provider, config, secret)
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            provider
          </span>
          <select
            className="border-border bg-bg text-fg gds-h-sm gds-pad-x rounded border font-mono text-[13px]"
            onChange={(e) => setProvider(e.target.value as PushProviderKind)}
            value={provider}
          >
            {PROVIDER_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            config (JSON, non-secret)
          </span>
          <textarea
            className="border-border bg-bg text-fg gds-pad rounded border font-mono text-[12px]"
            onChange={(e) => setConfigText(e.target.value)}
            placeholder={configPlaceholder(provider)}
            rows={6}
            value={configText}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            secret (JSON, sealed before save)
          </span>
          <textarea
            className="border-border bg-bg text-fg gds-pad rounded border font-mono text-[12px]"
            onChange={(e) => setSecretText(e.target.value)}
            placeholder={secretPlaceholder(provider)}
            rows={6}
            value={secretText}
          />
        </label>

        <div className="border-border/40 flex items-center justify-end gap-3 border-t pt-3">
          <span className="text-fg-muted font-mono text-[10px]">
            Sealed via AES-256-GCM. Never returned by GET.
          </span>
          <Button disabled={pending} loading={pending} type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </Card>
  )
}

function configPlaceholder(provider: PushProviderKind): string {
  switch (provider) {
    case 'apns':
      return JSON.stringify(
        {
          key_id: 'ABCDEFGHIJ',
          team_id: '1234567890',
          bundle_id: 'com.example.app',
          env_default: 'production',
        },
        null,
        2
      )
    case 'fcm':
      return JSON.stringify({ project_id: 'my-fcm-project' }, null, 2)
    case 'webpush':
      return JSON.stringify({ vapid_public: 'BNc...', contact: 'mailto:dev@example.com' }, null, 2)
    case 'hcm':
      return JSON.stringify({ app_id: '...' }, null, 2)
    case 'mipush':
      return JSON.stringify({ package_name: 'com.example.app', region: 'cn' }, null, 2)
    default:
      return ''
  }
}

function secretPlaceholder(provider: PushProviderKind): string {
  switch (provider) {
    case 'apns':
      return JSON.stringify(
        { p8: '-----BEGIN PRIVATE KEY-----\\n…\\n-----END PRIVATE KEY-----' },
        null,
        2
      )
    case 'fcm':
      return '{ "type": "service_account", "client_email": "…", "private_key": "…", "token_uri": "https://oauth2.googleapis.com/token" }'
    case 'webpush':
      return JSON.stringify(
        { vapid_private: '-----BEGIN EC PRIVATE KEY-----\\n…\\n-----END EC PRIVATE KEY-----' },
        null,
        2
      )
    case 'hcm':
    case 'mipush':
      return JSON.stringify({ app_secret: '…' }, null, 2)
    default:
      return ''
  }
}

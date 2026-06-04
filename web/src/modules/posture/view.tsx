import { Alert, Card, EmptyState, PageHeader, Tabs as GdsTabs } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'

import { adminApi, type PinAnomalyRow, type TrustScoreRow } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { useUrlParam } from '@/lib/url-state'

import { TrustExplorerView } from './explorer-view'
import { FederationView } from './federation-view'

type PostureTab = 'explorer' | 'federation' | 'pin' | 'trust'
const POSTURE_TABS: PostureTab[] = ['pin', 'trust', 'explorer', 'federation']
const TAB_LABEL: Record<PostureTab, string> = {
  explorer: 'Signal explorer',
  federation: 'Federation',
  pin: 'Pin anomalies',
  trust: 'Trust',
}

const TAB_SUBTITLE: Record<PostureTab, string> = {
  pin: 'TLS pin mismatches reported by SDK callers · last 24 h · 60 s refresh',
  trust: 'install trust scores (0 – 100, lower = worse) · last 24 h',
  explorer: 'simulate weight changes · re-scoring runs in-browser via Rust → WebAssembly',
  federation: 'lookup a federated identity across every project in this org',
}

/**
 * Posture — four-tab security surface. GDS Tabs drives selection;
 * the tab state persists in `?tab=` URL param so refresh + share
 * keep the same view. Default `pin`.
 */
export function PostureView() {
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [tab, setTab] = useUrlParam<PostureTab>('tab', 'pin', (raw) =>
    POSTURE_TABS.includes(raw as PostureTab) ? (raw as PostureTab) : null
  )

  if (!projectId) {
    return (
      <div className="space-y-4">
        <PageHeader title="Posture" />
        <Card>
          <EmptyState
            description="Pick a project from the sidebar to read its security posture."
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
          { label: 'posture' },
        ]}
        subtitle={TAB_SUBTITLE[tab]}
        title="Posture"
      />

      <GdsTabs
        active={tab}
        onChange={(id) => setTab(id as PostureTab)}
        tabs={POSTURE_TABS.map((t) => ({ id: t, label: TAB_LABEL[t] }))}
        variant="underline"
      />

      {tab === 'pin' && <PinAnomalyPanel projectId={projectId} />}
      {tab === 'trust' && <TrustScorePanel projectId={projectId} />}
      {tab === 'explorer' && <TrustExplorerView projectId={projectId} />}
      {tab === 'federation' && <FederationView />}
    </div>
  )
}

function PinAnomalyPanel({ projectId }: { projectId: string }) {
  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    meta: { persist: true },
    placeholderData: (prev) => prev,
    queryFn: () => adminApi.pinAnomalies(projectId, { limit: 100 }),
    queryKey: qk.posture.pinAnomalies(projectId),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  if (error) {
    return (
      <Alert title="Failed to read pin anomalies" variant="danger">
        Refresh to retry.
      </Alert>
    )
  }
  const rows = data ?? []
  if (isLoading && rows.length === 0) {
    return (
      <Card>
        <EmptyState description="Fetching pin mismatches…" title="Loading" />
      </Card>
    )
  }
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          description="SDKs running sentori.reportPinMismatch({ expected, observed, serverName }) will land here."
          title="No pin mismatches in the last 24 h"
        />
      </Card>
    )
  }

  return (
    <Card>
      <header className="border-border-muted mb-3 flex items-baseline justify-between border-b pb-2">
        <h2 className="text-fg text-[14px] font-semibold">Top servers</h2>
        <span className="text-fg-muted font-mono text-[11px] tabular-nums">
          {rows.length} servers
        </span>
      </header>
      <ul>
        {rows.map((r) => (
          <AnomalyRow key={r.serverName ?? '(unknown)'} row={r} />
        ))}
      </ul>
    </Card>
  )
}

function AnomalyRow({ row }: { row: PinAnomalyRow }) {
  const suspicious = row.installCount >= 3
  return (
    <li className="border-border-muted flex items-baseline gap-4 border-b py-2 last:border-b-0">
      <span className="text-fg min-w-0 flex-1 truncate font-mono text-[13px]">
        {row.serverName ?? '(unknown server)'}
      </span>
      <span className="text-fg-muted font-mono text-[11px] tabular-nums">
        {new Date(row.lastSeen).toLocaleString()}
      </span>
      <span className="text-fg-secondary font-mono text-[12px] tabular-nums">
        {row.count.toLocaleString()} report{row.count === 1 ? '' : 's'}
      </span>
      <span
        className={`font-mono text-[12px] tabular-nums ${suspicious ? 'text-danger' : 'text-fg-secondary'}`}
      >
        {row.installCount} install{row.installCount === 1 ? '' : 's'}
        {suspicious ? ' ⚠' : ''}
      </span>
    </li>
  )
}

function TrustScorePanel({ projectId }: { projectId: string }) {
  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    meta: { persist: true },
    placeholderData: (prev) => prev,
    queryFn: () => adminApi.trustScores(projectId, { limit: 100 }),
    queryKey: qk.posture.trustScores(projectId),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  if (error) {
    return (
      <Alert title="Failed to read trust scores" variant="danger">
        Refresh to retry.
      </Alert>
    )
  }
  const rows = data ?? []
  if (isLoading && rows.length === 0) {
    return (
      <Card>
        <EmptyState description="Fetching install trust scores…" title="Loading" />
      </Card>
    )
  }
  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState
          description="Once sentori.reportSecurity(...) lands rows here, the worst-scored installs will sort to the top."
          title="No installs with reported security events in the last 24 h"
        />
      </Card>
    )
  }

  return (
    <Card>
      <header className="border-border-muted mb-3 flex items-baseline justify-between border-b pb-2">
        <h2 className="text-fg text-[14px] font-semibold">Lowest trust scores</h2>
        <span className="text-fg-muted font-mono text-[11px] tabular-nums">
          {rows.length} installs
        </span>
      </header>
      <ul>
        {rows.map((r) => (
          <TrustRow key={r.installId} row={r} />
        ))}
      </ul>
    </Card>
  )
}

function TrustRow({ row }: { row: TrustScoreRow }) {
  const tone =
    row.score < 30 ? 'text-danger' : row.score < 70 ? 'text-warning' : 'text-fg-secondary'
  return (
    <li className="border-border-muted grid grid-cols-[5ch_minmax(0,1fr)_auto_auto] items-baseline gap-3 border-b py-2 last:border-b-0">
      <span
        className={`font-mono text-[16px] font-medium tabular-nums ${tone}`}
        title={`Score ${row.score} / 100`}
      >
        {row.score}
      </span>
      <span className="text-fg min-w-0 truncate font-mono text-[12px]">{row.installId}</span>
      <span className="text-fg-muted font-mono text-[11px]">
        {Object.entries(row.kinds)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, n]) => `${k}×${n}`)
          .join(' · ')}
      </span>
      <span className="text-fg-muted font-mono text-[11px] tabular-nums">
        {new Date(row.lastSeen).toLocaleString()}
      </span>
    </li>
  )
}

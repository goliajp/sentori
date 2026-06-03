import { useQuery } from '@tanstack/react-query'

import { adminApi, type PinAnomalyRow, type TrustScoreRow } from '@/api/client'
import { ModuleEmpty } from '@/components/Hint'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { useUrlParam } from '@/lib/url-state'

import { TrustExplorerView } from './explorer-view'
import { FederationView } from './federation-view'

type PostureTab = 'explorer' | 'federation' | 'pin' | 'trust'
const POSTURE_TABS: PostureTab[] = ['explorer', 'federation', 'pin', 'trust']

/**
 * Posture — v1.1 chunks S2 + S3.
 *
 * - Pin (S2): TLS pin mismatches reported by SDK callers.
 * - Trust (S3): lowest-score installs in the last 24h, ordered by
 *   score ascending. The score is a 0–100 weighted sum of security
 *   events per install — operator's eye lands on the worst first.
 *
 * S4's federation explorer adds a third tab here.
 *
 * v2.1 — selected tab persists in `?tab=` URL param so refresh +
 * share keep the same view. Default `pin`.
 */
export function PostureView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [tab, setTab] = useUrlParam<PostureTab>('tab', 'pin', (raw) =>
    POSTURE_TABS.includes(raw as PostureTab) ? (raw as PostureTab) : null
  )

  if (!projectId) {
    return <ModuleEmpty eyebrow="posture">Pick a project to read its security posture.</ModuleEmpty>
  }

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-3">
        <div className="flex items-baseline gap-3">
          <h1
            className="text-fg"
            style={{
              fontSize: '17px',
              fontVariationSettings: "'wdth' 95, 'opsz' 24, 'wght' 550",
              letterSpacing: '-0.01em',
            }}
          >
            Posture
          </h1>
          <TabSwitcher onChange={setTab} tab={tab} />
        </div>
        <p className="text-fg-muted mt-1 font-mono text-[11px]">
          {tab === 'pin' &&
            'TLS pin mismatches reported by SDK callers · last 24h · refreshes every 60s'}
          {tab === 'trust' &&
            'install trust scores (0–100, lower = worse) · last 24h · refreshes every 60s'}
          {tab === 'explorer' &&
            'simulate weight changes · re-scoring happens in-browser via Rust → WebAssembly'}
          {tab === 'federation' &&
            'lookup a federated identity (provider + opaque OAuth subject) across every project in this org'}
        </p>
      </header>

      {tab === 'pin' && <PinAnomalyTable projectId={projectId} />}
      {tab === 'trust' && <TrustScoreTable projectId={projectId} />}
      {tab === 'explorer' && <TrustExplorerView projectId={projectId} />}
      {tab === 'federation' && <FederationView />}
    </div>
  )
}

const TABS: PostureTab[] = ['pin', 'trust', 'explorer', 'federation']
const TAB_LABEL: Record<PostureTab, string> = {
  explorer: 'signal explorer',
  federation: 'federation',
  pin: 'pin anomalies',
  trust: 'trust',
}

function TabSwitcher({ onChange, tab }: { onChange: (t: PostureTab) => void; tab: PostureTab }) {
  return (
    <div className="flex items-baseline gap-3 font-mono text-[11px] tracking-[0.18em] uppercase">
      {TABS.map((t, i) => (
        <span className="flex items-baseline gap-3" key={t}>
          {i > 0 && <span className="text-border">/</span>}
          <button
            className={tab === t ? 'text-accent' : 'text-fg-muted hover:text-fg-secondary'}
            onClick={() => onChange(t)}
            type="button"
          >
            {TAB_LABEL[t]}
          </button>
        </span>
      ))}
    </div>
  )
}

function PinAnomalyTable({ projectId }: { projectId: string }) {
  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    meta: { persist: true },
    placeholderData: (prev) => prev,
    queryFn: () => adminApi.pinAnomalies(projectId, { limit: 100 }),
    queryKey: qk.posture.pinAnomalies(projectId),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  if (isLoading && !data) return <ModuleEmpty eyebrow="posture">Loading…</ModuleEmpty>
  if (error) return <ModuleEmpty eyebrow="posture">Failed to read pin anomalies.</ModuleEmpty>
  const rows = data ?? []
  if (rows.length === 0) {
    return (
      <ModuleEmpty eyebrow="posture">
        {
          'No pin mismatches reported in the last 24h. SDKs running `sentori.reportPinMismatch({ expected, observed, serverName })` will land here.'
        }
      </ModuleEmpty>
    )
  }

  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">Top servers</span>
        <span className="sec-head-sub">{rows.length} servers</span>
      </header>
      <ul className="pt-3">
        {rows.map((r) => (
          <AnomalyRow key={r.serverName ?? '(unknown)'} row={r} />
        ))}
      </ul>
    </section>
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
        className="font-mono text-[12px] tabular-nums"
        style={{ color: suspicious ? 'var(--color-danger)' : 'var(--color-fg-secondary)' }}
      >
        {row.installCount} install{row.installCount === 1 ? '' : 's'}
        {suspicious ? ' ⚠' : ''}
      </span>
    </li>
  )
}

function TrustScoreTable({ projectId }: { projectId: string }) {
  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    meta: { persist: true },
    placeholderData: (prev) => prev,
    queryFn: () => adminApi.trustScores(projectId, { limit: 100 }),
    queryKey: qk.posture.trustScores(projectId),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  if (isLoading && !data) return <ModuleEmpty eyebrow="posture">Loading…</ModuleEmpty>
  if (error) return <ModuleEmpty eyebrow="posture">Failed to read trust scores.</ModuleEmpty>
  const rows = data ?? []
  if (rows.length === 0) {
    return (
      <ModuleEmpty eyebrow="posture">
        No installs with reported security events in the last 24h. Once
        `sentori.reportSecurity(...)` lands rows here, the worst-scored installs will sort to the
        top.
      </ModuleEmpty>
    )
  }

  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">Lowest trust scores</span>
        <span className="sec-head-sub">{rows.length} installs</span>
      </header>
      <ul className="pt-3">
        {rows.map((r) => (
          <TrustRow key={r.installId} row={r} />
        ))}
      </ul>
    </section>
  )
}

function TrustRow({ row }: { row: TrustScoreRow }) {
  const tone =
    row.score < 30
      ? 'var(--color-danger)'
      : row.score < 70
        ? 'var(--color-warning, var(--color-accent))'
        : 'var(--color-fg-secondary)'
  return (
    <li className="border-border-muted grid grid-cols-[5ch_minmax(0,1fr)_auto_auto] items-baseline gap-3 border-b py-2 last:border-b-0">
      <span
        className="font-mono text-[16px] font-medium tabular-nums"
        style={{ color: tone }}
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

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import {
  orgsApi,
  type UsersOverviewBreakdownRow,
  type UsersOverviewResp,
  type UsersOverviewTopRow,
} from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { InlineEmpty, Hint } from '@/components/Hint'
import { Stat } from '@/components/Stat'
import { qk } from '@/api/query-keys'
import { formatRelative } from '@/lib/format'
import { useUrlParam } from '@/lib/url-state'

import { VALID_WINDOW_DAYS } from './window'
import { WindowSwitcher } from './window-switcher'

/**
 * v2.4 — Users page default view.
 *
 * Aggregates over the org's default identity scope: KPI band +
 * most-affected fingerprints + per-release / per-key-type breakdown.
 * Fingerprints render as their 12-char hex prefix; raw identities
 * never appear (privacy contract — see lookup.tsx for full notes).
 */

const DEFAULT_DAYS = 7
const TOP_LIMIT = 30

export function UsersOverview() {
  const { currentOrg } = useOrg()
  const [daysParam, setDaysParam] = useUrlParam<string>('window', String(DEFAULT_DAYS))
  const days = (() => {
    const parsed = Number(daysParam)
    return Number.isFinite(parsed) && VALID_WINDOW_DAYS.has(parsed) ? parsed : DEFAULT_DAYS
  })()
  const onWindowChange = (next: number) => setDaysParam(String(next))

  const { data, error, isLoading } = useQuery<UsersOverviewResp, Error>({
    queryFn: () => orgsApi.usersOverview(currentOrg.slug, { days, limit: TOP_LIMIT }),
    queryKey: qk.users.overview(currentOrg.slug, days),
    staleTime: 60_000,
  })

  if (isLoading && !data) {
    return (
      <Container days={days} onWindowChange={onWindowChange}>
        <Hint>Loading identified-user overview…</Hint>
      </Container>
    )
  }
  if (error) {
    return (
      <Container days={days} onWindowChange={onWindowChange}>
        <Hint danger>Failed to load users overview.</Hint>
      </Container>
    )
  }
  if (!data) return null

  const { kpi, top, breakdown, windowDays } = data
  const everEmpty =
    kpi.identifiedUsers === 0 &&
    top.length === 0 &&
    breakdown.byRelease.length === 0 &&
    breakdown.byKeyType.length === 0

  if (everEmpty) {
    return (
      <Container days={days} onWindowChange={onWindowChange}>
        <InlineEmpty>
          No identified users yet in this org over the last {windowDays} day
          {windowDays === 1 ? '' : 's'}.
          <br />
          <span className="text-fg-muted font-mono text-[11px]">
            (SDKs need a call to{' '}
            <code>
              setUser({'{'} identities: {'{'} … {'}'} {'}'})
            </code>{' '}
            for users to surface here.)
          </span>
        </InlineEmpty>
      </Container>
    )
  }

  return (
    <Container days={days} onWindowChange={onWindowChange}>
      <section aria-label="kpi" className="border-border grid grid-cols-1 border-y sm:grid-cols-3">
        <Stat
          label={`identified · ${windowDays}d`}
          sub="distinct fingerprints"
          value={kpi.identifiedUsers.toLocaleString()}
        />
        <Stat
          highlight={kpi.affectedUsers > 0}
          label={`affected · ${windowDays}d`}
          sub="any error / anr / nearCrash"
          value={kpi.affectedUsers.toLocaleString()}
        />
        <Stat
          label="crash-free"
          sub={`${kpi.affectedUsers} / ${kpi.identifiedUsers} affected`}
          value={`${(kpi.crashFreeRatio * 100).toFixed(1)}%`}
        />
      </section>

      <section>
        <header className="border-border mb-3 flex items-baseline justify-between border-b pb-2">
          <span className="text-accent font-mono text-[10px] tracking-[0.22em] uppercase">
            most affected · last {windowDays}d
          </span>
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            top {top.length}
          </span>
        </header>
        <TopList orgSlug={currentOrg.slug} rows={top} />
      </section>

      <section className="grid grid-cols-1 gap-x-8 gap-y-6 md:grid-cols-2">
        <BreakdownCard rows={breakdown.byRelease} title="By release" />
        <BreakdownCard rows={breakdown.byKeyType} title="By identity type" />
      </section>
    </Container>
  )
}

function Container({
  children,
  days,
  onWindowChange,
}: {
  children: React.ReactNode
  days: number
  onWindowChange: (next: number) => void
}) {
  return (
    <div className="space-y-8">
      <div className="border-border flex items-baseline justify-end border-b pb-2">
        <WindowSwitcher onChange={onWindowChange} value={days} />
      </div>
      {children}
    </div>
  )
}

function TopList({ orgSlug, rows }: { orgSlug: string; rows: UsersOverviewTopRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-fg-muted py-4 text-center font-mono text-[11px]">
        no identified user activity in this window.
      </p>
    )
  }
  return (
    <table className="bench">
      <thead>
        <tr>
          <th>fingerprint</th>
          <th>type</th>
          <th className="num">events</th>
          <th className="num">issues</th>
          <th>primary release</th>
          <th>primary os</th>
          <th className="num">last seen</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.fingerprintHex}>
            <td className="lead">
              <Link
                className="text-fg hover:text-accent"
                to={`/main/org/${orgSlug}/users/${r.fingerprintHex}`}
              >
                <span className="font-mono text-[11px]">{r.fingerprintHex.slice(0, 12)}…</span>
              </Link>
            </td>
            <td className="text-fg-secondary font-mono text-[11px]">{r.keyType}</td>
            <td className="num tabular-nums">{r.eventCount.toLocaleString()}</td>
            <td className="num tabular-nums">{r.issueCount.toLocaleString()}</td>
            <td className="font-mono text-[11px]">{r.primaryRelease ?? '—'}</td>
            <td className="font-mono text-[11px]">{r.primaryOs ?? '—'}</td>
            <td className="num">{formatRelative(r.lastSeen)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function BreakdownCard({ rows, title }: { rows: UsersOverviewBreakdownRow[]; title: string }) {
  return (
    <div>
      <header className="border-border mb-2 flex items-baseline justify-between border-b pb-1">
        <span className="text-accent font-mono text-[10px] tracking-[0.22em] uppercase">
          {title}
        </span>
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          top {Math.min(rows.length, 5)}
        </span>
      </header>
      {rows.length === 0 ? (
        <p className="text-fg-muted py-2 font-mono text-[11px]">no data yet</p>
      ) : (
        <ul>
          {rows.slice(0, 5).map((r) => {
            const max = Math.max(...rows.map((x) => x.fingerprintCount), 1)
            const pct = (r.fingerprintCount / max) * 100
            return (
              <li
                key={r.label}
                className="border-border/40 flex items-baseline gap-3 border-b py-1.5 last:border-b-0"
              >
                <span className="text-fg min-w-0 flex-1 truncate font-mono text-[12px]">
                  {r.label}
                </span>
                <span className="text-fg-secondary font-mono text-[11px] tabular-nums">
                  {r.fingerprintCount.toLocaleString()}
                </span>
                <span
                  aria-hidden
                  className="bg-accent block h-[2px] basis-[80px]"
                  style={{ opacity: 0.25 + (pct / 100) * 0.6, width: `${pct}%` }}
                />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// v0.9.2 +S6 — Privacy Lab dashboard.
//
// Top: big "Privacy Score" gauge for the current release + risk tag
// + breakdown by PII kind. Bottom: top leaking field paths + a recent
// findings table. One-click "add mask rule" deferred to v1.0 (needs
// a server-side scrubber config endpoint we don't have yet).

import { useQuery } from '@tanstack/react-query'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

export function PrivacyView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const scoreQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.privacyScore(projectId!),
    queryKey: ['privacy-score', projectId],
  })
  const findingsQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.privacyFindings(projectId!, { limit: 50 }),
    queryKey: ['privacy-findings', projectId],
  })

  const score = scoreQ.data
  const findings = findingsQ.data ?? []

  const riskTone: Record<string, string> = {
    high: 'text-danger',
    low: 'text-success',
    medium: 'text-warning',
  }

  return (
    <div className="space-y-4">
      <section className="border-border rounded-md border">
        <header className="border-border bg-bg-tertiary/60 border-b px-3 py-2">
          <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">
            Privacy Score (per release)
          </span>
        </header>
        {scoreQ.isLoading && <div className="text-fg-muted t-md px-3 py-3">Loading…</div>}
        {score && (
          <div className="grid grid-cols-3 gap-4 p-4">
            <div>
              <div className="text-fg-muted t-sm">release</div>
              <div className="text-fg t-md font-mono">{score.release}</div>
            </div>
            <div>
              <div className="text-fg-muted t-sm">score</div>
              <div className={`text-fg t-lg font-mono tabular-nums ${riskTone[score.risk] ?? ''}`}>
                {score.score} / 100
              </div>
              <div className={`t-sm font-mono uppercase ${riskTone[score.risk] ?? ''}`}>
                {score.risk} risk
              </div>
            </div>
            <div>
              <div className="text-fg-muted t-sm">leaks</div>
              <div className="text-fg t-md font-mono">
                {score.leakingEvents.toLocaleString()} / {score.totalEvents.toLocaleString()} events
              </div>
              <div className="text-fg-muted t-sm">
                {Object.entries(score.leaksByKind)
                  .map(([k, v]) => `${k}=${v}`)
                  .join(' · ') || '—'}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="border-border rounded-md border">
        <header className="border-border bg-bg-tertiary/60 border-b px-3 py-2">
          <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">
            Top leaking surfaces
          </span>
        </header>
        {!score || score.topFields.length === 0 ? (
          <div className="text-fg-muted t-md px-3 py-3">
            No leaks observed in the current release. Good.
          </div>
        ) : (
          <table className="std-table w-full">
            <thead>
              <tr>
                <th>field</th>
                <th>kind</th>
                <th>occurrences</th>
              </tr>
            </thead>
            <tbody>
              {score.topFields.map((f, i) => (
                <tr key={`${f.fieldPath}-${f.kind}-${i}`}>
                  <td className="font-mono">{f.fieldPath}</td>
                  <td>{f.kind}</td>
                  <td className="tabular-nums">{f.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="border-border rounded-md border">
        <header className="border-border bg-bg-tertiary/60 border-b px-3 py-2">
          <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">
            Recent findings (50 most-recent)
          </span>
        </header>
        {findings.length === 0 ? (
          <div className="text-fg-muted t-md px-3 py-3">No findings yet.</div>
        ) : (
          <table className="std-table w-full">
            <thead>
              <tr>
                <th>seen</th>
                <th>release</th>
                <th>field</th>
                <th>kind</th>
                <th>sample</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((f) => (
                <tr key={f.id}>
                  <td className="font-mono tabular-nums">{formatRelative(f.seenAt)}</td>
                  <td className="font-mono">{f.release}</td>
                  <td className="font-mono">{f.fieldPath}</td>
                  <td>{f.patternKind}</td>
                  <td className="font-mono">{f.sample}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

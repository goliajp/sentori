// v0.9.2 +S6 — Privacy Lab dashboard.
//
// Score + risk + leak breakdown at top; "top leaking surfaces" middle;
// recent findings tail. One-click "add mask rule" deferred to v1.0
// (needs a server-side scrubber config endpoint we don't have yet).

import { useQuery } from '@tanstack/react-query'

import { adminApi } from '@/api/client'
import { EmptyState } from '@/components/Hint'
import { SubSection } from '@/components/SubSection'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'
import { qk } from '@/api/query-keys'

export function PrivacyView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const scoreQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.privacyScore(projectId!),
    queryKey: qk.privacy.score(projectId),
  })
  const findingsQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.privacyFindings(projectId!, { limit: 50 }),
    queryKey: qk.privacy.findings(projectId),
  })

  const score = scoreQ.data
  const findings = findingsQ.data ?? []

  const riskTone: Record<string, string> = {
    high: 'text-danger',
    low: 'text-success',
    medium: 'text-warning',
  }

  return (
    <div className="sentori-page-in">
      <PageHeader
        subtitle={score?.release ? `release · ${score.release}` : 'per-release scan'}
        title="Privacy"
      />

      {scoreQ.isLoading && <EmptyState>Computing score for the most-recent release…</EmptyState>}
      {(scoreQ.isError || findingsQ.isError) && (
        <EmptyState danger>Failed to load privacy data. Refresh to retry.</EmptyState>
      )}

      {score && (
        <div className="rule-grid grid-cols-1 sm:grid-cols-3">
          <ScoreCell label="release">
            <span className="text-fg font-mono text-[18px]">{score.release}</span>
          </ScoreCell>
          <ScoreCell label="score">
            <div className={`tabular-nums ${riskTone[score.risk] ?? 'text-fg'}`}>
              {score.score}
              <span className="text-fg-muted ml-1 text-[20px]">/100</span>
            </div>
            <div
              className={`mt-1.5 font-mono text-[11px] tracking-[0.2em] uppercase ${
                riskTone[score.risk] ?? 'text-fg-muted'
              }`}
            >
              {score.risk} risk
            </div>
          </ScoreCell>
          <ScoreCell label="leaks">
            <div className="text-fg tabular-nums">
              {score.leakingEvents.toLocaleString()}
              <span className="text-fg-muted"> / {score.totalEvents.toLocaleString()}</span>
            </div>
            <div className="text-fg-muted mt-1.5 font-mono text-[11px] tracking-[0.05em]">
              {Object.entries(score.leaksByKind)
                .map(([k, v]) => `${k}=${v}`)
                .join(' · ') || '—'}
            </div>
          </ScoreCell>
        </div>
      )}

      <SubSection sub={`${score?.topFields.length ?? 0} surfaces`} title="Top leaking surfaces">
        {!score || score.topFields.length === 0 ? (
          <EmptyState>No leaks observed in the current release. Good.</EmptyState>
        ) : (
          <table className="bench">
            <thead>
              <tr>
                <th>field</th>
                <th>kind</th>
                <th className="num">occurrences</th>
              </tr>
            </thead>
            <tbody>
              {score.topFields.map((f, i) => (
                <tr key={`${f.fieldPath}-${f.kind}-${i}`}>
                  <td className="lead">{f.fieldPath}</td>
                  <td>{f.kind}</td>
                  <td className="num">{f.count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SubSection>

      <SubSection sub="50 most recent" title="Recent findings">
        {findings.length === 0 ? (
          <EmptyState>No findings yet.</EmptyState>
        ) : (
          <table className="bench">
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
                  <td className="num">{formatRelative(f.seenAt)}</td>
                  <td>{f.release}</td>
                  <td className="lead">{f.fieldPath}</td>
                  <td>{f.patternKind}</td>
                  <td className="text-fg-secondary max-w-[40ch] truncate">{f.sample}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SubSection>
    </div>
  )
}

function ScoreCell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="rule-cell">
      <div className="t-tag">{label}</div>
      <div
        className="text-fg mt-3"
        style={{
          fontVariationSettings: "'wdth' 100, 'opsz' 48, 'wght' 550",
          fontSize: '32px',
          letterSpacing: '-0.016em',
          lineHeight: 1.05,
        }}
      >
        {children}
      </div>
    </div>
  )
}

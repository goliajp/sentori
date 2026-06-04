import { Alert, Card, DataTable, EmptyState, PageHeader } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'

import { adminApi } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

type TopField = { fieldPath: string; kind: string; count: number }
type Finding = {
  id: string
  seenAt: string
  release: string
  fieldPath: string
  patternKind: string
  sample: string
}

/**
 * Privacy Lab — score + risk strip on top, top leaking surfaces +
 * recent findings as stacked DataTables underneath. Score / risk /
 * leak count live in three GDS Cards (the score Card colors itself
 * by risk tier).
 */
export function PrivacyView() {
  const { currentOrg, currentProject } = useOrg()
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
  const findings = (findingsQ.data ?? []) as Finding[]
  const topFields = (score?.topFields ?? []) as TopField[]

  const riskTone: Record<string, string> = {
    high: 'text-danger',
    low: 'text-success',
    medium: 'text-warning',
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
          { label: 'privacy' },
        ]}
        subtitle={score?.release ? `Per-release scan · ${score.release}` : 'per-release scan'}
        title="Privacy"
      />

      {(scoreQ.isError || findingsQ.isError) && (
        <Alert title="Failed to load privacy data" variant="danger">
          Refresh to retry.
        </Alert>
      )}

      {scoreQ.isLoading && !score && (
        <Card>
          <EmptyState description="Computing score for the most-recent release…" title="Loading" />
        </Card>
      )}

      {score && (
        <div className="grid gap-3 sm:grid-cols-3">
          <ScoreCard label="release">
            <span className="text-fg font-mono text-[18px]">{score.release}</span>
          </ScoreCard>
          <ScoreCard label="score">
            <div className={`tabular-nums ${riskTone[score.risk] ?? 'text-fg'}`}>
              <span className="text-[28px] font-semibold">{score.score}</span>
              <span className="text-fg-muted ml-1 text-[16px]">/100</span>
            </div>
            <div
              className={`mt-1 font-mono text-[10px] tracking-[0.2em] uppercase ${
                riskTone[score.risk] ?? 'text-fg-muted'
              }`}
            >
              {score.risk} risk
            </div>
          </ScoreCard>
          <ScoreCard label="leaks">
            <div className="text-fg tabular-nums">
              <span className="text-[24px] font-semibold">
                {score.leakingEvents.toLocaleString()}
              </span>
              <span className="text-fg-muted text-[14px]">
                {' '}
                / {score.totalEvents.toLocaleString()}
              </span>
            </div>
            <div className="text-fg-muted mt-1 font-mono text-[10px]">
              {Object.entries(score.leaksByKind)
                .map(([k, v]) => `${k}=${v}`)
                .join(' · ') || '—'}
            </div>
          </ScoreCard>
        </div>
      )}

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Top leaking surfaces</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {topFields.length} surfaces
          </span>
        </header>
        {topFields.length === 0 ? (
          <EmptyState
            description="No leaks observed in the current release. Good."
            title="All clear"
          />
        ) : (
          <DataTable<TopField>
            columns={[
              {
                key: 'fieldPath',
                label: 'Field',
                render: (_v, f) => (
                  <span className="text-fg font-mono text-[12px]">{f.fieldPath}</span>
                ),
              },
              {
                key: 'kind',
                label: 'Kind',
                width: '160px',
                render: (_v, f) => (
                  <span className="text-fg-secondary font-mono text-[12px]">{f.kind}</span>
                ),
              },
              {
                align: 'right',
                key: 'count',
                label: 'Occurrences',
                sortable: true,
                width: '130px',
                render: (_v, f) => (
                  <span className="text-fg font-mono text-[12px] tabular-nums">
                    {f.count.toLocaleString()}
                  </span>
                ),
              },
            ]}
            density="compact"
            rowKey={(f) => `${f.fieldPath}-${f.kind}`}
            rows={topFields}
            striped
          />
        )}
      </Card>

      <Card>
        <header className="border-border/40 mb-3 flex items-baseline justify-between border-b pb-2">
          <h2 className="text-fg text-[14px] font-semibold">Recent findings</h2>
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">50 most recent</span>
        </header>
        {findings.length === 0 ? (
          <EmptyState
            description="Privacy patterns surface here as the scan picks them up."
            title="No findings yet"
          />
        ) : (
          <DataTable<Finding>
            columns={[
              {
                key: 'seenAt',
                label: 'Seen',
                width: '130px',
                render: (_v, f) => (
                  <span className="text-fg-muted font-mono text-[11px] tabular-nums">
                    {formatRelative(f.seenAt)}
                  </span>
                ),
              },
              {
                key: 'release',
                label: 'Release',
                width: '140px',
                render: (_v, f) => (
                  <span className="text-fg-muted font-mono text-[11px]">{f.release}</span>
                ),
              },
              {
                key: 'fieldPath',
                label: 'Field',
                render: (_v, f) => (
                  <span className="text-fg font-mono text-[12px]">{f.fieldPath}</span>
                ),
              },
              {
                key: 'patternKind',
                label: 'Kind',
                width: '120px',
                render: (_v, f) => (
                  <span className="text-fg-secondary font-mono text-[11px]">{f.patternKind}</span>
                ),
              },
              {
                key: 'sample',
                label: 'Sample',
                render: (_v, f) => (
                  <span className="text-fg-secondary max-w-[40ch] truncate text-[12px]">
                    {f.sample}
                  </span>
                ),
              },
            ]}
            density="compact"
            rowKey="id"
            rows={findings}
            striped
          />
        )}
      </Card>
    </div>
  )
}

function ScoreCard({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <Card>
      <div className="flex flex-col gap-2">
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.22em] uppercase">
          {label}
        </span>
        <div>{children}</div>
      </div>
    </Card>
  )
}

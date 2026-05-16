import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'

export function TraceDetailView() {
  const { traceId } = useParams<{ traceId: string }>()
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId && !!traceId,
    queryFn: () => adminApi.getTraceDetail(projectId!, traceId!),
    queryKey: ['trace-detail', projectId, traceId],
  })

  if (!projectId || !traceId) return null

  const trace = data?.trace

  return (
    <div className="sentori-page-in space-y-4">
      <Link
        className="inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink-muted)] uppercase transition-colors hover:text-[color:var(--accent)]"
        to={`/org/${currentOrg.slug}/traces`}
      >
        ← back to traces
      </Link>

      <header>
        <div className="font-mono text-[11px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
          trace
        </div>
        <h1
          className="mt-1 text-[color:var(--ink)]"
          style={{
            fontFamily: 'var(--font-sans)',
            fontVariationSettings: "'wdth' 95, 'opsz' 48, 'wght' 600",
            fontSize: '26px',
            letterSpacing: '-0.018em',
            lineHeight: 1.05,
          }}
        >
          {trace?.rootOp ?? trace?.rootName ?? `trace ${traceId.slice(0, 8)}`}
        </h1>
        <div className="mt-2 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink-muted)]">
          {traceId}
        </div>
      </header>

      {isLoading && <Hint>Loading trace…</Hint>}
      {error && <Hint>Failed to load this trace.</Hint>}
      {data && (
        <>
          <div className="rule-grid grid-cols-3">
            <Stat label="spans" value={<span className="tabular-nums">{data.spans.length}</span>} />
            <Stat
              label="duration"
              value={
                <span className="tabular-nums">
                  {data.trace.durationMs >= 1000
                    ? `${(data.trace.durationMs / 1000).toFixed(2)}s`
                    : `${Math.round(data.trace.durationMs)}ms`}
                </span>
              }
            />
            <Stat highlight={data.trace.status !== 'ok'} label="status" value={data.trace.status} />
          </div>

          <table className="bench mt-2">
            <thead>
              <tr>
                <th>op</th>
                <th>name</th>
                <th className="num">duration</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {data.spans.map((s) => (
                <tr key={s.id}>
                  <td className="text-[color:var(--ink-soft)]">{s.op}</td>
                  <td className="lead">{s.name}</td>
                  <td className="num">{s.durationMs.toLocaleString()}ms</td>
                  <td
                    className={
                      s.status === 'ok'
                        ? undefined
                        : s.status === 'error'
                          ? 'text-[color:var(--danger)]'
                          : 'text-[color:var(--ink-muted)]'
                    }
                  >
                    {s.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

function Stat({
  highlight,
  label,
  value,
}: {
  highlight?: boolean
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="rule-cell">
      <div className="t-tag">{label}</div>
      <div
        className={highlight ? 'text-[color:var(--accent)]' : 'text-[color:var(--ink)]'}
        style={{
          fontFamily: 'var(--font-sans)',
          fontVariationSettings: "'wdth' 100, 'opsz' 48, 'wght' 550",
          fontSize: '28px',
          letterSpacing: '-0.014em',
          marginTop: '12px',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
    </div>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-y border-[color:var(--rule)] py-6 text-center text-[13px] text-[color:var(--ink-soft)]">
      {children}
    </p>
  )
}

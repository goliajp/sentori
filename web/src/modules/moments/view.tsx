// v0.9.0 #6 — Moments dashboard.

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi } from '@/api/client'
import { RailEmpty, CenteredEmpty } from '@/components/Hint'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'
import { qk } from '@/api/query-keys'

export function MomentsView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [selected, setSelected] = useState<null | string>(null)

  const namesQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listMoments(projectId!),
    queryKey: qk.moments.list(projectId),
  })
  const samplesQ = useQuery({
    enabled: !!projectId && !!selected,
    queryFn: () => adminApi.listMomentSamples(projectId!, selected!),
    queryKey: qk.moments.samples(projectId, selected),
  })

  const names = namesQ.data ?? []
  const samples = samplesQ.data ?? []

  return (
    <div className="bg-bg -mx-4 -my-3 flex h-[calc(100%+1.5rem)] min-h-0 overflow-hidden">
      <aside className="border-border bg-bg-secondary flex w-[20rem] shrink-0 flex-col overflow-hidden border-r">
        <header className="border-border shrink-0 border-b px-4 py-3">
          <h1
            className="text-fg"
            style={{
              fontVariationSettings: "'wdth' 95, 'opsz' 24, 'wght' 550",
              fontSize: '17px',
              letterSpacing: '-0.01em',
            }}
          >
            Moments
          </h1>
          <div className="text-fg-muted mt-1 font-mono text-[11px] tracking-[0.08em] uppercase">
            last 7 days
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {namesQ.isLoading && <RailEmpty>Loading…</RailEmpty>}
          {namesQ.isError && <RailEmpty>Failed to load moments. Refresh to retry.</RailEmpty>}
          {!namesQ.isLoading && !namesQ.isError && names.length === 0 && (
            <RailEmpty>
              Call sentori.startMoment('checkout').end() to start collecting flow durations.
            </RailEmpty>
          )}
          {names.map((n) => {
            const abandonPct = n.count > 0 ? Math.round((n.abandoned / n.count) * 100) : 0
            const active = selected === n.name
            return (
              <button
                className={`border-border/40 relative block w-full border-b px-4 py-2.5 text-left transition-colors ${
                  active ? 'bg-accent/10' : 'hover:bg-bg'
                }`}
                key={n.name}
                onClick={() => setSelected(n.name)}
                type="button"
              >
                <span
                  aria-hidden
                  className={`absolute top-0 bottom-0 left-0 w-[2px] ${active ? 'bg-accent' : 'bg-transparent'}`}
                />
                <div className="text-fg font-mono text-[13px]">{n.name}</div>
                <div className="text-fg-muted mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[10px] tracking-[0.05em] tabular-nums">
                  <span>{n.count.toLocaleString()}×</span>
                  <span aria-hidden className="opacity-40">
                    /
                  </span>
                  <span>
                    p50 {n.p50Ms}ms · p95 {n.p95Ms}ms
                  </span>
                  {n.abandoned > 0 && (
                    <>
                      <span aria-hidden className="opacity-40">
                        /
                      </span>
                      <span className="text-warning">{abandonPct}% abn</span>
                    </>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="bg-bg min-w-0 flex-1 overflow-y-auto">
        {!selected && (
          <CenteredEmpty eyebrow="No moment selected">
            Pick a moment on the left to see its samples.
          </CenteredEmpty>
        )}
        {selected && samplesQ.isLoading && <CenteredEmpty>Loading samples…</CenteredEmpty>}
        {selected && !samplesQ.isLoading && samples.length > 0 && (
          <div className="space-y-4 p-6">
            <header>
              <div className="text-accent font-mono text-[11px] tracking-[0.18em] uppercase">
                moment
              </div>
              <h2 className="text-fg mt-1 font-mono text-[20px]">{selected}</h2>
            </header>
            <table className="bench">
              <thead>
                <tr>
                  <th>started</th>
                  <th className="num">duration</th>
                  <th>status</th>
                  <th>abandoned</th>
                </tr>
              </thead>
              <tbody>
                {samples.map((s) => (
                  <tr key={s.id}>
                    <td className="num">{formatRelative(s.startedAt)}</td>
                    <td className="num">{s.durationMs.toLocaleString()} ms</td>
                    <td className={s.status === 'error' ? 'text-danger' : undefined}>{s.status}</td>
                    <td>{s.abandoned ? 'yes' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

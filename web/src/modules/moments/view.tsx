// v0.9.0 #6 — Moments dashboard.

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

export function MomentsView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [selected, setSelected] = useState<null | string>(null)

  const namesQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listMoments(projectId!),
    queryKey: ['moments', projectId],
  })
  const samplesQ = useQuery({
    enabled: !!projectId && !!selected,
    queryFn: () => adminApi.listMomentSamples(projectId!, selected!),
    queryKey: ['moment-samples', projectId, selected],
  })

  const names = namesQ.data ?? []
  const samples = samplesQ.data ?? []

  return (
    <div className="-mx-4 -my-3 flex h-[calc(100%+1.5rem)] min-h-0 overflow-hidden bg-[color:var(--paper)]">
      <aside className="flex w-[20rem] shrink-0 flex-col overflow-hidden border-r border-[color:var(--rule)] bg-[color:var(--paper-2)]">
        <header className="shrink-0 border-b border-[color:var(--rule)] px-4 py-3">
          <h1
            className="text-[color:var(--ink)]"
            style={{
              fontFamily: 'var(--font-sans)',
              fontVariationSettings: "'wdth' 80, 'opsz' 24, 'wght' 700",
              fontSize: '17px',
              letterSpacing: '-0.018em',
            }}
          >
            Moments
          </h1>
          <div className="mt-1 font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink-muted)] uppercase">
            last 7 days
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {namesQ.isLoading && <RailEmpty hint="Loading…" />}
          {!namesQ.isLoading && names.length === 0 && (
            <RailEmpty hint="Call sentori.startMoment('checkout').end() to start collecting flow durations." />
          )}
          {names.map((n) => {
            const abandonPct = n.count > 0 ? Math.round((n.abandoned / n.count) * 100) : 0
            const active = selected === n.name
            return (
              <button
                className={`relative block w-full border-b border-[color:var(--rule-soft)] px-4 py-2.5 text-left transition-colors ${
                  active ? 'bg-[color:var(--accent-soft)]' : 'hover:bg-[color:var(--paper)]'
                }`}
                key={n.name}
                onClick={() => setSelected(n.name)}
                type="button"
              >
                <span
                  aria-hidden
                  className={`absolute top-0 bottom-0 left-0 w-[2px] ${active ? 'bg-[color:var(--accent)]' : 'bg-transparent'}`}
                />
                <div className="font-mono text-[13px] text-[color:var(--ink)]">{n.name}</div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-[10px] tracking-[0.05em] text-[color:var(--ink-muted)] tabular-nums">
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
                      <span className="text-[color:var(--warning)]">{abandonPct}% abn</span>
                    </>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto bg-[color:var(--paper)]">
        {!selected && (
          <Placeholder
            hint="Pick a moment on the left to see its samples."
            title="No moment selected"
          />
        )}
        {selected && samplesQ.isLoading && <Placeholder hint="Loading samples…" title="" />}
        {selected && !samplesQ.isLoading && samples.length > 0 && (
          <div className="space-y-4 p-6">
            <header>
              <div className="font-mono text-[11px] tracking-[0.18em] text-[color:var(--accent)] uppercase">
                moment
              </div>
              <h2 className="mt-1 font-mono text-[20px] text-[color:var(--ink)]">{selected}</h2>
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
                    <td className={s.status === 'error' ? 'text-[color:var(--danger)]' : undefined}>
                      {s.status}
                    </td>
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

function RailEmpty({ hint }: { hint: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <div className="mb-2 font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
        empty
      </div>
      <div className="mx-auto max-w-[24ch] text-[13px] leading-relaxed text-[color:var(--ink-soft)]">
        {hint}
      </div>
    </div>
  )
}

function Placeholder({ hint, title }: { hint: string; title: string }) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="text-center">
        {title && (
          <div className="mb-2 font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
            {title}
          </div>
        )}
        <div className="text-[13px] text-[color:var(--ink-soft)]">{hint}</div>
      </div>
    </div>
  )
}

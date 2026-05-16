// v0.9.0 #6 — Moments dashboard.
//
// Top: list of all moment names seen in the last 7 days with count /
// abandonment rate / p50 / p95. Left rail style. Bottom: samples of
// the selected moment with timestamp + duration + status.

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
    <div className="flex h-full min-h-0 gap-3">
      <aside className="border-border h-full w-80 shrink-0 overflow-y-auto rounded-md border">
        <header className="border-border bg-bg-tertiary/60 sticky top-0 border-b px-3 py-2">
          <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">
            Moments (last 7d)
          </span>
        </header>
        {namesQ.isLoading && <div className="text-fg-muted t-md px-3 py-3">Loading…</div>}
        {!namesQ.isLoading && names.length === 0 && (
          <div className="text-fg-muted t-md px-3 py-3">
            Call <code>sentori.startMoment('checkout').end()</code> from your host app to start
            collecting flow durations + abandonment.
          </div>
        )}
        <ul className="divide-border divide-y">
          {names.map((n) => {
            const abandonPct = n.count > 0 ? Math.round((n.abandoned / n.count) * 100) : 0
            return (
              <li key={n.name}>
                <button
                  className={`hover:bg-bg-tertiary/40 w-full px-3 py-2 text-left ${
                    selected === n.name ? 'bg-bg-tertiary/60' : ''
                  }`}
                  onClick={() => setSelected(n.name)}
                  type="button"
                >
                  <div className="t-md text-fg font-medium">{n.name}</div>
                  <div className="text-fg-muted t-sm flex items-center gap-2 tabular-nums">
                    <span>{n.count}</span>
                    <span>·</span>
                    <span>
                      p50 {n.p50Ms}ms · p95 {n.p95Ms}ms
                    </span>
                    {n.abandoned > 0 && <span className="text-warning">· {abandonPct}% abn</span>}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>
      <main className="flex-1 overflow-auto">
        {!selected && <div className="text-fg-muted t-md p-3">Pick a moment on the left.</div>}
        {selected && samplesQ.isLoading && (
          <div className="text-fg-muted t-md p-3">Loading samples…</div>
        )}
        {selected && !samplesQ.isLoading && samples.length > 0 && (
          <table className="std-table w-full">
            <thead>
              <tr>
                <th>started</th>
                <th>duration</th>
                <th>status</th>
                <th>abandoned</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => (
                <tr key={s.id}>
                  <td className="font-mono tabular-nums">{formatRelative(s.startedAt)}</td>
                  <td className="tabular-nums">{s.durationMs} ms</td>
                  <td className={s.status === 'error' ? 'text-danger' : ''}>{s.status}</td>
                  <td>{s.abandoned ? 'yes' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  )
}

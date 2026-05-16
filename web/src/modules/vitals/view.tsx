// v0.9.4 #1 — Mobile Vitals dashboard.
//
// Top: release picker + cold-start p50/p95.
// Bottom: per-route table — TTID p50/p95 / TTFD p50/p95 / slow + frozen
// frame totals.
//
// All numbers from spans table aggregations (server/src/api/vitals.rs).

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { formatRelative } from '@/lib/format'

export function VitalsView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [release, setRelease] = useState<null | string>(null)

  const releasesQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listVitalsReleases(projectId!),
    queryKey: ['vitals-releases', projectId],
  })
  const reportQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.vitalsReport(projectId!, release ?? undefined),
    queryKey: ['vitals-report', projectId, release],
  })

  const releases = releasesQ.data ?? []
  const report = reportQ.data

  return (
    <div className="space-y-3">
      <section className="border-border rounded-md border">
        <header className="border-border bg-bg-tertiary/60 flex items-center justify-between border-b px-3 py-2">
          <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">
            Mobile Vitals (last 7d)
          </span>
          <select
            className="border-border bg-bg-tertiary text-fg t-sm rounded border px-2 py-1 font-mono"
            onChange={(e) => setRelease(e.target.value || null)}
            value={release ?? ''}
          >
            <option value="">— pick release —</option>
            {releases.map((r) => (
              <option key={r.release} value={r.release}>
                {r.release} · {r.eventCount} events · {formatRelative(r.lastSeen)}
              </option>
            ))}
          </select>
        </header>
        {report && (
          <div className="grid grid-cols-3 gap-4 p-4">
            <div>
              <div className="text-fg-muted t-sm">release</div>
              <div className="text-fg t-md font-mono">{report.release}</div>
            </div>
            <div>
              <div className="text-fg-muted t-sm">cold start</div>
              {report.coldStart.samples > 0 ? (
                <>
                  <div className="text-fg t-lg font-mono tabular-nums">
                    {report.coldStart.p50Ms}ms
                    <span className="text-fg-muted t-sm ml-2">p50</span>
                  </div>
                  <div className="text-fg-muted t-sm font-mono tabular-nums">
                    p95 {report.coldStart.p95Ms}ms · {report.coldStart.samples} samples
                  </div>
                </>
              ) : (
                <div className="text-fg-muted t-sm">No samples — SDK needs 0.8.6+ + reinstall</div>
              )}
            </div>
            <div>
              <div className="text-fg-muted t-sm">routes</div>
              <div className="text-fg t-md font-mono tabular-nums">
                {report.perRoute.length}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="border-border rounded-md border">
        <header className="border-border bg-bg-tertiary/60 border-b px-3 py-2">
          <span className="text-fg-muted t-sm font-semibold tracking-wider uppercase">
            Per-route vitals
          </span>
        </header>
        {!report || report.perRoute.length === 0 ? (
          <div className="text-fg-muted t-md px-3 py-3">
            No route vitals yet. Mount{' '}
            <code className="font-mono">useTraceNavigation(navigationRef)</code> in your app
            and pick a release with traffic.
          </div>
        ) : (
          <table className="std-table w-full">
            <thead>
              <tr>
                <th>route</th>
                <th>navigations</th>
                <th>TTID p50</th>
                <th>TTID p95</th>
                <th>TTFD p50</th>
                <th>TTFD p95</th>
                <th>slow frames</th>
                <th>frozen frames</th>
              </tr>
            </thead>
            <tbody>
              {report.perRoute.map((r) => (
                <tr key={r.route}>
                  <td className="font-mono">{r.route}</td>
                  <td className="tabular-nums">{r.navigations}</td>
                  <td className="tabular-nums">{r.ttidP50Ms}ms</td>
                  <td className="tabular-nums">{r.ttidP95Ms}ms</td>
                  <td className="tabular-nums">
                    {r.ttfdSamples > 0 ? `${r.ttfdP50Ms}ms` : '—'}
                  </td>
                  <td className="tabular-nums">
                    {r.ttfdSamples > 0 ? `${r.ttfdP95Ms}ms` : '—'}
                  </td>
                  <td className={`tabular-nums ${r.totalSlowFrames > 0 ? 'text-warning' : ''}`}>
                    {r.totalSlowFrames}
                  </td>
                  <td className={`tabular-nums ${r.totalFrozenFrames > 0 ? 'text-danger' : ''}`}>
                    {r.totalFrozenFrames}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

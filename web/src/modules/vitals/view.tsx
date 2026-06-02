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
import { Stat } from '@/components/Stat'
import { EmptyState } from '@/components/Hint'
import { SubSection } from '@/components/SubSection'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'
import { formatRelative } from '@/lib/format'
import { qk } from '@/api/query-keys'

export function VitalsView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const [release, setRelease] = useState<null | string>(null)

  const releasesQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listVitalsReleases(projectId!),
    queryKey: qk.vitals.releases(projectId),
  })
  const reportQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.vitalsReport(projectId!, release ?? undefined),
    queryKey: qk.vitals.report(projectId, release),
  })

  const releases = releasesQ.data ?? []
  const report = reportQ.data

  return (
    <div className="sentori-page-in">
      <PageHeader
        actions={
          <select
            aria-label="Release"
            className="border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 py-1 font-mono text-[12px] text-[color:var(--ink)] focus:border-[color:var(--accent)] focus:outline-none"
            onChange={(e) => setRelease(e.target.value || null)}
            value={release ?? ''}
          >
            <option value="">— pick release —</option>
            {releases.map((r) => (
              <option key={r.release} value={r.release}>
                {r.release} · {r.eventCount} ev · {formatRelative(r.lastSeen)}
              </option>
            ))}
          </select>
        }
        subtitle="last 7 days"
        title="Vitals"
      />

      {(releasesQ.isError || reportQ.isError) && (
        <p className="border-y border-[color:var(--rule)] py-6 text-center text-[13px] text-[color:var(--danger)]">
          Failed to load vitals. Refresh to retry.
        </p>
      )}
      {!report && !releasesQ.isError && !reportQ.isError && reportQ.isLoading && (
        <p className="border-y border-[color:var(--rule)] py-6 text-center text-[13px] text-[color:var(--ink-soft)]">
          Loading…
        </p>
      )}
      {!report &&
        !releasesQ.isError &&
        !reportQ.isError &&
        !reportQ.isLoading &&
        releases.length === 0 && (
          <p className="border-y border-[color:var(--rule)] py-6 text-center text-[13px] text-[color:var(--ink-soft)]">
            No releases with vitals data yet. The SDK starts populating after the first cold-start
            measurement on a build with `mobile-vitals` enabled.
          </p>
        )}

      {report && (
        <div className="rule-grid grid-cols-1 sm:grid-cols-3">
          <Stat label="release" value={<span className="font-mono">{report.release}</span>} />
          <Stat
            label="cold start"
            sub={
              report.coldStart.samples > 0
                ? `p95 ${report.coldStart.p95Ms}ms · ${report.coldStart.samples} samples`
                : 'no samples'
            }
            value={
              report.coldStart.samples > 0 ? (
                <>
                  <span className="tabular-nums">{report.coldStart.p50Ms}</span>
                  <span className="ml-1 text-[14px] text-[color:var(--ink-muted)]">ms p50</span>
                </>
              ) : (
                <span className="text-[16px] text-[color:var(--ink-muted)]">
                  SDK ≥ 0.8.6 needed
                </span>
              )
            }
          />
          <Stat
            label="routes tracked"
            value={<span className="tabular-nums">{report.perRoute.length}</span>}
          />
        </div>
      )}

      <SubSection sub={`${report?.perRoute.length ?? 0} routes`} title="Per-route vitals">
        {!report || report.perRoute.length === 0 ? (
          <EmptyState>
            No route vitals yet. Mount{' '}
            <code className="font-mono text-[color:var(--ink)]">
              useTraceNavigation(navigationRef)
            </code>{' '}
            in your app and pick a release with traffic.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="bench min-w-[720px]">
              <thead>
                <tr>
                  <th>route</th>
                  <th className="num">nav</th>
                  <th className="num">ttid p50</th>
                  <th className="num">ttid p95</th>
                  <th className="num">ttfd p50</th>
                  <th className="num">ttfd p95</th>
                  <th className="num">slow</th>
                  <th className="num">frozen</th>
                </tr>
              </thead>
              <tbody>
                {report.perRoute.map((r) => (
                  <tr key={r.route}>
                    <td className="lead">{r.route}</td>
                    <td className="num">{r.navigations.toLocaleString()}</td>
                    <td className="num">{r.ttidP50Ms}ms</td>
                    <td className="num">{r.ttidP95Ms}ms</td>
                    <td className="num">{r.ttfdSamples > 0 ? `${r.ttfdP50Ms}ms` : '—'}</td>
                    <td className="num">{r.ttfdSamples > 0 ? `${r.ttfdP95Ms}ms` : '—'}</td>
                    <td
                      className={`num ${
                        r.totalSlowFrames > 0 ? 'text-[color:var(--warning)]' : ''
                      }`}
                    >
                      {r.totalSlowFrames}
                    </td>
                    <td
                      className={`num ${
                        r.totalFrozenFrames > 0 ? 'text-[color:var(--danger)]' : ''
                      }`}
                    >
                      {r.totalFrozenFrames}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SubSection>
    </div>
  )
}

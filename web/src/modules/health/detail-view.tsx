// v2.1.3 — per-check detail page.
//
// Replaces the inline expand in the list view with a dedicated route
// at `/main/org/<slug>/health/:checkId`. Three panels:
//
//   1. Header   — name + URL + assertion summary + Edit/Pause/Delete/Back
//   2. Rollup   — 1h/24h/7d window toggle, sparkline + uptime numbers
//   3. Probe    — "Probe now" dry-run + full probe log (limit-bumped)

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { type EndpointProbeNowResult, adminApi } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { CenteredEmpty } from '@/components/Hint'
import { RowSkeleton } from '@/components/Skeleton'

import { ProbeLog, Sparkline, StatusDot } from './_shared'
import { computeStatusBadge, lastP95 } from './_status'

type WindowKey = '1h' | '24h' | '7d'

function windowRange(key: WindowKey): { from: string; to: string } {
  const now = Date.now()
  const ms =
    key === '1h' ? 60 * 60 * 1000 : key === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
  return {
    from: new Date(now - ms).toISOString(),
    to: new Date(now).toISOString(),
  }
}

export function HealthDetailView() {
  const { checkId } = useParams<{ checkId: string }>()
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const orgSlug = currentOrg.slug
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [windowKey, setWindowKey] = useState<WindowKey>('24h')
  const [probeLimit, setProbeLimit] = useState(50)
  const [probeNowResult, setProbeNowResult] = useState<EndpointProbeNowResult | null>(null)

  const checkQ = useQuery({
    enabled: !!projectId && !!checkId,
    queryFn: () => adminApi.getEndpointCheck(projectId!, checkId!),
    queryKey: qk.endpointChecks.detail(projectId, checkId ?? null),
  })

  const range = windowRange(windowKey)
  const rollupQ = useQuery({
    enabled: !!projectId && !!checkId,
    queryFn: () => adminApi.listEndpointRollup(projectId!, checkId!, range),
    queryKey: qk.endpointChecks.rollup(projectId, checkId ?? null, range.from, range.to),
  })
  const probesQ = useQuery({
    enabled: !!projectId && !!checkId,
    queryFn: () =>
      adminApi.listEndpointProbes(projectId!, checkId!, {
        from: range.from,
        limit: probeLimit,
        to: range.to,
      }),
    queryKey: [
      'endpoint-check-probes-paged',
      projectId,
      checkId,
      range.from,
      range.to,
      probeLimit,
    ] as const,
  })

  const togglePause = useMutation({
    mutationFn: (paused: boolean) => adminApi.updateEndpointCheck(projectId!, checkId!, { paused }),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: qk.endpointChecks.detail(projectId, checkId ?? null),
      })
      void qc.invalidateQueries({ queryKey: qk.endpointChecks.list(projectId) })
    },
  })
  const del = useMutation({
    mutationFn: () => adminApi.deleteEndpointCheck(projectId!, checkId!),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.endpointChecks.list(projectId) })
      navigate(`/main/org/${orgSlug}/health`)
    },
  })
  const probeNow = useMutation({
    mutationFn: () => adminApi.probeEndpointCheckNow(projectId!, checkId!),
    onSuccess: (result) => setProbeNowResult(result),
  })

  if (!projectId || !checkId) return null
  if (checkQ.isLoading) {
    return (
      <div className="space-y-3">
        <RowSkeleton count={3} height="48px" />
      </div>
    )
  }
  if (checkQ.error || !checkQ.data) {
    return (
      <div className="">
        <CenteredEmpty>Check not found.</CenteredEmpty>
      </div>
    )
  }

  const check = checkQ.data
  const rollup = rollupQ.data ?? []
  const status = computeStatusBadge(rollup, check.paused)
  const p95 = lastP95(rollup)

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex items-baseline gap-3">
          <Link
            className="text-fg-muted hover:text-accent font-mono text-[10px] tracking-[0.18em] uppercase"
            to={`/main/org/${orgSlug}/health`}
          >
            ← health
          </Link>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot kind={status.kind} />
              <h1
                className="text-fg truncate"
                style={{
                  fontSize: '22px',
                  fontVariationSettings: "'wdth' 95, 'opsz' 32, 'wght' 580",
                  letterSpacing: '-0.012em',
                }}
              >
                {check.name}
              </h1>
              {check.paused && (
                <span className="text-fg-muted font-mono text-[10px] tracking-[0.12em] uppercase">
                  paused
                </span>
              )}
            </div>
            <div className="text-fg-muted mt-1 truncate font-mono text-[11px]">
              {check.method} {check.targetUrl}
            </div>
            <div className="text-fg-muted mt-1 font-mono text-[10px]">
              every {check.intervalSec}s · status ∈ [{check.assertionStatusCodes.join(', ')}]
              {check.assertionMaxLatencyMs ? `, < ${check.assertionMaxLatencyMs}ms` : ''}
              {check.assertionBodySubstring ? `, body ⊃ "${check.assertionBodySubstring}"` : ''}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              className="border-border text-fg hover:border-accent rounded border px-2.5 py-1 text-[11px]"
              to={`/main/org/${orgSlug}/health/${check.id}/edit`}
            >
              Edit
            </Link>
            <button
              className="border-border text-fg rounded border px-2.5 py-1 text-[11px] disabled:opacity-50"
              disabled={togglePause.isPending}
              onClick={() => togglePause.mutate(!check.paused)}
              type="button"
            >
              {check.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              className="border-border text-danger rounded border px-2.5 py-1 text-[11px] disabled:opacity-50"
              disabled={del.isPending}
              onClick={() => {
                if (confirm(`Delete check "${check.name}"? Cascades to its probe history.`)) {
                  del.mutate()
                }
              }}
              type="button"
            >
              Delete
            </button>
          </div>
        </div>
      </header>

      <section className="border-border bg-bg-secondary space-y-3 rounded border p-4">
        <div className="flex items-center justify-between">
          <div className="text-fg-muted font-mono text-[10px] tracking-[0.12em] uppercase">
            uptime · {windowKey}
          </div>
          <div className="flex gap-1">
            {(['1h', '24h', '7d'] as const).map((w) => (
              <button
                className={`rounded border px-2 py-0.5 font-mono text-[10px] tracking-[0.1em] uppercase ${
                  w === windowKey ? 'border-accent text-accent' : 'border-border text-fg-muted'
                }`}
                key={w}
                onClick={() => setWindowKey(w)}
                type="button"
              >
                {w}
              </button>
            ))}
          </div>
        </div>
        {rollupQ.isLoading && <RowSkeleton count={1} height="48px" />}
        {rollupQ.data && rollup.length === 0 && (
          <p className="text-fg-muted py-4 text-center text-[11px]">
            No rollup data in this window yet.
          </p>
        )}
        {rollup.length > 0 && (
          <>
            <Sparkline height={48} rollup={rollup} width={640} />
            <div className="text-fg-muted flex flex-wrap gap-x-6 gap-y-1 font-mono text-[11px]">
              <span>uptime {rollup[0]!.uptimePct.toFixed(2)}%</span>
              <span>p50 {rollup[0]!.p50LatencyMs}ms</span>
              <span>p95 {p95}ms</span>
              <span>{rollup.reduce((acc, r) => acc + r.probeCount, 0)} probes in window</span>
            </div>
          </>
        )}
      </section>

      <section className="border-border bg-bg-secondary space-y-3 rounded border p-4">
        <div className="flex items-center justify-between">
          <div className="text-fg-muted font-mono text-[10px] tracking-[0.12em] uppercase">
            probe now
          </div>
          <button
            className="border-accent text-accent rounded border px-2.5 py-1 text-[11px] disabled:opacity-50"
            disabled={probeNow.isPending}
            onClick={() => probeNow.mutate()}
            type="button"
          >
            {probeNow.isPending ? 'Probing…' : 'Probe now'}
          </button>
        </div>
        <p className="text-fg-muted text-[11px]">
          Runs a one-shot probe with the current config — result is shown below, nothing is written
          to the probe history, and the issue lifecycle isn't touched.
        </p>
        {probeNowResult && (
          <div
            className="rounded border px-3 py-2 font-mono text-[11px]"
            style={{
              borderColor: probeNowResult.ok ? 'var(--color-accent)' : 'var(--color-danger)',
              color: probeNowResult.ok ? 'var(--color-accent)' : 'var(--color-danger)',
            }}
          >
            {probeNowResult.ok ? 'OK' : 'FAIL'} · {probeNowResult.statusCode} ·{' '}
            {probeNowResult.latencyMs}ms
            {probeNowResult.errorKind ? ` · ${probeNowResult.errorKind}` : ''}
          </div>
        )}
        {probeNow.error && (
          <p className="text-danger text-[11px]">{(probeNow.error as Error).message}</p>
        )}
      </section>

      <section className="border-border bg-bg-secondary space-y-3 rounded border p-4">
        <div className="flex items-center justify-between">
          <div className="text-fg-muted font-mono text-[10px] tracking-[0.12em] uppercase">
            probe log · {windowKey}
          </div>
          <span className="text-fg-muted font-mono text-[10px]">
            showing {probesQ.data?.length ?? 0} of ≤ {probeLimit}
          </span>
        </div>
        {probesQ.isLoading && <RowSkeleton count={5} height="20px" />}
        {probesQ.data && probesQ.data.length === 0 && (
          <p className="text-fg-muted py-4 text-center text-[11px]">
            No probes in this window yet.
          </p>
        )}
        {probesQ.data && probesQ.data.length > 0 && <ProbeLog rows={probesQ.data} />}
        {probesQ.data && probesQ.data.length >= probeLimit && probeLimit < 5000 && (
          <button
            className="border-border text-fg-muted hover:border-accent hover:text-accent rounded border px-2.5 py-1 font-mono text-[10px] tracking-[0.1em] uppercase"
            onClick={() => setProbeLimit((n) => Math.min(5000, n * 5))}
            type="button"
          >
            Load more
          </button>
        )}
      </section>
    </div>
  )
}

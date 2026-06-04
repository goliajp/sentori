import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { adminApi, type TrustScoreRow } from '@/api/client'
import { ModuleEmpty } from '@/components/Hint'
import { qk } from '@/api/query-keys'
import { getScoreKernel, peekScoreKernel } from '@/lib/score-wasm'

/**
 * Trust signal explorer — v1.1 chunk S4 design surface.
 *
 * The slider lets the operator simulate weight changes without
 * touching the server: every adjustment re-scores the 100 lowest
 * installs through the Rust → WebAssembly kernel at `wasm/score/`
 * (433 bytes shipped). On a 16-row × 6-kind workload the round-trip
 * is < 1 ms in Chrome — well under the 200 ms budget the design doc
 * targets.
 *
 * Defaults to the same weights the server applies. "Reset" reverts
 * to baseline. The table re-sorts ascending by simulated score so
 * the eye lands on the worst install under the new weights.
 */

const DEFAULT_WEIGHTS: Record<string, number> = {
  'pin.mismatch': 30,
  'root.detected': 50,
  'frida.detected': 50,
  'jailbreak.detected': 50,
  'debugger.attached': 20,
  'device.emulator': 10,
}

const KIND_ORDER = [
  'pin.mismatch',
  'root.detected',
  'frida.detected',
  'jailbreak.detected',
  'debugger.attached',
  'device.emulator',
]

const UNKNOWN_DEFAULT = 5

export function TrustExplorerView({ projectId }: { projectId: string }) {
  const { data, error, isLoading } = useQuery({
    enabled: !!projectId,
    meta: { persist: true },
    placeholderData: (prev) => prev,
    queryFn: () => adminApi.trustScores(projectId, { limit: 100 }),
    queryKey: qk.posture.trustScores(projectId),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  const [weights, setWeights] = useState<Record<string, number>>(DEFAULT_WEIGHTS)
  const [kernelReady, setKernelReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    getScoreKernel()
      .then(() => {
        if (!cancelled) setKernelReady(true)
      })
      .catch(() => {
        if (!cancelled) setKernelReady(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const recomputed = useMemo(() => {
    const rows = data ?? []
    const kernel = kernelReady ? peekScoreKernel() : null
    if (!kernel) {
      return rows.map((r) => ({ ...r, simScore: r.score }))
    }
    return rows
      .map((r) => {
        const kindRows = Object.entries(r.kinds).map(([k, c]) => ({
          count: c,
          weight: weights[k] ?? UNKNOWN_DEFAULT,
        }))
        return { ...r, simScore: kernel.score(kindRows) }
      })
      .sort((a, b) => a.simScore - b.simScore || b.lastSeen.localeCompare(a.lastSeen))
  }, [data, kernelReady, weights])

  if (isLoading && !data) return <ModuleEmpty eyebrow="explorer">Loading…</ModuleEmpty>
  if (error) return <ModuleEmpty eyebrow="explorer">Failed to read trust scores.</ModuleEmpty>

  return (
    <div className="space-y-6">
      <p className="text-fg-muted font-mono text-[11px]">
        adjust weights below · scores recompute in-browser via Rust → WebAssembly ·{' '}
        <span className="text-accent">{kernelReady ? 'wasm ready' : 'wasm loading…'}</span>
      </p>

      <SliderRow
        onChange={(next) => setWeights(next)}
        onReset={() => setWeights(DEFAULT_WEIGHTS)}
        weights={weights}
      />

      <ResultTable rows={recomputed} />
    </div>
  )
}

function SliderRow({
  onChange,
  onReset,
  weights,
}: {
  onChange: (next: Record<string, number>) => void
  onReset: () => void
  weights: Record<string, number>
}) {
  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">Weight knobs</span>
        <button
          className="text-fg-muted hover:text-accent font-mono text-[10px] tracking-[0.18em] uppercase"
          onClick={onReset}
          type="button"
        >
          reset to defaults
        </button>
      </header>
      <ul className="grid grid-cols-1 gap-x-6 gap-y-3 pt-3 md:grid-cols-2">
        {KIND_ORDER.map((k) => {
          const v = weights[k] ?? DEFAULT_WEIGHTS[k] ?? UNKNOWN_DEFAULT
          return (
            <li className="border-border/40 flex items-baseline gap-3 border-b py-1.5" key={k}>
              <span className="text-fg-secondary basis-[14ch] font-mono text-[11px]">{k}</span>
              <input
                aria-label={`${k} weight`}
                className="accent-accent min-w-0 flex-1"
                max={100}
                min={0}
                onChange={(e) => onChange({ ...weights, [k]: Number(e.target.value) })}
                step={1}
                type="range"
                value={v}
              />
              <span className="text-fg basis-[3ch] text-right font-mono text-[12px] tabular-nums">
                {v}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ResultTable({ rows }: { rows: (TrustScoreRow & { simScore: number })[] }) {
  if (rows.length === 0) {
    return (
      <ModuleEmpty eyebrow="explorer">
        No installs with security events yet. The explorer needs at least one row to score.
      </ModuleEmpty>
    )
  }
  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">Simulated scores</span>
        <span className="sec-head-sub">{rows.length} installs · sorted by sim score asc</span>
      </header>
      <ul className="pt-3">
        {rows.map((r) => (
          <SimRow key={r.installId} row={r} />
        ))}
      </ul>
    </section>
  )
}

function SimRow({ row }: { row: TrustScoreRow & { simScore: number } }) {
  const delta = row.simScore - row.score
  const tone =
    row.simScore < 30
      ? 'var(--color-danger)'
      : row.simScore < 70
        ? 'var(--color-warning, var(--color-accent))'
        : 'var(--color-fg-secondary)'
  return (
    <li className="border-border/40 grid grid-cols-[5ch_5ch_minmax(0,1fr)_auto_auto] items-baseline gap-3 border-b py-2 last:border-b-0">
      <span
        className="font-mono text-[16px] font-medium tabular-nums"
        style={{ color: tone }}
        title={`Sim score ${row.simScore} / 100`}
      >
        {row.simScore}
      </span>
      <span
        className="font-mono text-[10px] tabular-nums"
        style={{
          color:
            delta === 0
              ? 'var(--color-fg-muted)'
              : delta < 0
                ? 'var(--color-danger)'
                : 'var(--color-accent)',
        }}
        title={`Baseline ${row.score}, sim ${row.simScore}`}
      >
        {delta === 0 ? '·' : delta > 0 ? `+${delta}` : delta}
      </span>
      <span className="text-fg min-w-0 truncate font-mono text-[12px]">{row.installId}</span>
      <span className="text-fg-muted font-mono text-[11px]">
        {Object.entries(row.kinds)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k, n]) => `${k}×${n}`)
          .join(' · ')}
      </span>
      <span className="text-fg-muted font-mono text-[11px] tabular-nums">
        {new Date(row.lastSeen).toLocaleString()}
      </span>
    </li>
  )
}

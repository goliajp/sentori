// v2.1.3 — shared presentation primitives for the Health module split.
//
// Sparkline / StatusDot / ProbeLog used by the list view and the
// per-check detail view. Kept here so neither file owns the
// presentation primitives and a redesign can touch one file.
// Pure helpers (computeStatusBadge / lastP95 / StatusKind) live in
// `_status.ts` so this file only exports components — otherwise the
// `react-refresh/only-export-components` rule complains.

import type { EndpointProbeRow, EndpointRollupRow } from '@/api/client'

import type { StatusKind } from './_status'

export function StatusDot({ kind }: { kind: StatusKind }) {
  const color =
    kind === 'ok'
      ? 'var(--accent)'
      : kind === 'transient'
        ? '#f59e0b'
        : kind === 'down'
          ? 'var(--danger)'
          : 'var(--ink-muted)'
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  )
}

export function Sparkline({
  height = 24,
  rollup,
  width = 96,
}: {
  height?: number
  rollup: EndpointRollupRow[]
  width?: number
}) {
  if (rollup.length === 0) {
    return <div style={{ height, width }} />
  }
  // Reverse so the chart reads oldest → newest left-to-right.
  const points = [...rollup].reverse()
  const xStep = points.length > 1 ? width / (points.length - 1) : 0
  return (
    <svg className="shrink-0" height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
      {points.map((p, i) => {
        const x = i * xStep
        const h = (p.uptimePct / 100) * height
        const color =
          p.uptimePct >= 99 ? 'var(--accent)' : p.uptimePct >= 80 ? '#f59e0b' : 'var(--danger)'
        return (
          <rect
            fill={color}
            height={h}
            key={i}
            width={Math.max(1, xStep - 1)}
            x={x}
            y={height - h}
          />
        )
      })}
    </svg>
  )
}

export function ProbeLog({ rows }: { rows: EndpointProbeRow[] }) {
  return (
    <div className="space-y-0.5 font-mono text-[10px]">
      {rows.map((r) => (
        <div
          className="flex items-baseline gap-2"
          key={r.ts}
          style={{
            color: r.ok ? 'var(--ink-muted)' : 'var(--danger)',
          }}
        >
          <span className="w-32 shrink-0">{new Date(r.ts).toLocaleTimeString()}</span>
          <span className="w-8 shrink-0">{r.statusCode}</span>
          <span className="w-12 shrink-0">{r.latencyMs}ms</span>
          <span className="shrink-0">{r.ok ? 'ok' : (r.errorKind ?? 'fail')}</span>
        </div>
      ))}
    </div>
  )
}

export function FieldLabel({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="space-y-1">
      <div className="font-mono text-[10px] tracking-[0.1em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </div>
      {children}
    </label>
  )
}

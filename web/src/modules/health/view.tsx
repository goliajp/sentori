// v2.1 W4 part 3 — endpoint health dashboard.
//
// List view + inline "add check" form + per-row sparkline +
// expand-on-click probe log. Detail-view-as-separate-page is a
// follow-up; for W4 ship we keep everything on one page for the
// shortest path to a useful dashboard.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  type EndpointCheck,
  type EndpointProbeRow,
  type EndpointRollupRow,
  adminApi,
} from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'
import { CenteredEmpty } from '@/components/Hint'

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * ONE_DAY_MS).toISOString()
}

function isoNow(): string {
  return new Date().toISOString()
}

export function HealthView() {
  const { currentProject } = useOrg()
  const projectId = currentProject?.id ?? null

  const checksQ = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listEndpointChecks(projectId!),
    queryKey: qk.endpointChecks.list(projectId),
  })

  if (!projectId) return null

  return (
    <div className="sentori-page-in space-y-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <div className="font-mono text-[11px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
            endpoint health
          </div>
          <h1
            className="mt-1 text-[color:var(--ink)]"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '26px',
              fontVariationSettings: "'wdth' 95, 'opsz' 48, 'wght' 600",
              letterSpacing: '-0.018em',
              lineHeight: 1.05,
            }}
          >
            Health
          </h1>
          <div className="mt-2 text-[12px] text-[color:var(--ink-muted)]">
            Outside-in synthetic probes. Auto-opens an issue on two consecutive failures and
            auto-resolves on recovery.
          </div>
        </div>
      </header>

      <NewCheckForm projectId={projectId} />

      {checksQ.isLoading && (
        <div className="py-8 text-center text-[12px] text-[color:var(--ink-muted)]">Loading…</div>
      )}
      {checksQ.error && <CenteredEmpty>Failed to load checks.</CenteredEmpty>}
      {checksQ.data && checksQ.data.length === 0 && (
        <CenteredEmpty>
          No endpoint checks yet.
          <br />
          Add one above and probes will start on the next 60 s tick.
        </CenteredEmpty>
      )}

      {checksQ.data && checksQ.data.length > 0 && (
        <ul className="divide-y divide-[color:var(--rule)] rounded border border-[color:var(--rule)]">
          {checksQ.data.map((c) => (
            <CheckRow key={c.id} projectId={projectId} check={c} />
          ))}
        </ul>
      )}
    </div>
  )
}

function NewCheckForm({ projectId }: { projectId: string }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [targetUrl, setTargetUrl] = useState('https://')
  const [intervalSec, setIntervalSec] = useState(60)
  const [maxLatencyMs, setMaxLatencyMs] = useState<string>('')
  const [bodySubstring, setBodySubstring] = useState<string>('')

  const create = useMutation({
    mutationFn: () =>
      adminApi.createEndpointCheck(projectId, {
        assertionBodySubstring: bodySubstring || undefined,
        assertionMaxLatencyMs: maxLatencyMs ? parseInt(maxLatencyMs, 10) : undefined,
        intervalSec,
        name,
        targetUrl,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.endpointChecks.list(projectId) })
      setOpen(false)
      setName('')
      setTargetUrl('https://')
      setIntervalSec(60)
      setMaxLatencyMs('')
      setBodySubstring('')
    },
  })

  if (!open) {
    return (
      <button
        className="rounded border border-dashed border-[color:var(--rule)] px-3 py-1.5 text-[12px] text-[color:var(--ink-muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
        onClick={() => setOpen(true)}
        type="button"
      >
        + Add endpoint check
      </button>
    )
  }

  return (
    <form
      className="space-y-3 rounded border border-[color:var(--rule)] bg-[color:var(--paper-2)] p-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name || !targetUrl) return
        create.mutate()
      }}
    >
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Name">
          <input
            className="w-full rounded border border-[color:var(--rule)] bg-[color:var(--paper)] px-2 py-1 text-[12px]"
            onChange={(e) => setName(e.target.value)}
            placeholder="checkout API liveness"
            required
            value={name}
          />
        </Field>
        <Field label="Target URL">
          <input
            className="w-full rounded border border-[color:var(--rule)] bg-[color:var(--paper)] px-2 py-1 font-mono text-[12px]"
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://api.example.com/healthz"
            required
            type="url"
            value={targetUrl}
          />
        </Field>
        <Field label="Interval (sec, min 60)">
          <input
            className="w-full rounded border border-[color:var(--rule)] bg-[color:var(--paper)] px-2 py-1 text-[12px]"
            min={60}
            onChange={(e) => setIntervalSec(parseInt(e.target.value, 10))}
            type="number"
            value={intervalSec}
          />
        </Field>
        <Field label="Max latency (ms, optional)">
          <input
            className="w-full rounded border border-[color:var(--rule)] bg-[color:var(--paper)] px-2 py-1 text-[12px]"
            onChange={(e) => setMaxLatencyMs(e.target.value)}
            placeholder="2000"
            type="number"
            value={maxLatencyMs}
          />
        </Field>
        <Field label="Body must contain (optional)">
          <input
            className="w-full rounded border border-[color:var(--rule)] bg-[color:var(--paper)] px-2 py-1 font-mono text-[12px]"
            onChange={(e) => setBodySubstring(e.target.value)}
            placeholder={'"status":"ok"'}
            value={bodySubstring}
          />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <button
          className="rounded border border-[color:var(--accent)] bg-[color:var(--accent)] px-3 py-1 text-[12px] text-white disabled:opacity-50"
          disabled={create.isPending}
          type="submit"
        >
          {create.isPending ? 'Creating…' : 'Create check'}
        </button>
        <button
          className="rounded border border-[color:var(--rule)] px-3 py-1 text-[12px] text-[color:var(--ink-muted)]"
          onClick={() => setOpen(false)}
          type="button"
        >
          Cancel
        </button>
        {create.error && (
          <span className="text-[11px] text-[color:var(--danger)]">
            {(create.error as Error).message}
          </span>
        )}
      </div>
    </form>
  )
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="space-y-1">
      <div className="font-mono text-[10px] tracking-[0.1em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </div>
      {children}
    </label>
  )
}

function CheckRow({ check, projectId }: { check: EndpointCheck; projectId: string }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const window = { from: isoDaysAgo(1), to: isoNow() }

  const rollupQ = useQuery({
    queryFn: () => adminApi.listEndpointRollup(projectId, check.id, window),
    queryKey: qk.endpointChecks.rollup(projectId, check.id, window.from, window.to),
  })
  const probesQ = useQuery({
    enabled: expanded,
    queryFn: () => adminApi.listEndpointProbes(projectId, check.id, { ...window, limit: 50 }),
    queryKey: qk.endpointChecks.probes(projectId, check.id, window.from, window.to),
  })

  const togglePause = useMutation({
    mutationFn: (next: boolean) =>
      adminApi.updateEndpointCheck(projectId, check.id, { paused: next }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.endpointChecks.list(projectId) }),
  })
  const del = useMutation({
    mutationFn: () => adminApi.deleteEndpointCheck(projectId, check.id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.endpointChecks.list(projectId) }),
  })

  const rollup = rollupQ.data ?? []
  const statusBadge = computeStatusBadge(rollup, check.paused)
  const p95 = lastP95(rollup)

  return (
    <li className="bg-[color:var(--paper)]">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[color:var(--paper-2)]"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        <StatusDot kind={statusBadge.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] text-[color:var(--ink)]">{check.name}</span>
            <span className="truncate font-mono text-[10px] text-[color:var(--ink-muted)]">
              {check.method} {check.targetUrl}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-3 font-mono text-[10px] text-[color:var(--ink-muted)]">
            <span>every {check.intervalSec}s</span>
            <span>
              status ∈ [{check.assertionStatusCodes.join(', ')}]
              {check.assertionMaxLatencyMs ? `, < ${check.assertionMaxLatencyMs}ms` : ''}
              {check.assertionBodySubstring ? `, body ⊃ "${check.assertionBodySubstring}"` : ''}
            </span>
          </div>
        </div>
        <Sparkline rollup={rollup} />
        <div className="w-20 text-right font-mono text-[11px] text-[color:var(--ink-muted)]">
          {p95 !== null ? `${p95}ms p95` : '—'}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-[color:var(--rule)] bg-[color:var(--paper-2)] px-4 py-3">
          <div className="flex items-center gap-2 text-[11px]">
            <button
              className="rounded border border-[color:var(--rule)] px-2 py-0.5"
              disabled={togglePause.isPending}
              onClick={() => togglePause.mutate(!check.paused)}
              type="button"
            >
              {check.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              className="rounded border border-[color:var(--rule)] px-2 py-0.5 text-[color:var(--danger)]"
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
          {probesQ.data && probesQ.data.length > 0 && <ProbeLog rows={probesQ.data.slice(0, 30)} />}
          {probesQ.data && probesQ.data.length === 0 && (
            <div className="text-[11px] text-[color:var(--ink-muted)]">
              No probes yet — wait for the next 60 s tick.
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function computeStatusBadge(
  rollup: EndpointRollupRow[],
  paused: boolean
): { kind: 'down' | 'ok' | 'paused' | 'transient' } {
  if (paused) return { kind: 'paused' }
  if (rollup.length === 0) return { kind: 'ok' }
  const recent = rollup[0]!
  if (recent.uptimePct >= 99) return { kind: 'ok' }
  if (recent.uptimePct >= 80) return { kind: 'transient' }
  return { kind: 'down' }
}

function lastP95(rollup: EndpointRollupRow[]): null | number {
  if (rollup.length === 0) return null
  return rollup[0]!.p95LatencyMs
}

function StatusDot({ kind }: { kind: 'down' | 'ok' | 'paused' | 'transient' }) {
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

function Sparkline({ rollup }: { rollup: EndpointRollupRow[] }) {
  if (rollup.length === 0) {
    return <div className="h-6 w-24" />
  }
  // Reverse so the chart reads oldest → newest left-to-right.
  const points = [...rollup].reverse()
  const W = 96
  const H = 24
  const xStep = points.length > 1 ? W / (points.length - 1) : 0
  return (
    <svg className="shrink-0" height={H} viewBox={`0 0 ${W} ${H}`} width={W}>
      {points.map((p, i) => {
        const x = i * xStep
        const h = (p.uptimePct / 100) * H
        const color =
          p.uptimePct >= 99 ? 'var(--accent)' : p.uptimePct >= 80 ? '#f59e0b' : 'var(--danger)'
        return (
          <rect fill={color} height={h} key={i} width={Math.max(1, xStep - 1)} x={x} y={H - h} />
        )
      })}
    </svg>
  )
}

function ProbeLog({ rows }: { rows: EndpointProbeRow[] }) {
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

// v2.1.3 — small helpers split out of `_shared.tsx` so the
// components file only exports React components. Keeps the
// `react-refresh/only-export-components` rule quiet without forcing
// each callsite to import from two places (`_shared` re-exports
// these for backwards compat).

import type { EndpointRollupRow } from '@/api/client'

export type StatusKind = 'down' | 'ok' | 'paused' | 'transient'

export function computeStatusBadge(
  rollup: EndpointRollupRow[],
  paused: boolean
): { kind: StatusKind } {
  if (paused) return { kind: 'paused' }
  if (rollup.length === 0) return { kind: 'ok' }
  const recent = rollup[0]!
  if (recent.uptimePct >= 99) return { kind: 'ok' }
  if (recent.uptimePct >= 80) return { kind: 'transient' }
  return { kind: 'down' }
}

export function lastP95(rollup: EndpointRollupRow[]): null | number {
  if (rollup.length === 0) return null
  return rollup[0]!.p95LatencyMs
}

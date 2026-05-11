// Phase 36 sub-D: trace list query language.
//
// Grammar:
//
//   QUERY  := TERM (WS+ TERM)*
//   TERM   := KEY ":" VALUE
//   KEY    := "op" | "status" | "duration"
//   VALUE  := bare token (no whitespace, no colon)
//
//   op:       free string, exact match on traces.root_op
//   status:   ok | error | cancelled
//   duration: >Nms, >Ns — minimum duration filter (always lower bound;
//             the operator '<' is rejected with a warning to keep
//             API + UI simple. Add later if real use shows up).
//
// Same shape as parseIssueQuery — keeps the dashboard's "search bar
// vs. dropdowns" mental model consistent across surfaces. No free
// text on trace list; everything has to land as a keyed term.

export type TraceStatusValue = 'cancelled' | 'error' | 'ok'

export type ParsedTraceQuery = {
  /** Minimum duration in milliseconds (≥). */
  minDurationMs?: number
  op?: string
  status?: TraceStatusValue
  /** Tokens we recognised but rejected (bad value, etc). */
  warnings: string[]
}

const VALID_STATUS: ReadonlySet<string> = new Set(['cancelled', 'error', 'ok'])

const KEY_ALIASES: Record<string, keyof ParsedTraceQuery> = {
  duration: 'minDurationMs',
  op: 'op',
  status: 'status',
}

export function parseTraceQuery(input: string): ParsedTraceQuery {
  const out: ParsedTraceQuery = { warnings: [] }
  for (const token of input.trim().split(/\s+/)) {
    if (!token) continue
    const idx = token.indexOf(':')
    if (idx <= 0 || idx === token.length - 1) {
      out.warnings.push(`free text not supported: ${token}`)
      continue
    }
    const rawKey = token.slice(0, idx)
    const value = token.slice(idx + 1)
    const key = KEY_ALIASES[rawKey]
    if (!key) {
      out.warnings.push(`unknown filter: ${rawKey}`)
      continue
    }

    switch (key) {
      case 'minDurationMs': {
        const ms = parseDurationFilter(value)
        if (ms == null) {
          out.warnings.push(`bad duration: ${token}`)
          break
        }
        out.minDurationMs = ms
        break
      }
      case 'op':
        out.op = value
        break
      case 'status':
        if (!VALID_STATUS.has(value)) {
          out.warnings.push(`bad status: ${token}`)
          break
        }
        out.status = value as TraceStatusValue
        break
    }
  }
  return out
}

/**
 * Accepts `>Nms` / `>Ns` for "duration ≥ N (ms|s)". The `>` prefix is
 * required so the grammar reads naturally — "duration > 500ms" means
 * "give me traces slower than half a second."
 *
 * Returns the floor in ms, or null on bad input.
 */
export function parseDurationFilter(value: string): null | number {
  const m = /^>(\d+)(ms|s)$/.exec(value)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isInteger(n) || n <= 0) return null
  return m[2] === 's' ? n * 1000 : n
}

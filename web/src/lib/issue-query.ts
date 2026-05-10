/**
 * Phase 24 sub-A: issue list query language.
 *
 * Grammar (informal):
 *
 *   QUERY    := TERM (WS+ TERM)*
 *   TERM     := KEY ":" VALUE | FREE
 *   KEY      := "errorType" | "error" | "env" | "environment"
 *             | "release" | "status" | "last"
 *   VALUE    := bare token (no whitespace, no colon)
 *   FREE     := bare token (no colon)
 *
 *   `last:` accepts `<N>(m|h|d)` — minutes / hours / days.
 *   `status:` accepts active|silenced|closed|resolved|regressed.
 *   `error` is an alias of `errorType`; `env` of `environment`.
 *
 * Quoting / negation / boolean operators are intentionally out of
 * scope for v0.2 — they're cheap to add later but easy to over-design
 * upfront. Free tokens accumulate into a single `freeText` string the
 * dashboard uses for client-side substring matching against
 * errorType + messageSample (no full-text index in v0.2 either).
 *
 * Same grammar will land in Rust under `server/src/issues_query.rs` in
 * sub-C when saved views need server-side rendering. For now only the
 * dashboard parses; the server takes already-resolved field params.
 */

export type IssueStatusValue = 'active' | 'closed' | 'regressed' | 'resolved' | 'silenced'

export type ParsedIssueQuery = {
  environment?: string
  errorType?: string
  freeText?: string
  /** RFC 3339 timestamp; the server reads `lastSeenAfter` from URL. */
  lastSeenAfter?: string
  release?: string
  status?: IssueStatusValue
  /** Tokens we recognized as filters but rejected (bad value, etc). */
  warnings: string[]
}

const VALID_STATUS: ReadonlySet<string> = new Set([
  'active',
  'closed',
  'regressed',
  'resolved',
  'silenced',
])

const KEY_ALIASES: Record<string, keyof ParsedIssueQuery | 'last'> = {
  env: 'environment',
  environment: 'environment',
  error: 'errorType',
  errorType: 'errorType',
  last: 'last',
  release: 'release',
  status: 'status',
}

export function parseIssueQuery(input: string, now = new Date()): ParsedIssueQuery {
  const out: ParsedIssueQuery = { warnings: [] }
  const free: string[] = []

  for (const token of input.trim().split(/\s+/)) {
    if (!token) continue
    const idx = token.indexOf(':')
    if (idx <= 0 || idx === token.length - 1) {
      // No colon, leading colon, or empty value → free text.
      free.push(token)
      continue
    }
    const rawKey = token.slice(0, idx)
    const value = token.slice(idx + 1)
    const key = KEY_ALIASES[rawKey]
    if (!key) {
      free.push(token)
      continue
    }

    switch (key) {
      case 'environment':
        out.environment = value
        break
      case 'errorType':
        out.errorType = value
        break
      case 'last': {
        const ms = parseDuration(value)
        if (ms == null) {
          out.warnings.push(`unrecognised duration: ${token}`)
          break
        }
        out.lastSeenAfter = new Date(now.getTime() - ms).toISOString()
        break
      }
      case 'release':
        out.release = value
        break
      case 'status':
        if (!VALID_STATUS.has(value)) {
          out.warnings.push(`unrecognised status: ${token}`)
          break
        }
        out.status = value as IssueStatusValue
        break
    }
  }

  if (free.length > 0) out.freeText = free.join(' ')
  return out
}

/** Returns ms, or null on bad input. Accepts `Nm`, `Nh`, `Nd` with N ≥ 1. */
export function parseDuration(value: string): null | number {
  const m = /^(\d+)([mhd])$/.exec(value)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isInteger(n) || n <= 0) return null
  switch (m[2]) {
    case 'd':
      return n * 86_400_000
    case 'h':
      return n * 3_600_000
    case 'm':
      return n * 60_000
  }
  return null
}

/**
 * Round-trip a structured query back into a string, for putting parsed
 * state back into the search input after restoring from URL or saved
 * view. Stable order: errorType, environment, release, status, last.
 */
export function formatIssueQuery(q: Omit<ParsedIssueQuery, 'warnings'>): string {
  const parts: string[] = []
  if (q.errorType) parts.push(`errorType:${q.errorType}`)
  if (q.environment) parts.push(`env:${q.environment}`)
  if (q.release) parts.push(`release:${q.release}`)
  if (q.status) parts.push(`status:${q.status}`)
  if (q.lastSeenAfter) {
    // We don't round-trip the original `Nh/Nd` literal — we lose that
    // when parsing. Format the diff against now so the chip is human-
    // readable; precision rounds down to the nearest hour/day.
    const ms = Date.now() - new Date(q.lastSeenAfter).getTime()
    if (ms > 0) {
      const days = Math.round(ms / 86_400_000)
      if (days >= 1) parts.push(`last:${days}d`)
      else parts.push(`last:${Math.max(1, Math.round(ms / 3_600_000))}h`)
    }
  }
  if (q.freeText) parts.push(q.freeText)
  return parts.join(' ')
}

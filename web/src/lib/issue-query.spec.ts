import { describe, expect, it } from 'vitest'

import { formatIssueQuery, parseDuration, parseIssueQuery } from './issue-query'

describe('parseIssueQuery', () => {
  const NOW = new Date('2026-05-10T12:00:00Z')

  it('returns empty result for empty input', () => {
    const q = parseIssueQuery('', NOW)
    expect(q).toEqual({ warnings: [] })
  })

  it('parses single key:value tokens', () => {
    const q = parseIssueQuery('errorType:TypeError env:prod release:myapp@1.2.3', NOW)
    expect(q.errorType).toBe('TypeError')
    expect(q.environment).toBe('prod')
    expect(q.release).toBe('myapp@1.2.3')
    expect(q.warnings).toEqual([])
  })

  it('aliases error→errorType and env→environment', () => {
    const q = parseIssueQuery('error:Foo env:staging', NOW)
    expect(q.errorType).toBe('Foo')
    expect(q.environment).toBe('staging')
  })

  it('parses status against the valid set', () => {
    expect(parseIssueQuery('status:resolved', NOW).status).toBe('resolved')
    expect(parseIssueQuery('status:regressed', NOW).status).toBe('regressed')
    const bad = parseIssueQuery('status:bogus', NOW)
    expect(bad.status).toBeUndefined()
    expect(bad.warnings).toEqual(['unrecognised status: status:bogus'])
  })

  it('parses last: into RFC 3339 timestamps relative to now', () => {
    expect(parseIssueQuery('last:24h', NOW).lastSeenAfter).toBe('2026-05-09T12:00:00.000Z')
    expect(parseIssueQuery('last:7d', NOW).lastSeenAfter).toBe('2026-05-03T12:00:00.000Z')
    expect(parseIssueQuery('last:30m', NOW).lastSeenAfter).toBe('2026-05-10T11:30:00.000Z')
    const bad = parseIssueQuery('last:nope', NOW)
    expect(bad.lastSeenAfter).toBeUndefined()
    expect(bad.warnings).toEqual(['unrecognised duration: last:nope'])
  })

  it('accumulates unkeyed tokens into freeText', () => {
    const q = parseIssueQuery('TypeError checkout flow', NOW)
    expect(q.freeText).toBe('TypeError checkout flow')
    expect(q.errorType).toBeUndefined()
  })

  it('mixes keyed and unkeyed tokens', () => {
    const q = parseIssueQuery('error:TypeError checkout env:prod boom', NOW)
    expect(q.errorType).toBe('TypeError')
    expect(q.environment).toBe('prod')
    expect(q.freeText).toBe('checkout boom')
  })

  it('treats unknown keys as free text rather than warning', () => {
    // Keeps behavior friendly: typos in the key just degrade to search.
    const q = parseIssueQuery('foo:bar', NOW)
    expect(q.freeText).toBe('foo:bar')
    expect(q.warnings).toEqual([])
  })
})

describe('parseDuration', () => {
  it('parses Nm Nh Nd', () => {
    expect(parseDuration('5m')).toBe(5 * 60_000)
    expect(parseDuration('3h')).toBe(3 * 3_600_000)
    expect(parseDuration('2d')).toBe(2 * 86_400_000)
  })

  it('rejects 0, negative, fractional, and unknown units', () => {
    expect(parseDuration('0d')).toBeNull()
    expect(parseDuration('-1h')).toBeNull()
    expect(parseDuration('1.5d')).toBeNull()
    expect(parseDuration('1y')).toBeNull()
    expect(parseDuration('')).toBeNull()
  })
})

describe('formatIssueQuery', () => {
  it('round-trips key:value tokens in stable order', () => {
    expect(
      formatIssueQuery({
        environment: 'prod',
        errorType: 'TypeError',
        release: 'myapp@1.2.3',
        status: 'resolved',
      })
    ).toBe('errorType:TypeError env:prod release:myapp@1.2.3 status:resolved')
  })

  it('appends freeText at the end', () => {
    expect(formatIssueQuery({ errorType: 'X', freeText: 'boom checkout' })).toBe(
      'errorType:X boom checkout'
    )
  })
})

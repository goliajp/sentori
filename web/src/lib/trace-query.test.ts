import { describe, expect, it } from 'vitest'

import { parseDurationFilter, parseTraceQuery } from './trace-query'

describe('parseTraceQuery', () => {
  it('parses three keyed terms', () => {
    const r = parseTraceQuery('op:http.client status:error duration:>500ms')
    expect(r.op).toBe('http.client')
    expect(r.status).toBe('error')
    expect(r.minDurationMs).toBe(500)
    expect(r.warnings).toEqual([])
  })

  it('accepts duration in seconds', () => {
    expect(parseTraceQuery('duration:>2s').minDurationMs).toBe(2000)
  })

  it('rejects bare free text with a warning', () => {
    const r = parseTraceQuery('hello world')
    expect(r.op).toBeUndefined()
    expect(r.warnings).toEqual(['free text not supported: hello', 'free text not supported: world'])
  })

  it('warns on unknown keys', () => {
    const r = parseTraceQuery('foo:bar')
    expect(r.warnings).toEqual(['unknown filter: foo'])
  })

  it('warns on bad status value', () => {
    const r = parseTraceQuery('status:bogus')
    expect(r.status).toBeUndefined()
    expect(r.warnings).toEqual(['bad status: status:bogus'])
  })

  it('warns on bad duration value', () => {
    const r = parseTraceQuery('duration:500')
    expect(r.minDurationMs).toBeUndefined()
    expect(r.warnings).toEqual(['bad duration: duration:500'])
  })

  it('returns empty parse for empty input', () => {
    expect(parseTraceQuery('')).toEqual({ warnings: [] })
    expect(parseTraceQuery('   ')).toEqual({ warnings: [] })
  })
})

describe('parseDurationFilter', () => {
  it('parses ms and s', () => {
    expect(parseDurationFilter('>500ms')).toBe(500)
    expect(parseDurationFilter('>2s')).toBe(2000)
  })

  it('rejects missing > prefix', () => {
    expect(parseDurationFilter('500ms')).toBeNull()
  })

  it('rejects zero and negative', () => {
    expect(parseDurationFilter('>0ms')).toBeNull()
    expect(parseDurationFilter('>-5ms')).toBeNull()
  })

  it('rejects unrecognised unit', () => {
    expect(parseDurationFilter('>5min')).toBeNull()
  })
})

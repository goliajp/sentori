import { describe, expect, it } from 'vitest'

import { type GroupableCrumb, groupBreadcrumbs } from './breadcrumb-timeline'

const crumb = (type: string, ts: string, data: Record<string, unknown> = {}): GroupableCrumb => ({
  data,
  timestamp: ts,
  type,
})

describe('groupBreadcrumbs', () => {
  it('puts every crumb in its own group when types differ', () => {
    const groups = groupBreadcrumbs([
      crumb('nav', '2026-05-10T12:00:00.000Z'),
      crumb('net', '2026-05-10T12:00:00.500Z'),
      crumb('log', '2026-05-10T12:00:01.000Z'),
    ])
    expect(groups.map((g) => g.type)).toEqual(['nav', 'net', 'log'])
    expect(groups.every((g) => g.crumbs.length === 1)).toBe(true)
  })

  it('collapses adjacent same-type crumbs within 1s', () => {
    const groups = groupBreadcrumbs([
      crumb('net', '2026-05-10T12:00:00.000Z'),
      crumb('net', '2026-05-10T12:00:00.300Z'),
      crumb('net', '2026-05-10T12:00:00.700Z'),
      crumb('net', '2026-05-10T12:00:02.000Z'),
    ])
    // First three are within 1s of each other → one group of 3.
    // Fourth jumps a >1s gap (1.3s) → new group of 1.
    expect(groups.length).toBe(2)
    expect(groups[0]!.crumbs.length).toBe(3)
    expect(groups[1]!.crumbs.length).toBe(1)
  })

  it('breaks the group on type change even if timing is tight', () => {
    const groups = groupBreadcrumbs([
      crumb('net', '2026-05-10T12:00:00.000Z'),
      crumb('nav', '2026-05-10T12:00:00.100Z'),
      crumb('net', '2026-05-10T12:00:00.200Z'),
    ])
    expect(groups.map((g) => g.type)).toEqual(['net', 'nav', 'net'])
    expect(groups.every((g) => g.crumbs.length === 1)).toBe(true)
  })

  it('handles an empty input', () => {
    expect(groupBreadcrumbs([])).toEqual([])
  })
})

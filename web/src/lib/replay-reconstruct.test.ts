import { describe, expect, it } from 'vitest'

import { asV2OrUpgradeV1, parseLines, ReplayTimeline } from './replay-reconstruct'

type Node = {
  x: number
  y: number
  w: number
  h: number
  kind?: string
  text?: string
  color?: string
}

function key(ts: number, nodes: Node[], width = 1080, height = 2340) {
  return JSON.stringify({ ts, kind: 'key', width, height, nodes })
}
function delta(
  ts: number,
  added: Node[] = [],
  changed: Node[] = [],
  removed: Pick<Node, 'x' | 'y' | 'w' | 'h'>[] = []
) {
  return JSON.stringify({ ts, kind: 'delta', added, changed, removed })
}
function rect(x: number, y: number, w: number, h: number, color = '#FF0000FF'): Node {
  return { x, y, w, h, kind: 'rect', color }
}

describe('parseLines', () => {
  it('parses key + delta lines, skipping malformed lines', () => {
    const ndjson = [
      key(1000, [rect(0, 0, 100, 100)]),
      '{not json',
      delta(1250, [rect(0, 100, 100, 100)]),
    ].join('\n')
    const lines = parseLines(ndjson)
    expect(lines.length).toBe(2)
    expect(lines[0]?.kind).toBe('key')
    expect(lines[1]?.kind).toBe('delta')
  })

  it('returns empty on empty input', () => {
    expect(parseLines('')).toEqual([])
  })
})

describe('ReplayTimeline', () => {
  it('reconstructs the initial keyframe state at start ts', () => {
    const lines = parseLines(key(1000, [rect(0, 0, 100, 100)]))
    const tl = new ReplayTimeline(lines)
    const f = tl.reconstructAt(1000)
    expect(f?.nodes.length).toBe(1)
    expect(f?.nodes[0]?.x).toBe(0)
  })

  it('applies an added node from a delta', () => {
    const ndjson = [
      key(1000, [rect(0, 0, 100, 100)]),
      delta(1250, [rect(0, 100, 100, 100, '#00FF00FF')], [], []),
    ].join('\n')
    const tl = new ReplayTimeline(parseLines(ndjson))
    const f = tl.reconstructAt(1250)
    expect(f?.nodes.length).toBe(2)
  })

  it('applies a changed node (matches by fingerprint, overrides fields)', () => {
    const a = rect(0, 0, 100, 100, '#FF0000FF')
    const a2 = rect(0, 0, 100, 100, '#0000FFFF')
    const ndjson = [key(1000, [a]), delta(1250, [], [a2], [])].join('\n')
    const tl = new ReplayTimeline(parseLines(ndjson))
    const f = tl.reconstructAt(1250)
    expect(f?.nodes.length).toBe(1)
    expect(f?.nodes[0]?.color).toBe('#0000FFFF')
  })

  it('applies a removed node', () => {
    const a = rect(0, 0, 100, 100)
    const b = rect(0, 100, 100, 100)
    const ndjson = [
      key(1000, [a, b]),
      delta(1250, [], [], [{ x: 0, y: 100, w: 100, h: 100 }]),
    ].join('\n')
    const tl = new ReplayTimeline(parseLines(ndjson))
    const f = tl.reconstructAt(1250)
    expect(f?.nodes.length).toBe(1)
    expect(f?.nodes[0]?.y).toBe(0)
  })

  it('reconstructAt(ts after end) clamps to last state', () => {
    const ndjson = [key(1000, [rect(0, 0, 100, 100)])].join('\n')
    const tl = new ReplayTimeline(parseLines(ndjson))
    const f = tl.reconstructAt(99_999_999)
    expect(f?.nodes.length).toBe(1)
  })

  it('reconstructAt with a fresh keyframe between memo and target rebuilds correctly', () => {
    const ndjson = [
      key(1000, [rect(0, 0, 100, 100)]),
      delta(1250, [rect(0, 100, 100, 100)]),
      key(2000, [rect(0, 200, 100, 100, '#00FF00FF')]), // resets state
      delta(2250, [rect(0, 300, 100, 100)]),
    ].join('\n')
    const tl = new ReplayTimeline(parseLines(ndjson))
    // First seek into the first segment
    let f = tl.reconstructAt(1250)
    expect(f?.nodes.length).toBe(2)
    // Seek across the keyframe boundary
    f = tl.reconstructAt(2250)
    expect(f?.nodes.length).toBe(2)
    expect(f?.nodes.find((n) => n.y === 200)?.color).toBe('#00FF00FF')
    expect(f?.nodes.find((n) => n.y === 300)).toBeDefined()
  })

  it('memo + repeated seeks does not corrupt state', () => {
    const ndjson = [
      key(1000, [rect(0, 0, 100, 100)]),
      delta(1250, [rect(0, 100, 100, 100)]),
      delta(1500, [rect(0, 200, 100, 100)]),
    ].join('\n')
    const tl = new ReplayTimeline(parseLines(ndjson))
    expect(tl.reconstructAt(1500)?.nodes.length).toBe(3)
    expect(tl.reconstructAt(1250)?.nodes.length).toBe(2) // rewind, should re-anchor
    expect(tl.reconstructAt(1500)?.nodes.length).toBe(3) // forward again
  })

  it('durationMs returns last ts minus first ts', () => {
    const ndjson = [key(1000, []), delta(3000, [])].join('\n')
    const tl = new ReplayTimeline(parseLines(ndjson))
    expect(tl.durationMs()).toBe(2000)
  })

  it('keyframeTimes lists only keyframe timestamps', () => {
    const ndjson = [key(1000, []), delta(1250, []), key(2000, []), delta(2250, [])].join('\n')
    const tl = new ReplayTimeline(parseLines(ndjson))
    expect(tl.keyframeTimes()).toEqual([1000, 2000])
  })
})

describe('asV2OrUpgradeV1', () => {
  it('parses v2 NDJSON directly', () => {
    const ndjson = key(1000, [rect(0, 0, 100, 100)])
    const lines = asV2OrUpgradeV1(ndjson)
    expect(lines.length).toBe(1)
    expect(lines[0]?.kind).toBe('key')
  })

  it('upgrades v1 (no-kind) lines to keyframes', () => {
    const v1 = [
      JSON.stringify({ ts: 1000, width: 1080, height: 2340, nodes: [rect(0, 0, 100, 100)] }),
      JSON.stringify({ ts: 2000, width: 1080, height: 2340, nodes: [rect(0, 100, 100, 100)] }),
    ].join('\n')
    const lines = asV2OrUpgradeV1(v1)
    expect(lines.length).toBe(2)
    expect(lines.every((l) => l.kind === 'key')).toBe(true)
  })
})

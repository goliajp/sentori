import { describe, expect, it } from 'vitest'

import type { ReplayFrame } from '@/api/client'

import { computeDiff, summariseDiff } from './replay-tab'

// Small helper — build a frame with whatever nodes are passed in,
// fixed viewport so the diff matcher (which keys by x,y,w,h) is the
// only variable we're testing.
const frame = (nodes: ReplayFrame['nodes']): ReplayFrame => ({
  height: 844,
  nodes,
  ts: 0,
  width: 390,
})

describe('computeDiff', () => {
  it('marks every node "same" when both frames are identical', () => {
    const f = frame([
      { color: '#fff', h: 20, kind: 'text', text: 'hi', w: 100, x: 10, y: 10 },
      { color: '#000', h: 50, kind: 'rect', w: 200, x: 0, y: 50 },
    ])
    const diff = computeDiff(f, f)
    expect(diff.status).toEqual(['same', 'same'])
    expect(diff.removed).toEqual([])
  })

  it('flags new spatial positions as "added"', () => {
    const prev = frame([{ color: '#fff', h: 20, kind: 'text', text: 'a', w: 100, x: 10, y: 10 }])
    const next = frame([
      { color: '#fff', h: 20, kind: 'text', text: 'a', w: 100, x: 10, y: 10 },
      { color: '#abc', h: 30, kind: 'rect', w: 50, x: 200, y: 200 },
    ])
    const diff = computeDiff(prev, next)
    expect(diff.status).toEqual(['same', 'added'])
    expect(diff.removed).toEqual([])
  })

  it('flags vanishing positions as "removed" (and reports their prev index)', () => {
    const prev = frame([
      { color: '#fff', h: 20, kind: 'text', text: 'a', w: 100, x: 10, y: 10 },
      { color: '#abc', h: 30, kind: 'rect', w: 50, x: 200, y: 200 },
    ])
    const next = frame([{ color: '#fff', h: 20, kind: 'text', text: 'a', w: 100, x: 10, y: 10 }])
    const diff = computeDiff(prev, next)
    expect(diff.status).toEqual(['same'])
    expect(diff.removed).toEqual([1])
  })

  it('detects "changed" when spatial position matches but text/color/kind differs', () => {
    const prev = frame([{ color: '#aaa', h: 20, kind: 'text', text: 'before', w: 100, x: 10, y: 10 }])
    const next = frame([{ color: '#aaa', h: 20, kind: 'text', text: 'after', w: 100, x: 10, y: 10 }])
    const diff = computeDiff(prev, next)
    expect(diff.status).toEqual(['changed'])
    expect(diff.removed).toEqual([])
  })

  it('rounds fractional positions before keying — drift of <1px is "same"', () => {
    const prev = frame([{ color: '#fff', h: 20, kind: 'rect', w: 100, x: 10, y: 10 }])
    const next = frame([{ color: '#fff', h: 20, kind: 'rect', w: 100, x: 10.4, y: 10.49 }])
    const diff = computeDiff(prev, next)
    // 10.4 → 10, 10.49 → 10 by Math.round, so both nodes key the same.
    expect(diff.status).toEqual(['same'])
    expect(diff.removed).toEqual([])
  })
})

describe('summariseDiff', () => {
  it('returns zero counts on identical frames', () => {
    const f = frame([{ color: '#fff', h: 20, kind: 'rect', w: 100, x: 0, y: 0 }])
    expect(summariseDiff(f, f)).toEqual({ added: 0, changed: 0, removed: 0 })
  })

  it('counts add / change / remove together correctly', () => {
    const prev = frame([
      { color: '#aaa', h: 20, kind: 'text', text: 't', w: 50, x: 0, y: 0 },
      { color: '#bbb', h: 30, kind: 'rect', w: 60, x: 0, y: 100 },
    ])
    const next = frame([
      // node 0 changed text → "changed"
      { color: '#aaa', h: 20, kind: 'text', text: 'new', w: 50, x: 0, y: 0 },
      // node 1 (rect at y=100) is gone → "removed"
      // new node at y=200 → "added"
      { color: '#ccc', h: 40, kind: 'image', w: 70, x: 0, y: 200 },
    ])
    expect(summariseDiff(prev, next)).toEqual({ added: 1, changed: 1, removed: 1 })
  })
})

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import { addBreadcrumb, clearBreadcrumbs, getBreadcrumbs } from '../src/breadcrumbs.js'
import { captureError, setUser } from '../src/capture.js'
import { setConfig } from '../src/config.js'
import { parseStack } from '../src/stack.js'
import type { Event } from '../src/types.js'
import { uuidV7 } from '../src/uuid.js'

// ── transport mocking ──
let sent: Event[] = []
const fetchMock = mock(async (_url: string | URL | Request, init?: RequestInit) => {
  if (init?.body && typeof init.body === 'string') {
    sent.push(JSON.parse(init.body) as Event)
  }
  return new Response('', { status: 202 })
})
beforeEach(() => {
  sent = []
  fetchMock.mockClear()
  clearBreadcrumbs()
  setUser(null)
  ;(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch
  setConfig({
    enableGlobalHooks: false,
    environment: 'test',
    ingestUrl: 'https://ingest.example.com',
    release: 'myapp@1.2.3+456',
    token: 'st_pk_testtokentoken',
  })
})
afterEach(() => {
  ;(globalThis as { fetch?: typeof fetch }).fetch = undefined as unknown as typeof fetch
})

describe('uuidV7', () => {
  test('produces a v7-shaped id with the version nibble set', () => {
    const id = uuidV7()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('two consecutive ids differ', () => {
    expect(uuidV7()).not.toBe(uuidV7())
  })
})

describe('parseStack', () => {
  test('parses a v8 stack', () => {
    const frames = parseStack(`Error: boom
    at level3 (App.tsx:10:5)
    at level2 (App.tsx:6:10)`)
    expect(frames.length).toBe(2)
    expect(frames[0]?.function).toBe('level3')
    expect(frames[0]?.line).toBe(10)
    expect(frames[0]?.column).toBe(5)
  })

  test('returns empty for missing stack', () => {
    expect(parseStack(undefined)).toEqual([])
  })

  test('strips https:// prefix from file', () => {
    const frames = parseStack(`Error: boom
    at fn (https://example.com/static/App.tsx:1:1)`)
    expect(frames[0]?.file).toBe('static/App.tsx')
  })
})

describe('breadcrumbs', () => {
  test('caps at 100 entries', () => {
    for (let i = 0; i < 110; i++) addBreadcrumb({ data: { i }, type: 'log' })
    const out = getBreadcrumbs()
    expect(out.length).toBe(100)
    // FIFO drop: entry 0..9 should be gone; first should be { i: 10 }
    expect((out[0] as { data: { i: number } }).data.i).toBe(10)
  })
})

describe('captureError', () => {
  test('POSTs an event with parsed stack + user + breadcrumbs', async () => {
    setUser({ anonymous: true, id: 'user-42' })
    addBreadcrumb({ data: { url: '/login' }, type: 'nav' })
    const err = new TypeError('something bad')
    captureError(err, { tags: { plan: 'pro' } })

    // captureError fires-and-forgets; tick the microtask queue.
    await Promise.resolve()
    await Promise.resolve()

    expect(sent.length).toBe(1)
    const ev = sent[0]!
    expect(ev.kind).toBe('error')
    expect(ev.platform).toBe('javascript')
    expect(ev.error.type).toBe('TypeError')
    expect(ev.error.message).toBe('something bad')
    expect(ev.user).toEqual({ anonymous: true, id: 'user-42' })
    expect(ev.tags).toEqual({ plan: 'pro' })
    expect(ev.breadcrumbs.length).toBe(1)
    expect(ev.breadcrumbs[0]?.type).toBe('nav')
    expect(ev.release).toBe('myapp@1.2.3+456')
    expect(ev.environment).toBe('test')
    expect(ev.app.version).toBe('1.2.3')
  })

  test('wraps cause chain', async () => {
    const inner = new Error('root cause')
    const outer = new Error('wrapper')
    ;(outer as { cause?: unknown }).cause = inner
    captureError(outer)
    await Promise.resolve()
    await Promise.resolve()
    expect(sent.length).toBe(1)
    const ev = sent[0]!
    expect(ev.error.cause?.message).toBe('root cause')
  })
})

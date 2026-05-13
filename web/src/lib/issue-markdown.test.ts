import { describe, expect, it } from 'vitest'

import type { Breadcrumb, EventRow, Frame, IssueRow } from '@/api/client'

import { renderIssueMarkdown } from './issue-markdown'

const issue = (over: Partial<IssueRow> = {}): IssueRow =>
  ({
    eventCount: 1,
    errorType: 'TypeError',
    fingerprint: 'fp',
    firstSeen: '2026-05-13T10:00:00Z',
    id: 'issue-1',
    lastSeen: '2026-05-13T10:01:00Z',
    messageSample: 'boom',
    status: 'active',
    ...over,
  }) as IssueRow

const frame = (over: Partial<Frame>): Frame => ({
  column: 18,
  file: 'src/Foo.tsx',
  function: 'doThing',
  inApp: true,
  line: 42,
  ...over,
})

const event = (over: Partial<EventRow> = {}): EventRow =>
  ({
    environment: 'prod',
    errorMessage: 'boom',
    errorType: 'TypeError',
    id: '019eaa00-7000-7000-8000-000000000001',
    occurredAt: '2026-05-13T10:01:00Z',
    payload: {
      app: { build: '456', version: '1.2.3' },
      breadcrumbs: [
        {
          data: { durationMs: 123, method: 'POST', status: 500, url: '/login' },
          timestamp: '2026-05-13T10:00:56Z',
          type: 'net',
        } as Breadcrumb,
        {
          data: { from: 'Home', to: 'Login' },
          timestamp: '2026-05-13T10:00:55Z',
          type: 'nav',
        } as Breadcrumb,
      ],
      device: { os: 'ios', osVersion: '17.0' },
      environment: 'prod',
      error: {
        cause: null,
        message: 'boom',
        stack: [
          frame({
            contextLine: "  await api.post('/login', payload)",
            postContext: ['  } catch (e) {', '    setError(e.message)'],
            preContext: ['  try {'],
          }),
          frame({
            file: 'node_modules/react/cjs/react.dev.js',
            function: 'invokeGuardedCallbackImpl',
            inApp: false,
            line: 999,
          }),
        ],
        type: 'TypeError',
      },
      id: '019eaa00-7000-7000-8000-000000000001',
      kind: 'error',
      platform: 'react-native',
      release: 'myapp@1.2.3+456',
      spanId: null,
      tags: {},
      timestamp: '2026-05-13T10:01:00Z',
      traceId: null,
      user: null,
    },
    platform: 'react-native',
    receivedAt: '2026-05-13T10:01:00.123Z',
    release: 'myapp@1.2.3+456',
    spanId: null,
    traceId: null,
    ...over,
  }) as EventRow

describe('renderIssueMarkdown', () => {
  it('renders the headline + meta + stack + breadcrumbs', () => {
    const md = renderIssueMarkdown({
      event: event(),
      issue: issue(),
      orgSlug: 'acme',
      origin: 'https://app.sentori.golia.jp',
    })
    expect(md).toContain('## TypeError: boom')
    expect(md).toContain('**Release:** myapp@1.2.3+456')
    expect(md).toContain('**Issue:** https://app.sentori.golia.jp/org/acme/issues/issue-1')
    expect(md).toContain('### Stack (top 5 in-app frames)')
    expect(md).toContain('`doThing` — `src/Foo.tsx:42:18`')
    // Code fence with language tag
    expect(md).toMatch(/```tsx[\s\S]+await api\.post[\s\S]+```/)
    // At-line marker
    expect(md).toMatch(/42 → /)
    // Breadcrumbs
    expect(md).toContain('### Breadcrumbs')
    expect(md).toContain('net POST /login 500 (123ms)')
    expect(md).toContain('nav Home → Login')
  })

  it('only emits in-app frames up to the cap, even when more exist', () => {
    const stack = Array.from({ length: 10 }, (_, i) =>
      frame({ file: `src/F${i}.tsx`, function: `fn${i}`, line: 100 + i })
    )
    const e = event()
    e.payload.error.stack = stack
    const md = renderIssueMarkdown({
      event: e,
      issue: issue(),
      orgSlug: 'acme',
      origin: 'https://example.com',
    })
    expect(md).toContain('fn0')
    expect(md).toContain('fn4') // first 5 = fn0..fn4
    expect(md).not.toContain('fn5')
    expect(md).not.toContain('fn6')
  })

  it('falls back to vendor frames when no in-app exists', () => {
    const e = event()
    e.payload.error.stack = [
      frame({ file: 'node_modules/react/x.js', function: 'libFn', inApp: false, line: 1 }),
    ]
    const md = renderIssueMarkdown({
      event: e,
      issue: issue(),
      orgSlug: 'acme',
      origin: 'https://example.com',
    })
    expect(md).toContain('libFn')
  })

  it('recurses into the cause chain', () => {
    const e = event()
    e.payload.error.cause = {
      cause: null,
      message: 'underlying',
      stack: [frame({ function: 'libFn' })],
      type: 'RangeError',
    }
    const md = renderIssueMarkdown({
      event: e,
      issue: issue(),
      orgSlug: 'acme',
      origin: 'https://example.com',
    })
    expect(md).toContain('caused by `RangeError: underlying`')
  })
})

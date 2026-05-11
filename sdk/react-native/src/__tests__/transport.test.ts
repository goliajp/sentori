import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';

import { setConfig, __resetForTests as resetConfig } from '../config';
import {
  enqueue,
  flush,
  startTransport,
  __resetForTests as resetTransport,
  __peekQueue,
} from '../transport';
import type { Event } from '../types';

const makeEvent = (id: string): Event => ({
  id,
  timestamp: '2026-05-09T00:00:00.000Z',
  kind: 'error',
  platform: 'javascript',
  release: 'app@1.0.0+1',
  environment: 'test',
  device: { os: 'ios', osVersion: '17.0' },
  app: { version: '1.0.0' },
  error: {
    type: 'TypeError',
    message: 'x',
    stack: [{ file: 'a.ts', line: 1, inApp: true }],
    cause: null,
  },
});

const originalFetch = globalThis.fetch;

describe('transport', () => {
  beforeEach(() => {
    resetConfig();
    resetTransport();
    setConfig({
      token: 'st_pk_test',
      release: 'app@1.0.0+1',
      environment: 'test',
      ingestUrl: 'http://localhost:8080',
      enabled: true,
    });
    startTransport();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('enqueues without immediate flush below batch size', () => {
    enqueue(makeEvent('a'));
    expect(__peekQueue()).toHaveLength(1);
  });

  it('flush sends to /v1/events for single event', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = mock(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 202 });
      },
    ) as typeof fetch;

    enqueue(makeEvent('a'));
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://localhost:8080/v1/events');
  });

  it('flush sends to /v1/events:batch for multiple events', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = mock(
      async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return new Response(null, { status: 202 });
      },
    ) as typeof fetch;

    enqueue(makeEvent('a'));
    enqueue(makeEvent('b'));
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://localhost:8080/v1/events:batch');
    const body = JSON.parse((calls[0]?.init?.body as string) ?? '{}');
    expect(body.events).toHaveLength(2);
  });

  it('attaches Authorization and Sentori-Sdk headers', async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = mock(
      async (_url: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = init?.headers as Record<string, string>;
        return new Response(null, { status: 202 });
      },
    ) as typeof fetch;

    enqueue(makeEvent('a'));
    await flush();

    expect(capturedHeaders?.Authorization).toBe('Bearer st_pk_test');
    expect(capturedHeaders?.['Sentori-Sdk']).toMatch(/^react-native\//);
  });

  // Phase 33 sub-D: offline / retry behavior.

  it('retries up to MAX_RETRY (3) on a 5xx, then gives up', async () => {
    let attempts = 0;
    globalThis.fetch = mock(async () => {
      attempts++;
      return new Response('boom', { status: 503 });
    }) as typeof fetch;

    enqueue(makeEvent('a'));
    // flush swallows the final throw (and falls through to persist).
    // We're verifying the retry count, not the throw.
    await flush();
    expect(attempts).toBe(3);
  });

  it('retries on network error (fetch throw), succeeds when recovered', async () => {
    let attempts = 0;
    globalThis.fetch = mock(async () => {
      attempts++;
      if (attempts < 3) throw new TypeError('NetworkError: offline');
      return new Response(null, { status: 202 });
    }) as typeof fetch;

    enqueue(makeEvent('a'));
    await flush();
    expect(attempts).toBe(3);
  });

  it('drops 4xx-other-than-429 without retry (client errors are unrecoverable)', async () => {
    let attempts = 0;
    globalThis.fetch = mock(async () => {
      attempts++;
      return new Response(null, { status: 400 });
    }) as typeof fetch;

    enqueue(makeEvent('a'));
    await flush();
    // sendOnce treats 4xx-other-than-429 as a no-throw exit, so the
    // retry loop also exits — one attempt, no double-send.
    expect(attempts).toBe(1);
  });

  it('does not duplicate events when flush is called twice in a row', async () => {
    let attempts = 0;
    globalThis.fetch = mock(async () => {
      attempts++;
      return new Response(null, { status: 202 });
    }) as typeof fetch;

    enqueue(makeEvent('a'));
    enqueue(makeEvent('b'));
    await flush();
    await flush(); // second flush sees an empty queue and no-ops
    expect(attempts).toBe(1);
    expect(__peekQueue()).toHaveLength(0);
  });
});

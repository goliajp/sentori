// Push registration: never throws, and names why it failed.
//
// There were no push tests in this package at all. That is the
// reason three unbalanced INSERTs on the server and two field
// mismatches in this file survived a year: every one of them made
// registration fail, and nothing anywhere asserted that registration
// succeeds.

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { __setNativeForTests } from '../native';
import {
  __resetForTests as resetPush,
  __setPlatformForTests as setPlatform,
  register,
} from '../push';
import { __resetForTests as resetConfig, setConfig } from '../config';
import { __resetForTests as resetScope } from '../scope';

const baseConfig = {
  token: 'st_test',
  ingestUrl: 'http://localhost:18080',
  release: 'app@1.0.0',
  environment: 'test',
  enabled: true,
  detect: { rageTap: false, longFreeze: false, slowColdStart: false, slowApi: false },
  replaySeconds: 30,
};

/** A native module that grants permission and hands back a token on
 *  the first drain — the shape the real one has when everything
 *  works. Override pieces per test. */
function grantingNative(over: Record<string, unknown> = {}) {
  return {
    pushRequestPermission: () => Promise.resolve('granted'),
    pushGetStatus: () => Promise.resolve('granted'),
    pushRegister: () => undefined,
    pushUnregister: () => undefined,
    pushDrainState: () => Promise.resolve({ token: 'abc123', notifications: [], taps: [] }),
    ...over,
  };
}

const realFetch = globalThis.fetch;

/** Answer /v1/push/tokens with `body` under `status`. */
function stubFetch(status: number, body: unknown): void {
  globalThis.fetch = (() =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    })) as unknown as typeof fetch;
}

describe('push.register', () => {
  beforeEach(() => {
    resetPush();
    resetConfig();
    resetScope();
    setPlatform('ios');
    setConfig(baseConfig);
  });
  afterEach(() => {
    resetPush();
    resetConfig();
    resetScope();
    setPlatform(null);
    __setNativeForTests(undefined);
    globalThis.fetch = realFetch;
  });

  it('returns the device handle when the whole flow works', async () => {
    __setNativeForTests(grantingNative());
    stubFetch(200, { token_id: '018f0000-0000-7000-8000-000000000001', is_new: true });

    const r = await register();

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ipt).toBe('018f0000-0000-7000-8000-000000000001');
  });

  it('sends `kind`, not `provider` — the field name that 422d for a year', async () => {
    __setNativeForTests(grantingNative());
    let sent: Record<string, unknown> = {};
    globalThis.fetch = ((_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token_id: 'id-1' }),
      });
    }) as unknown as typeof fetch;

    await register();

    expect(sent.kind).toBe('apns');
    expect(sent.provider).toBeUndefined();
  });

  it('sends kind=fcm and no env on Android — FCM has no sandbox split', async () => {
    setPlatform('android');
    __setNativeForTests(grantingNative());
    let sent: Record<string, unknown> = {};
    globalThis.fetch = ((_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body) as Record<string, unknown>;
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token_id: 'id-1' }),
      });
    }) as unknown as typeof fetch;

    await register();

    expect(sent.kind).toBe('fcm');
    expect('env' in sent).toBe(false);
  });

  it('reports not-initialised rather than throwing when init() has not run', async () => {
    resetConfig();
    __setNativeForTests(grantingNative());

    const r = await register();

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-initialised');
  });

  it('separates "no native module" from "user declined"', async () => {
    __setNativeForTests(null);
    const absent = await register();
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.reason).toBe('no-transport');

    __setNativeForTests(grantingNative({ pushRequestPermission: () => Promise.resolve('denied') }));
    const declined = await register();
    expect(declined.ok).toBe(false);
    if (!declined.ok) expect(declined.reason).toBe('permission-denied');
  });

  it('reports token-timeout when the OS never hands one back', async () => {
    __setNativeForTests(
      grantingNative({
        pushDrainState: () => Promise.resolve({ notifications: [], taps: [] }),
      }),
    );

    const r = await register({ tokenTimeoutMs: 250 });

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('token-timeout');
  });

  it('reports server-rejected on a non-2xx, and on a 2xx with no id', async () => {
    __setNativeForTests(grantingNative());

    stubFetch(500, {});
    const five = await register();
    expect(five.ok).toBe(false);
    if (!five.ok) expect(five.reason).toBe('server-rejected');

    // A 200 that carries nothing usable is the same problem wearing a
    // better status code — this is what the SDK used to accept and
    // then throw on, deeper in.
    stubFetch(200, { ok: true });
    const empty = await register();
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe('server-rejected');
  });

  it('never rejects — the whole point (client zero-cost iron rule)', async () => {
    // Every failure mode in one loop, including a native module that
    // throws out of each of its methods.
    const hostile = [
      null,
      grantingNative({
        pushRequestPermission: () => {
          throw new Error('native exploded');
        },
      }),
      grantingNative({
        pushDrainState: () => Promise.resolve({ error: 'APS denied', notifications: [], taps: [] }),
      }),
    ];
    globalThis.fetch = (() => Promise.reject(new Error('network down'))) as unknown as typeof fetch;

    for (const n of hostile) {
      __setNativeForTests(n as never);
      const r = await register({ tokenTimeoutMs: 150 });
      expect(r.ok).toBe(false);
    }
  });

  it('calls onError but still resolves, so a host can use either style', async () => {
    __setNativeForTests(null);
    let seen: null | string = null;

    const r = await register({ onError: (e) => (seen = e.message) });

    expect(r.ok).toBe(false);
    expect(seen).not.toBeNull();
  });
});

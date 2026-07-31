// The screens ring: capacity, drain shape, mask-query isolation,
// and graceful absence on an old native build.

import { afterEach, describe, expect, mock, test } from 'bun:test';

import { __resetForTests as resetMask, maskedNativeIds, registerMaskQuery } from '../mask';
import {
  __resetForTests as resetRing,
  __setCaptureForTests,
  drainScreenReplay,
  startScreenReplay,
} from '../replay-screens';

afterEach(() => {
  resetRing();
  resetMask();
});

describe('mask query', () => {
  test('unregistered → empty', () => {
    expect(maskedNativeIds()).toEqual([]);
  });

  test('registered query flows through and filters junk', () => {
    registerMaskQuery(() => ['camera-feed', 42 as unknown as string, 'user-email']);
    expect(maskedNativeIds()).toEqual(['camera-feed', 'user-email']);
  });

  test('a throwing query masks nothing and never throws', () => {
    registerMaskQuery(() => {
      throw new Error('boom');
    });
    expect(maskedNativeIds()).toEqual([]);
  });
});

describe('screens ring', () => {
  test('drain on an empty ring is null (old native builds)', () => {
    startScreenReplay(60);
    expect(drainScreenReplay()).toBeNull();
  });

  test('drain emits NDJSON with negative relative timestamps', async () => {
    let n = 0;
    __setCaptureForTests(
      mock(async () => ({ base64: `frame${(n += 1)}`, mediaType: 'image/jpeg' })),
    );
    startScreenReplay(60);
    await new Promise((r) => setTimeout(r, 2_600));
    const out = drainScreenReplay();
    expect(out).not.toBeNull();
    const lines = (out ?? '')
      .split('\n')
      .map((l) => JSON.parse(l) as { t: number; base64: string });
    expect(lines.length).toBeGreaterThanOrEqual(1);
    for (const l of lines) {
      expect(l.t).toBeLessThanOrEqual(0);
      expect(l.base64.startsWith('frame')).toBe(true);
    }
    // drain does not clear: a second error still sees the window
    expect(drainScreenReplay()).not.toBeNull();
  }, 10_000);
});

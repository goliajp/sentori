// slow_cold_start — detected warn scenario (design.md §3, category
// C: 「启动过慢」).
//
// Mini-spec: the native side measures launch → JS-ready (iOS
// mach_absolute_time / Android Process.getStartElapsedRealtime);
// init() calls checkColdStart() once. > 3 s ⇒ one `warn` event,
// scenario `slow_cold_start`, with the measured ms. Always pushes a
// `lifecycle` signal so even a fast start shows on the timeline.
// Graceful no-op when the native module isn't linked (Expo Go,
// tests).

import { pushSignal } from '@goliapkg/sentori-core';

import { getNativeColdStartMs } from './native';
import { warnDetected } from './verbs';

const SLOW_COLD_START_MS = 3_000;

let _coldStartMs: null | number = null;
let _coldStartCaptured = false;

/** Read the native-side cold start measurement once. Cached. */
export function getColdStartMs(): null | number {
  if (_coldStartCaptured) return _coldStartMs;
  _coldStartCaptured = true;
  try {
    _coldStartMs = getNativeColdStartMs();
  } catch {
    _coldStartMs = null;
  }
  return _coldStartMs;
}

/** Called once from init(): signal always, warn when slow. */
export function checkColdStart(detectEnabled: boolean): void {
  const ms = getColdStartMs();
  if (ms === null) return;
  pushSignal('lifecycle', { phase: 'cold_start', ms });
  if (detectEnabled && ms > SLOW_COLD_START_MS) {
    warnDetected('slow_cold_start', {}, { coldStartMs: ms, thresholdMs: SLOW_COLD_START_MS });
  }
}

/** Test-only. */
export function __resetMobileVitalsForTests(): void {
  _coldStartCaptured = false;
  _coldStartMs = null;
}

// v0.9.6 #2 — wireframe Session Replay (SDK side).
//
// 60-slot ring buffer of native-captured wireframe snapshots. Each
// tick calls into `SentoriReplayCapture.captureWireframe(maskIds)`
// which walks the iOS UIView / Android View hierarchy and returns
// one JSON string per snapshot. captureException flushes the ring
// as a `replay` attachment (NDJSON: one snapshot per line).
//
// Why wireframe and not raster:
//   • Storage: 80 nodes × ~80 bytes ≈ 6 KB per snapshot vs ~50 KB
//     for a downsampled JPEG. 60-slot ring ≈ 400 KB raw / ~80 KB
//     gzipped — fits comfortably in the 500 KB attachment cap.
//   • Privacy: no pixels means no accidental PII leaks; mask
//     registry decides what text to replace with "***".
//   • Replay fidelity: less faithful to pixels but enough to see
//     which screen the user was on and what was on it. Dashboard
//     player renders SVG rects — denser-looking than a 1 Hz
//     screenshot strip.

import { startSpan } from '@goliapkg/sentori-core';

import { getRegisteredMaskQuery } from './mask';
import { describeWireframeNative } from './native';

declare const __DEV__: boolean | undefined;

const TICK_INTERVAL_MS = 1000;
const RING_SIZE = 60;

/** Floor on tick period. < 250 ms (4 Hz) the native view-tree walk
 *  dominates the JS thread on mid-tier Android, especially with mask
 *  consultation. The default is 1 Hz; the option exists for
 *  benchmarking, not for production. */
const MIN_TICK_PERIOD_MS = 250;

let _ring: string[] = [];
let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/** Native module ref, resolved once on first start. Caching here
 *  avoids the cost of `requireNativeModule('Sentori')` on every
 *  capture tick (Metro's require cache makes this cheap, but the
 *  per-tick string lookup and possible throw still cost more than
 *  reading a closed-over variable). */
let _nativeMod: ReplayNativeModule | null = null;

export type ReplayOptions = {
  mode?: 'off' | 'wireframe';
  /** Ticks per second. Default 1. */
  hz?: number;
};

export function startReplay(opts: ReplayOptions): void {
  if (_running) return;
  if (opts.mode !== 'wireframe') return;
  // v0.9.10 — gate via expo-modules-core's registry (same path the
  // screenshot capture uses). The previous `isNativeModuleLinked`
  // check looked at the legacy `RN.NativeModules` map, but the
  // Sentori module is registered through expo-modules-core; the
  // legacy map never sees it, so this branch returned "not linked"
  // forever even with the pod correctly attached (Insight 2026-05-17).
  const info = describeWireframeNative();
  if (!info.bound) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        '[sentori] replay: Sentori native module not bound (expo-modules-core) — replay attachments will stay empty',
      );
    }
    return;
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      '[sentori] replay: starting',
      'bound=', info.bound,
      'hasCaptureWireframe=', info.hasCaptureWireframe,
    );
  }
  _running = true;
  _nativeMod = loadNativeReplay();
  const period = Math.max(MIN_TICK_PERIOD_MS, Math.floor(TICK_INTERVAL_MS / (opts.hz ?? 1)));
  _timer = setInterval(() => {
    captureTick();
  }, period);
  (_timer as unknown as { unref?: () => void }).unref?.();
}

export function stopReplay(): void {
  _running = false;
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
  }
  _nativeMod = null;
}

function captureTick(): void {
  if (!_running) return;
  const tickSpan = startSpan('sentori.replay.tick', { name: 'tick' });
  try {
    const maskIds = readMaskIds();
    const snapshot = _nativeMod?.captureWireframe?.(maskIds);
    if (typeof snapshot === 'string' && snapshot.length > 0) {
      _ring.push(snapshot);
      while (_ring.length > RING_SIZE) _ring.shift();
    }
    tickSpan.finish({ status: 'ok' });
  } catch (e) {
    if (e instanceof Error) tickSpan.setTag('error.message', e.message);
    tickSpan.finish({ status: 'error' });
  }
}

function readMaskIds(): string[] {
  const q = getRegisteredMaskQuery();
  if (!q) return [];
  try {
    return q();
  } catch {
    return [];
  }
}

type ReplayNativeModule = {
  captureWireframe?: (maskedIds: string[]) => null | string;
};

function loadNativeReplay(): ReplayNativeModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require('expo-modules-core') as {
      requireNativeModule: <T>(name: string) => T;
    };
    return core.requireNativeModule<ReplayNativeModule>('Sentori');
  } catch {
    return null;
  }
}

/** Drain the ring as NDJSON (one snapshot per line). Empty string
 *  when the ring is empty. Also clears the ring so the next session's
 *  replay starts fresh. */
export function drainReplay(): string {
  if (_ring.length === 0) return '';
  const out = _ring.join('\n');
  _ring = [];
  return out;
}

export function __resetReplayForTests(): void {
  stopReplay();
  _ring = [];
}

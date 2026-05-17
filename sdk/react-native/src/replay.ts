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

/**
 * v0.9.13 — frame-level delta encoding: when the new snapshot matches
 * the last one byte-for-byte (static UI, no animation, off-screen
 * app), skip pushing it. The ring stays meaningful (one frame =
 * one *change*), the attachment shrinks proportionally, and a real
 * idle phase no longer evicts a useful pre-error frame.
 *
 * We only check against the most-recently-pushed snapshot, not the
 * whole ring — that's cheap (one string comparison per tick) and
 * catches the dominant case (idle screens). True content changes
 * fall through and push as before.
 *
 * Budget verification on the iOS showcase (apps/ios-showcase): 60
 * frames at ~120 bytes each → ≈ 7 KB raw NDJSON, well under the
 * 500 KB attachment cap. Heavier RN apps with 200+ visible nodes
 * per frame can land in the 400 KB band; future work in v1.x adds
 * native gzip on upload if real-world traffic ever pushes the cap.
 */
let _lastPushed: null | string = null;

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
  // v0.9.12 — Insight 2026-05-17 report: 0.9.11 emitted the
  // "starting bound=true" line then went silent. Root cause was the
  // `.unref?.()` call that used to live here. Hermes 0.81 doesn't
  // ship a Timer object with the Node-style `unref` method, and the
  // optional-chained call ended up dereferencing a `prototype`
  // property on `undefined` — throwing synchronously inside
  // startReplay, which RN's bridge swallowed silently. Net effect:
  // setInterval registered, captureTick never invoked. Drop the
  // call; replay tick lifecycle is bound to the app process, no
  // event-loop tweak needed.
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn('[sentori] replay: scheduled tick period=', period, 'ms');
  }
}

export function stopReplay(): void {
  _running = false;
  if (_timer !== null) {
    clearInterval(_timer);
    _timer = null;
  }
  _nativeMod = null;
  _emptyTickCount = 0;
  _emptyTickLogStride = 1;
  _firstTickLogged = false;
}

let _emptyTickCount = 0;
let _emptyTickLogStride = 1;
let _thinTickCount = 0;
let _thinTickLogStride = 1;
let _okTickCount = 0;
let _firstTickLogged = false;

/** Anything below this many nodes is suspicious — likely the
 *  walker bailed early (zero-size parent, masked root, etc.).
 *  Insight 2026-05-18 verify event saw 800-node payloads on some
 *  ticks and 1-3-node payloads on others; this threshold flags
 *  the latter without spamming on small-but-valid screens. */
const THIN_RESULT_NODES = 6;

function captureTick(): void {
  if (!_running) return;
  // v0.9.12 — UNCONDITIONAL first-tick log. Proves the setInterval
  // callback is firing at all, before any other code that could
  // throw. 0.9.11's diagnostic was inside a `else if (snapshot==null)`
  // branch that could only surface AFTER the native call returned;
  // useless when the bug is that the tick body never enters.
  if (typeof __DEV__ !== 'undefined' && __DEV__ && !_firstTickLogged) {
    // eslint-disable-next-line no-console
    console.warn('[sentori] replay tick: FIRST INVOCATION');
    _firstTickLogged = true;
  }
  // 0.9.11 called startSpan OUTSIDE the catch block. If
  // `@goliapkg/sentori-core` failed to initialise (or startSpan
  // threw for any other reason on the first tick) the whole tick
  // callback died silently. Wrap so worst case is "no span for this
  // tick" not "no ticks for the session".
  let tickSpan: ReturnType<typeof startSpan> | null = null;
  try {
    tickSpan = startSpan('sentori.replay.tick', { name: 'tick' });
  } catch {
    // never fatal
  }
  try {
    const maskIds = readMaskIds();
    const snapshot = _nativeMod?.captureWireframe?.(maskIds);
    if (typeof snapshot === 'string' && snapshot.length > 0) {
      // v0.9.13 — skip pushing if the frame is identical to the last
      // pushed one. See _lastPushed comment for the rationale.
      if (snapshot !== _lastPushed) {
        _ring.push(snapshot);
        _lastPushed = snapshot;
        while (_ring.length > RING_SIZE) {
          _ring.shift();
        }
      }
      _emptyTickCount = 0;
      _emptyTickLogStride = 1;

      // v1.0.0-rc.3 — Insight 2026-05-18 report: some ticks land
      // valid non-empty JSON but with only the root View + 1-2 wrappers
      // (the Android zero-size-bails-subtree bug, now fixed natively;
      // this log catches similar regressions). Cheap node-count parse
      // — we only look at one digit-level character class.
      _okTickCount += 1;
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        const nodeCount = countNodesQuick(snapshot);
        const sizeBytes = snapshot.length;
        const isThin = nodeCount < THIN_RESULT_NODES;
        if (isThin) {
          _thinTickCount += 1;
          if (_thinTickCount === 1 || _thinTickCount === _thinTickLogStride) {
            // eslint-disable-next-line no-console
            console.warn(
              `[sentori] replay tick: thin result nodes=${nodeCount} sizeBytes=${sizeBytes} (thin ticks so far: ${_thinTickCount})`,
            );
            _thinTickLogStride = Math.max(_thinTickLogStride * 10, 10);
          }
        } else {
          _thinTickCount = 0;
          _thinTickLogStride = 1;
        }
        // First good tick logs the shape so devs see it once.
        if (_okTickCount === 1) {
          // eslint-disable-next-line no-console
          console.warn(
            `[sentori] replay tick: first ok — nodes=${nodeCount} sizeBytes=${sizeBytes}`,
          );
        }
      }
    } else if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // v0.9.11 — Insight 2026-05-17 Finding 6: tick fires hundreds
      // of times but ring stays empty → native returned null/empty.
      // Log on a back-off schedule (1st, 10th, 100th, …) so the
      // diagnostic is visible without spamming Metro at 1 Hz for a
      // 15-minute session.
      _emptyTickCount += 1;
      if (_emptyTickCount === 1 || _emptyTickCount === _emptyTickLogStride) {
        // eslint-disable-next-line no-console
        console.warn(
          '[sentori] replay tick: native returned',
          snapshot === null
            ? 'null'
            : typeof snapshot === 'string'
              ? `empty (length=${snapshot.length})`
              : typeof snapshot,
          `(empty ticks so far: ${_emptyTickCount})`,
        );
        _emptyTickLogStride = Math.max(_emptyTickLogStride * 10, 10);
      }
    }
    tickSpan?.finish({ status: 'ok' });
  } catch (e) {
    if (e instanceof Error) tickSpan?.setTag('error.message', e.message);
    tickSpan?.finish({ status: 'error' });
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[sentori] replay tick: threw', e);
    }
  }
}

/**
 * Approximate node-count parse — counts occurrences of the
 * `"x":` key in the serialised payload. Every node JSON object
 * starts with `{"x":<n>,"y":<n>,"w":<n>,"h":<n>...}` so the
 * occurrence count matches the array length without paying for a
 * full `JSON.parse`. Cheap enough to run inside the 1 Hz tick.
 */
function countNodesQuick(payload: string): number {
  let count = 0;
  let i = 0;
  // Skip the outer {"ts":..,"width":..,"height":..,"nodes":[
  // and count `"x":` thereafter. The outer payload doesn't contain
  // a top-level "x" key so any match must be a node.
  const needle = '"x":';
  while (true) {
    const at = payload.indexOf(needle, i);
    if (at < 0) break;
    count += 1;
    i = at + needle.length;
  }
  return count;
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

/** rc.4 — surface "is replay subsystem alive" so the captureException
 *  debug log can label `wantReplay` alongside `wantScreenshot` /
 *  `wantSessionTrail`. Insight 2026-05-18 verify flagged that the
 *  pre-rc.4 log line was missing `wantReplay`, leaving the failure
 *  shape ambiguous (config-off vs. ring-empty vs. attach-failed). */
export function isReplayRunning(): boolean {
  return _running;
}

/** Drain the ring as NDJSON (one snapshot per line). Empty string
 *  when the ring is empty. Also clears the ring so the next session's
 *  replay starts fresh. */
export function drainReplay(): string {
  if (_ring.length === 0) return '';
  const out = _ring.join('\n');
  _ring = [];
  _lastPushed = null;
  return out;
}

export function __resetReplayForTests(): void {
  stopReplay();
  _ring = [];
  _lastPushed = null;
}

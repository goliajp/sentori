// sentori.init(config) — the single configuration entry point
// (design.md §4). Synchronous, never throws; a bad config degrades
// every verb to a no-op with one console.warn, never a crash
// (failure-isolation iron rule).

import { safeFn, setLogLevel } from '@goliapkg/sentori-core';
import type { InitConfig } from '@goliapkg/sentori-core';

import { setConfig } from './config';
import { registerEmitHook } from './emit-hooks';
import { installGlobalHandler } from './handlers/global';
import { installLifecycleHandler } from './handlers/lifecycle';
import { installNetworkHandler } from './handlers/network';
import { installPromiseHandler } from './handlers/promise';
import { startLongTaskMonitor } from './long-task-monitor';
import { checkColdStart } from './mobile-vitals';
import { markNativeJsBridgeReady, setNativeConfig } from './native';
import { shipNativePending } from './native-pending';
import { drainReplay, startReplay } from './replay';
import { drainScreenReplay, startScreenReplay } from './replay-screens';
import { drainOfflineQueue, startTransport, uploadAttachment } from './transport';

let _initialized = false;

export const init = safeFn('init', (config: InitConfig): void => {
  if (_initialized) return;

  if (!config || typeof config.token !== 'string' || config.token.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[sentori] init skipped: token missing — SDK is a no-op');
    return;
  }
  if (typeof config.ingestUrl !== 'string' || config.ingestUrl.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[sentori] init skipped: ingestUrl missing — SDK is a no-op');
    return;
  }

  _initialized = true;

  setConfig({
    token: config.token,
    ingestUrl: config.ingestUrl.replace(/\/+$/, ''),
    release: config.release ?? '',
    environment: config.environment ?? 'production',
    enabled: true,
    detect: {
      rageTap: config.detect?.rageTap ?? true,
      longFreeze: config.detect?.longFreeze ?? true,
      slowColdStart: config.detect?.slowColdStart ?? true,
      slowApi: config.detect?.slowApi ?? false,
    },
    replaySeconds: config.replaySeconds ?? 30,
    replayScreens: config.replayScreens ?? false,
    beforeSend: config.beforeSend,
  });
  setLogLevel(config.logLevel ?? 'warn');

  // JS-side error capture + the signal-ring feeders.
  installGlobalHandler();
  installPromiseHandler();
  installNetworkHandler();
  installLifecycleHandler();

  // Warn-scenario detectors (design.md §3 minimum set). rage_tap
  // rides the RageTapCapture component; the rest start here.
  if (config.detect?.longFreeze !== false) startLongTaskMonitor();

  // B-type replay: a rolling in-memory wireframe ring; an error/warn
  // going out drains it into a replay attachment on that event.
  const replaySeconds = config.replaySeconds ?? 30;
  if (replaySeconds > 0) {
    startReplay({ mode: 'wireframe' });
    // Visual ring is opt-in: screenshots can carry user content.
    if (config.replayScreens === true) startScreenReplay(replaySeconds);
    registerEmitHook((event) => {
      if (event.kind !== 'error' && event.kind !== 'warn') return;
      if (!event.id) return;
      const lines = drainReplay();
      if (lines) {
        const base64 = base64Encode(lines);
        if (base64) {
          void uploadAttachment(
            event.id,
            'replay',
            { base64, mediaType: 'application/x-sentori-replay' },
            { source: 'js' },
          );
        }
      }
      const frames = drainScreenReplay();
      if (frames) {
        const base64 = base64Encode(frames);
        if (base64) {
          void uploadAttachment(
            event.id,
            'screens',
            { base64, mediaType: 'application/x-sentori-screens' },
            { source: 'js' },
          );
        }
      }
    });
  }

  // Native side: hand over release/environment for the crash-file
  // writer, mark the bridge live, then drain crashes from previous
  // launches. All fire-and-forget — init stays synchronous and fast
  // (< 50 ms budget; the work below happens off the critical path).
  setNativeConfig({
    environment: config.environment ?? 'production',
    release: config.release ?? '',
    token: config.token,
  });
  markNativeJsBridgeReady();

  startTransport();
  checkColdStart(config.detect?.slowColdStart !== false);
  void shipNativePending().catch(() => undefined);
  void drainOfflineQueue();
});

/** RN's Hermes has no btoa in older releases; go through base64.ts. */
const base64Encode = (text: string): string | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { encodeBase64 } = require('./base64') as {
      encodeBase64: (s: string) => string;
    };
    return encodeBase64(text);
  } catch {
    return null;
  }
};

export const __resetForTests = (): void => {
  _initialized = false;
};

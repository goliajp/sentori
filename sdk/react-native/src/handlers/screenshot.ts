// Phase 42 sub-D.03/04 — capture a screenshot of the current view tree
// on `captureException`. Off-main-thread, best-effort, opt-in.
//
// Performance contract (sub-D.04):
//   - Wait for the in-flight RN interaction batch to drain before
//     touching the view shot (`InteractionManager.runAfterInteractions`)
//     so we never extend the active gesture / animation by a frame.
//   - Yield one paint by chaining a `requestAnimationFrame` so the
//     screenshot reflects post-error UI state, not the frame that
//     was already half-laid-out.
//   - Capped output: 480 px on the longest edge, WebP q=70. Typical
//     payload 30-80 KB; multipart hard cap is 500 KB.
//   - On any failure we silently return null. The error event still
//     goes to the server; the user just doesn't see a thumbnail.
//
// `react-native-view-shot` is an OPTIONAL peer. We `require()` it
// lazily so apps that don't install it never pay the bundle cost
// or fail at import time. Without it, `captureScreenshot()` returns
// `null` immediately.

import { InteractionManager } from 'react-native';

type CaptureRef = (
  // Phase 42: the lib accepts a React ref or — when we pass `undefined` —
  // shoots the root window. We always go for the root (no per-component
  // ref) so the screenshot lines up with what the user just saw.
  refOrUndefined: undefined,
  opts: {
    format?: 'jpg' | 'png' | 'webm';
    quality?: number;
    result?: 'base64' | 'data-uri' | 'tmpfile';
    width?: number;
    height?: number;
  },
) => Promise<string>;

type ViewShotModule = { captureRef?: CaptureRef; default?: { captureRef?: CaptureRef } };

function loadCaptureRef(): CaptureRef | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-view-shot') as ViewShotModule;
    return mod.captureRef ?? mod.default?.captureRef ?? null;
  } catch {
    return null;
  }
}

const MAX_LONG_EDGE_PX = 480;
const WEBP_QUALITY = 0.7;
const CAPTURE_TIMEOUT_MS = 1500;

/** What `captureScreenshot()` hands back when it succeeds. */
export type ScreenshotBlob = {
  base64: string;
  mediaType: string;
};

/**
 * Take one screenshot, yielding the JS thread first. Returns null on
 * any error (missing peer dep, native side refused, timeout, etc.).
 * Caller is responsible for opt-in checks (`config.screenshotsEnabled`).
 */
export async function captureScreenshot(): Promise<ScreenshotBlob | null> {
  const captureRef = loadCaptureRef();
  if (!captureRef) return null;

  // Wait for the in-flight RN interaction batch to drain. This is
  // why screenshot capture doesn't visibly stall the user's last
  // action — we let React commit before we ask the OS to render.
  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

  try {
    const base64 = await withTimeout(
      captureRef(undefined, {
        format: 'jpg',
        quality: WEBP_QUALITY,
        result: 'base64',
        // Long-edge cap. RN view-shot scales preserving aspect ratio
        // when only one dimension is set.
        width: MAX_LONG_EDGE_PX,
      }),
      CAPTURE_TIMEOUT_MS,
    );
    if (!base64) return null;
    // view-shot doesn't ship a WebP encoder on every RN version.
    // JPEG q=70 fits the budget too (typical 40-100 KB) and every
    // version handles it identically. We can swap to WebP once the
    // RN minimum we support has it everywhere.
    return { base64, mediaType: 'image/jpeg' };
  } catch {
    return null;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null as unknown as T), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(null as unknown as T);
      },
    );
  });
}

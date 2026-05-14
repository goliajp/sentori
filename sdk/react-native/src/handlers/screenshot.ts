// Phase 42 sub-D.03/04 — capture a screenshot of the current view tree
// on `captureException`. Off-main-thread, best-effort, opt-in.
//
// Performance contract (sub-D.04):
//   - Yield one paint via `requestAnimationFrame` before snapshotting
//     so the screenshot reflects post-error UI state, not the frame
//     that was already half-laid-out.
//   - Capped output: 480 px on the longest edge, JPEG q=70. Typical
//     payload 30-80 KB; multipart hard cap is 500 KB.
//   - On any failure we silently return null. The error event still
//     goes to the server; the user just doesn't see a thumbnail.
//
// `react-native-view-shot` is an OPTIONAL peer. We `require()` it
// lazily so apps that don't install it never pay the bundle cost
// or fail at import time. Without it, `captureScreenshot()` returns
// `null` immediately.
//
// 2026-05-15 — dropped `InteractionManager.runAfterInteractions`.
// RN's docs mark `InteractionManager` as deprecated and recommend
// `requestIdleCallback`, but `requestIdleCallback` doesn't actually
// exist in RN (it's a web API), so the deprecation print is
// unactionable for SDK consumers. The defensive "wait for the active
// gesture batch to drain" semantics it provided is not reachable
// from a screenshot triggered on captureException — by the time an
// error fires, the user is between actions, not mid-gesture — so
// removing it has no observable effect except silencing the warning.
// The `requestAnimationFrame` calls below still guarantee one paint
// commit before captureRef snapshots.

import { engageMasks } from '../mask';

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

  // Yield one paint frame so the post-error UI has committed before
  // we ask the OS to snapshot it. The previous
  // `InteractionManager.runAfterInteractions` step was removed: see
  // file header — its replacement (`requestIdleCallback`) doesn't
  // exist in RN, and on captureException the user is between actions
  // anyway, so the gesture-batch-drain semantics never came into
  // play in practice.
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

  // Phase 48 sub-B — flip every registered MaskRegion overlay to
  // opacity 1 (black covers the children) and every imperative
  // setMaskedNode ref to opacity 0 (subtree disappears). Held for
  // exactly one frame's worth of capture, then restored.
  const restoreMasks = engageMasks();
  // Yield one more frame so the overlay paint reaches the screen
  // before captureRef snapshots. Without this the overlay opacity
  // change is queued but the screenshotter may see the previous
  // frame.
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
    restoreMasks();
    if (!base64) return null;
    // view-shot doesn't ship a WebP encoder on every RN version.
    // JPEG q=70 fits the budget too (typical 40-100 KB) and every
    // version handles it identically. We can swap to WebP once the
    // RN minimum we support has it everywhere.
    return { base64, mediaType: 'image/jpeg' };
  } catch {
    restoreMasks();
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

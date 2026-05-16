/**
 * Bridge to the native (iOS / Android) Sentori module.
 * No-op when not running in an Expo runtime that has the module installed —
 * this keeps the SDK usable in pure-JS environments (jest, bun test, web).
 */

type SentoriNativeModule = {
  drainPending: () => Promise<string[]>
  setConfig: (config: {
    environment: string
    release: string
    token: string
  }) => void
  /**
   * v0.9.4 #1 — cold start measurement. iOS:
   * `mach_absolute_time` from `applicationDidFinishLaunching` to first
   * JS bridge ready. Android: `Process.getStartElapsedRealtime()`.
   * Returns null when native side hasn't captured yet.
   */
  getColdStartMs?: () => null | number
  /**
   * v0.9.4 #1 — call once at JS init() to finalize the cold-start
   * measurement. iOS subtracts from the app-delegate anchor;
   * Android uses Process.getStartElapsedRealtime() so the call is
   * idempotent if missed.
   */
  markJsBridgeReady?: () => void
  /**
   * v0.9.4 #1 — slow/frozen frame counters since the most recent
   * navigation transition. Native side hooks `CADisplayLink` (iOS)
   * / `Choreographer.FrameCallback` (Android). Frame > 16.67ms =
   * slow; > 700ms = frozen.
   */
  getFrameCounters?: () => null | { frozen: number; slow: number }
  /** Reset counters on navigation transition (called by useTraceNavigation). */
  resetFrameCounters?: () => void
  /**
   * v0.7.3 — JS-triggered screenshot with consumer-supplied mask IDs.
   * `maskedIds` are RN `nativeID` strings; native walks the view
   * tree, finds each subview by identifier, and paints a black
   * rectangle over its frame in the captured bitmap. Resolves to
   * `null` if there's no key window / API < 24 (Android) / render
   * timed out. Replaced the previous `react-native-view-shot`
   * peer-dep path.
   */
  captureScreenshotWithMask?: (
    maskedIds: string[],
  ) => Promise<null | { base64: string; mediaType: string }>
  /**
   * Phase 22 sub-D / sub-E: cross-platform main-thread watchdog.
   * Android: 5 s / 1 s defaults (matches the OS ANR threshold).
   * iOS: 2 s / 1 s (more aggressive — iOS has no system-level
   * watchdog signal we can lean on, so we surface stutter Apple's
   * own runtime never flags).
   * Reports a `kind = "anr"` event when the main thread is wedged.
   */
  startAnrWatchdog?: (options?: {
    force?: boolean
    intervalMs?: number
    timeoutMs?: number
  }) => void
  stopAnrWatchdog?: () => void
  /** Dev-only — example app uses this to verify the crash flow. */
  triggerTestNativeCrash?: () => void
}

let _native: SentoriNativeModule | null | undefined

function native(): SentoriNativeModule | null {
  if (_native !== undefined) return _native
  try {
    const core = require('expo-modules-core') as {
      requireNativeModule: <T>(name: string) => T
    }
    _native = core.requireNativeModule<SentoriNativeModule>('Sentori')
  } catch {
    _native = null
  }
  return _native
}

export function setNativeConfig(config: {
  environment: string
  release: string
  token: string
}): void {
  try {
    native()?.setConfig(config)
  } catch {
    // never throw on init
  }
}

export async function drainNativePending(): Promise<string[]> {
  const n = native()
  if (!n) return []
  try {
    return await n.drainPending()
  } catch {
    return []
  }
}

/**
 * Dev-only helper. Triggers a real NSException (iOS) or RuntimeException
 * (Android) after a short delay so the host app crashes for real and the
 * native crash handler exercises the full write-to-disk path.
 *
 * Usage: tap a button in the example app, watch the app close, restart it,
 * verify the server received the event.
 *
 * No-op when the native module isn't installed (jest, bun test, web).
 */
export function triggerNativeCrash(): void {
  try {
    native()?.triggerTestNativeCrash?.()
  } catch {
    // never throw from a debugging helper
  }
}

/**
 * Phase 22 sub-D / sub-E: cross-platform main-thread watchdog.
 * Single JS call covers both Android ANR and iOS hang detection.
 *
 *     startAnrWatchdog()                       // platform defaults, prod-only
 *     startAnrWatchdog({ force: true })        // include debug builds
 *     startAnrWatchdog({ timeoutMs: 3000 })    // tighter threshold
 *
 * Defaults: Android 5 s / 1 s tick; iOS 2 s / 1 s tick. Returns
 * silently on web / jest / unsupported runtimes.
 */
export function startAnrWatchdog(options?: {
  force?: boolean
  intervalMs?: number
  timeoutMs?: number
}): void {
  try {
    native()?.startAnrWatchdog?.(options)
  } catch {
    // never throw from init helpers
  }
}

export function stopAnrWatchdog(): void {
  try {
    native()?.stopAnrWatchdog?.()
  } catch {
    // ignore
  }
}

/** v0.9.4 #1 — finalize cold-start measurement. Idempotent. */
export function markNativeJsBridgeReady(): void {
  try {
    native()?.markJsBridgeReady?.()
  } catch {
    // ignore
  }
}

/** v0.9.4 #1 — read cold start ms once. null when native unavailable. */
export function getNativeColdStartMs(): null | number {
  try {
    const v = native()?.getColdStartMs?.()
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** v0.9.4 #1 — read slow/frozen frame counters since last reset. */
export function getNativeFrameCounters(): null | { frozen: number; slow: number } {
  try {
    return native()?.getFrameCounters?.() ?? null
  } catch {
    return null
  }
}

/** v0.9.4 #1 — reset frame counters on navigation transition. */
export function resetNativeFrameCounters(): void {
  try {
    native()?.resetFrameCounters?.()
  } catch {
    // ignore
  }
}

/**
 * v0.7.3 — drives the native screenshot path. JS side passes the
 * current list of mask `nativeID`s (read from the consumer's
 * registered mask query); native renders + redacts.
 *
 * Returns `null` on every failure mode: no native module bound
 * (jest, bun test, web), method missing (older native build still
 * deployed), capture failed (no key window, timed out, etc.).
 * Callers must treat `null` as "no screenshot this round" — the
 * error event still ships, just without a thumbnail.
 */
export async function captureNativeScreenshotWithMask(
  maskedIds: string[],
): Promise<null | { base64: string; mediaType: string }> {
  const n = native()
  if (!n?.captureScreenshotWithMask) return null
  try {
    return await n.captureScreenshotWithMask(maskedIds)
  } catch {
    return null
  }
}

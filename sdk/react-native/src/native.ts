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

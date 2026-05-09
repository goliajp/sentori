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

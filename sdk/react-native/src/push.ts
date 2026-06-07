// v2.9 — React Native push notification opt-in (iOS in this release).
//
// Mirrors `@goliapkg/sentori-javascript`'s `registerWeb` ergonomics
// so a cross-platform host app reasons about both flows the same way.
//
// Flow:
//   1. `pushRequestPermission()` — OS prompt the first time, or
//      returns the cached decision.
//   2. `pushRegister()` — kicks off
//      `UIApplication.registerForRemoteNotifications`. The token
//      arrives asynchronously via the AppDelegate swizzle and lands
//      in the native buffer.
//   3. Poll `pushDrainState()` at 200 ms ticks for up to 8 s waiting
//      for the token.
//   4. POST `/v1/push/tokens` with
//      `provider: 'apns'`, `env: __DEV__ ? 'sandbox' : 'production'`,
//      `nativeToken: <hex>`, `linkHash?`, `metadata`.
//   5. Cache the returned `ipt_*` handle (AsyncStorage when
//      available, otherwise module-scoped).
//   6. Start a 1 Hz drain loop that fires `onMessage` / `onTap` from
//      buffered events while the app is foreground. Pauses on
//      background, resumes on active, per the perf iron rule.

import { logger } from '@goliapkg/sentori-core'
// AppState is RN-only; we treat it dynamically so the SDK keeps
// importing cleanly under Bun / web.
type AppStateModule = {
  currentState: string
  addEventListener: (
    type: 'change',
    listener: (state: string) => void,
  ) => { remove: () => void }
}

import {
  pushDrainState,
  pushGetStatus,
  pushRegister as nativePushRegister,
  pushRequestPermission,
  pushUnregister as nativePushUnregister,
} from './native.js'

const STORAGE_KEY = 'sentori.push.ipt'

let _cachedIpt: null | string = null
let _drainInterval: ReturnType<typeof setInterval> | null = null
let _appStateSubscription: { remove: () => void } | null = null
let _backgrounded = false

let _onMessage: PushRegisterOptions['onMessage'] = undefined
let _onTap: PushRegisterOptions['onTap'] = undefined

export type PushRegisterOptions = {
  /** Identity-link hash. Pass `hashIdentities({ email }).email` if
   *  the host has run the v2.3 identity flow. Lets the server-side
   *  push routing target a specific user across all their devices. */
  linkHash?: string
  /** Extra metadata to attach to the device_tokens row (e.g. app
   *  version, locale). Optional. */
  metadata?: Record<string, unknown>
  /** Foreground notification arrival. Fires once per notification
   *  the SW or iOS native delegate hands us. */
  onMessage?: (payload: PushNotificationPayload) => void
  /** User tapped a notification. Fires once per tap. */
  onTap?: (data: unknown) => void
  /** Token registration completed — useful when the host wants the
   *  ipt handle in real time without awaiting `register()`. */
  onToken?: (ipt: string) => void
  /** Any failure in the registration flow. The promise also
   *  rejects; this callback is convenience. */
  onError?: (err: Error) => void
  /** Override the timeout when waiting for the native token to
   *  arrive after `registerForRemoteNotifications`. Defaults to
   *  8000 ms; bump on slow networks / TestFlight provisioning
   *  delays. */
  tokenTimeoutMs?: number
}

export type PushRegisterResult = {
  /** Stable device handle (`ipt_<uuid>`). */
  ipt: string
}

export type PushNotificationPayload = {
  id?: string
  title?: string
  body?: string
  subtitle?: string
  category?: string
  userInfo?: Record<string, unknown>
  receivedAt?: number
}

/**
 * Run the iOS push opt-in flow. Returns the cached `ipt_*` handle
 * on subsequent calls when permission is still granted.
 */
export async function register(opts: PushRegisterOptions = {}): Promise<PushRegisterResult> {
  try {
    const cfg = getRuntimeConfig()
    // Bind callbacks up front so the buffer drain inside
    // waitForToken can fire onMessage / onTap for events that arrive
    // alongside or before the device token (e.g. user taps a push
    // received during a previous launch — iOS replays it on
    // delegate attach).
    _onMessage = opts.onMessage
    _onTap = opts.onTap
    const status = await pushRequestPermission()
    if (status !== 'granted' && status !== 'provisional' && status !== 'ephemeral') {
      throw new Error(`Push permission '${status ?? 'unavailable'}'; cannot register`)
    }
    nativePushRegister()
    const token = await waitForToken(opts.tokenTimeoutMs ?? 8000)
    const ipt = await registerWithServer(cfg, token, opts)
    _cachedIpt = ipt
    void persistIpt(ipt)
    opts.onToken?.(ipt)
    bindBufferDrain(opts.onMessage, opts.onTap)
    return { ipt }
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    logger.warn('push', 'register failed:', err.message)
    opts.onError?.(err)
    throw err
  }
}

/**
 * Revoke the cached handle (DELETE /v1/push/tokens/{ipt}) +
 * unregister locally. Idempotent — repeat calls are no-ops.
 */
export async function unregister(): Promise<void> {
  const cfg = tryGetRuntimeConfig()
  const ipt = _cachedIpt ?? (await readPersistedIpt())
  if (cfg && ipt) {
    try {
      await fetch(joinUrl(cfg.ingestUrl, `/v1/push/tokens/${ipt}`), {
        method: 'DELETE',
        headers: { authorization: `Bearer ${cfg.token}` },
      })
    } catch (e) {
      logger.warn('push', 'unregister server delete failed', e)
    }
  }
  nativePushUnregister()
  _cachedIpt = null
  void clearPersistedIpt()
  teardownBufferDrain()
}

/** Returns the cached handle without hitting the network. Useful
 *  for skipping a re-register prompt across cold starts. */
export function getCachedIpt(): null | string {
  return _cachedIpt
}

/** Public re-export of the no-prompt status check. */
export { pushGetStatus as getStatus, pushRequestPermission as requestPermission }

// ── helpers ────────────────────────────────────────────────────

type RuntimeConfig = { ingestUrl: string; token: string }

function getRuntimeConfig(): RuntimeConfig {
  const cfg = tryGetRuntimeConfig()
  if (!cfg) {
    throw new Error('sentori is not initialised; call sentori.init() first')
  }
  return cfg
}

function tryGetRuntimeConfig(): RuntimeConfig | null {
  // Dynamic require avoids a circular import — `./init` already
  // depends on `./push` via the top-level barrel re-export.
  try {
    const conf = require('./config.js') as { getConfig?: () => null | RuntimeConfig }
    return conf.getConfig?.() ?? null
  } catch {
    return null
  }
}

async function waitForToken(timeoutMs: number): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const state = await pushDrainState()
    if (state.error) {
      throw new Error(`APNs registration failed: ${state.error}`)
    }
    if (state.token) {
      // Push any buffered events that arrived alongside the token
      // straight back into the registered listeners (if any).
      flushBuffered(state.notifications, state.taps)
      return state.token
    }
    flushBuffered(state.notifications, state.taps)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`APNs token not received within ${timeoutMs} ms`)
}

async function registerWithServer(
  cfg: RuntimeConfig,
  nativeToken: string,
  opts: PushRegisterOptions,
): Promise<string> {
  const env = typeof __DEV__ !== 'undefined' && __DEV__ ? 'sandbox' : 'production'
  const body = {
    provider: 'apns',
    env,
    nativeToken,
    linkHash: opts.linkHash,
    metadata: opts.metadata ?? {},
  }
  const res = await fetch(joinUrl(cfg.ingestUrl, '/v1/push/tokens'), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${cfg.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`/v1/push/tokens HTTP ${res.status}`)
  const json = (await res.json()) as { id?: string }
  if (typeof json.id !== 'string' || !json.id.startsWith('ipt_')) {
    throw new Error('server did not return an ipt_* handle')
  }
  return json.id
}

function bindBufferDrain(
  onMessage?: PushRegisterOptions['onMessage'],
  onTap?: PushRegisterOptions['onTap'],
): void {
  _onMessage = onMessage
  _onTap = onTap
  teardownBufferDrain()
  startAppStateWatch()
  _drainInterval = setInterval(() => {
    if (_backgrounded) return
    void pumpOnce()
  }, 1000)
}

function teardownBufferDrain(): void {
  if (_drainInterval) {
    clearInterval(_drainInterval)
    _drainInterval = null
  }
  _appStateSubscription?.remove()
  _appStateSubscription = null
}

async function pumpOnce(): Promise<void> {
  const state = await pushDrainState()
  flushBuffered(state.notifications, state.taps)
}

function flushBuffered(
  notifications: Array<Record<string, unknown>>,
  taps: Array<Record<string, unknown>>,
): void {
  if (_onMessage) {
    for (const raw of notifications) {
      _onMessage(coerceNotification(raw))
    }
  }
  if (_onTap) {
    for (const raw of taps) {
      _onTap(raw.userInfo ?? raw)
    }
  }
}

function coerceNotification(raw: Record<string, unknown>): PushNotificationPayload {
  return {
    id: raw.id as string | undefined,
    title: raw.title as string | undefined,
    body: raw.body as string | undefined,
    subtitle: raw.subtitle as string | undefined,
    category: raw.category as string | undefined,
    userInfo: raw.userInfo as Record<string, unknown> | undefined,
    receivedAt: raw.receivedAt as number | undefined,
  }
}

function startAppStateWatch(): void {
  if (_appStateSubscription) return
  try {
    const rn = require('react-native') as { AppState?: AppStateModule }
    const AppState = rn.AppState
    if (!AppState) return
    _backgrounded = AppState.currentState === 'background'
    _appStateSubscription = AppState.addEventListener('change', (state: string) => {
      _backgrounded = state === 'background'
    })
  } catch {
    /* react-native unavailable (unit test) */
  }
}

async function persistIpt(ipt: string): Promise<void> {
  const storage = await tryAsyncStorage()
  if (!storage) return
  try {
    await storage.setItem(STORAGE_KEY, ipt)
  } catch (e) {
    logger.warn('push', 'AsyncStorage.setItem failed', e)
  }
}

async function clearPersistedIpt(): Promise<void> {
  const storage = await tryAsyncStorage()
  try {
    await storage?.removeItem(STORAGE_KEY)
  } catch (e) {
    logger.warn('push', 'AsyncStorage.removeItem failed', e)
  }
}

async function readPersistedIpt(): Promise<null | string> {
  const storage = await tryAsyncStorage()
  if (!storage) return null
  try {
    return await storage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

type AsyncStorageLike = {
  getItem: (k: string) => Promise<null | string>
  setItem: (k: string, v: string) => Promise<void>
  removeItem: (k: string) => Promise<void>
}

async function tryAsyncStorage(): Promise<AsyncStorageLike | null> {
  try {
    const mod = require('@react-native-async-storage/async-storage') as {
      default?: AsyncStorageLike
    }
    return mod.default ?? null
  } catch {
    return null
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`
}

declare const __DEV__: boolean | undefined

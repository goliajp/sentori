import {
  TrailBuffer,
  sealTrail,
  shouldSample,
  type TrailStep,
} from '@goliapkg/sentori-core'

import { addBreadcrumb, getBreadcrumbs } from './breadcrumbs.js'
import { getConfig, isInitialized } from './config.js'
import { markSessionErrored } from './session-tracker.js'
import { parseStack } from './stack.js'
import { send, uploadAttachment } from './transport.js'
import type { CaptureExtras, Event, SentoriError, User } from './types.js'
import { uuidV7 } from './uuid.js'

let _user: User | null = null

const _trail = new TrailBuffer(30)

/**
 * Phase 46 — record a step into the session-trail buffer. The buffer
 * is a fixed-size FIFO; pushing past capacity drops the oldest.
 * Uploaded as a `sessionTrail` attachment on the next
 * `captureException` only when `init({ capture: { sessionTrail:
 * true } })` is on.
 */
export function captureStep(label: string, opts?: Partial<TrailStep>): void {
  _trail.push({
    ts: Date.now(),
    label,
    ...(opts ?? {}),
  })
}

export function __resetTrailForTests(): void {
  _trail.clear()
}

/**
 * Attach a stable user identifier to events captured after this call.
 *
 * PII policy: User shape is `{ id?, anonymous? }` only — no email,
 * name, IP, or other identifying fields. The server schema enforces
 * the same shape; extras would be rejected with `validationFailed`.
 */
export function setUser(user: User | null): void {
  _user = user
}

export function getUser(): User | null {
  return _user
}

export function captureError(error: Error, extras?: CaptureExtras): void {
  if (!isInitialized()) return
  const cfg = getConfig()!
  // Phase 44 sub-B: client-side sampling. Drop sampled-out events
  // before any work (breadcrumbs / transport).
  if (!shouldSample(cfg.sampling?.errors ?? null)) {
    addBreadcrumb({ data: { kind: 'error', reason: 'sampled-out' }, type: 'custom' })
    return
  }
  const event: Event = {
    app: { version: parseRelease(cfg.release).version },
    breadcrumbs: getBreadcrumbs(),
    device: detectDevice(),
    environment: cfg.environment,
    error: errorToObject(error),
    fingerprint: extras?.fingerprint,
    id: uuidV7(),
    kind: 'error',
    platform: 'javascript',
    release: cfg.release,
    tags: extras?.tags,
    timestamp: new Date().toISOString(),
    user: extras?.user ?? _user,
  }
  // Phase 26 sub-B: a captured error promotes the current session to
  // `errored` so the next end-of-session ping reports unhealthy.
  markSessionErrored()

  const transportCfg = { ingestUrl: cfg.ingestUrl, token: cfg.token }
  const pipeline = async (): Promise<void> => {
    // Phase 46 — seal + upload the session trail (best-effort) before
    // shipping the event so `event.attachments[]` carries the ref the
    // dashboard renders. Trail is cleared after every captureException
    // regardless of upload outcome, to keep "trail per crash" clean.
    if (cfg.capture?.sessionTrail && _trail.size() > 0) {
      const payload = sealTrail(_trail)
      _trail.clear()
      const meta = await uploadAttachment(transportCfg, event.id, 'sessionTrail' as const, {
        body: JSON.stringify(payload),
        mediaType: 'application/json',
      })
      if (meta) {
        if (!event.attachments) event.attachments = []
        event.attachments.push(meta)
      }
    }
    await send(transportCfg, event)
  }
  void pipeline()
}

export const captureException = captureError

function errorToObject(error: Error): SentoriError {
  const causeRaw = (error as { cause?: unknown }).cause
  let cause: SentoriError | null = null
  if (causeRaw instanceof Error) cause = errorToObject(causeRaw)
  return {
    cause,
    message: error.message,
    stack: parseStack(error.stack),
    type: error.name || 'Error',
  }
}

function parseRelease(release: string): { build?: string; version: string } {
  const m = /^(?:[^@]+@)?([^+]+)(?:\+(.+))?$/.exec(release)
  return { build: m?.[2], version: m?.[1] ?? '0.0.0' }
}

function detectDevice(): Event['device'] {
  // The server's device.os is a strict enum: `ios | android | web | other`
  // (see docs/protocol.md). Browser → web; Node + everything else → other.
  // The pre-Phase-21 build sent free-form values like "macos" / "windows"
  // which the server quietly rejected with `validationFailed`. Detail
  // about the underlying OS family rides along in `model` instead.
  const w = (
    globalThis as {
      navigator?: {
        connection?: { effectiveType?: string; type?: string }
        language?: string
        onLine?: boolean
        userAgent?: string
      }
    }
  ).navigator
  if (w?.userAgent) {
    const networkType = detectNetworkType(w)
    return {
      locale: w.language,
      model: detectBrowserOs(w.userAgent),
      ...(networkType ? { networkType } : {}),
      os: 'web',
      osVersion: '0',
    }
  }
  // Node
  const p = (globalThis as { process?: { platform?: string; version?: string } }).process
  if (p?.platform) {
    return {
      model: p.platform,
      os: 'other',
      osVersion: p.version?.replace(/^v/, '') ?? '0',
    }
  }
  return { os: 'other', osVersion: '0' }
}

/** v0.8.0-c — Network Information API. Implemented in Chrome/Edge for
 *  years, Safari Tech Preview, Firefox flagged-only. We use the
 *  `effectiveType` field — it normalises wifi-vs-mobile reality
 *  ("4g" doesn't always mean cellular, can be a fast wifi link).
 *  `navigator.onLine === false` short-circuits to "offline" before
 *  asking the connection API, which on some browsers returns a stale
 *  type during early offline events. */
function detectNetworkType(
  nav: { connection?: { effectiveType?: string; type?: string }; onLine?: boolean },
): Event['device']['networkType'] {
  if (nav.onLine === false) return 'offline'
  const eff = nav.connection?.effectiveType
  if (eff === '4g' || eff === '3g' || eff === '2g' || eff === 'slow-2g') return eff
  const type = nav.connection?.type
  if (type === 'wifi') return 'wifi'
  return undefined
}

function detectBrowserOs(ua: string): string {
  if (ua.includes('Mac OS X') || ua.includes('Macintosh')) return 'macos'
  if (ua.includes('Windows')) return 'windows'
  if (ua.includes('Linux')) return 'linux'
  if (ua.includes('Android')) return 'android'
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'ios'
  return 'web'
}

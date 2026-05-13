import { shouldSample } from '@goliapkg/sentori-core'

import { addBreadcrumb, getBreadcrumbs } from './breadcrumbs.js'
import { getConfig, isInitialized } from './config.js'
import { markSessionErrored } from './session-tracker.js'
import { parseStack } from './stack.js'
import { send } from './transport.js'
import type { CaptureExtras, Event, SentoriError, User } from './types.js'
import { uuidV7 } from './uuid.js'

let _user: User | null = null

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
  void send({ ingestUrl: cfg.ingestUrl, token: cfg.token }, event)
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
  const w = (globalThis as { navigator?: { language?: string; userAgent?: string } }).navigator
  if (w?.userAgent) {
    return {
      locale: w.language,
      model: detectBrowserOs(w.userAgent),
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

function detectBrowserOs(ua: string): string {
  if (ua.includes('Mac OS X') || ua.includes('Macintosh')) return 'macos'
  if (ua.includes('Windows')) return 'windows'
  if (ua.includes('Linux')) return 'linux'
  if (ua.includes('Android')) return 'android'
  if (ua.includes('iPhone') || ua.includes('iPad')) return 'ios'
  return 'web'
}

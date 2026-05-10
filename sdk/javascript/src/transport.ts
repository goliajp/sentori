import type { SessionPing } from '@goliapkg/sentori-core'

import type { Event } from './types.js'

/**
 * Minimal HTTP transport. POST /v1/events with a Bearer token.
 * - Browser: prefers `navigator.sendBeacon` on page-unload paths;
 *   otherwise plain fetch with `keepalive: true` so events survive
 *   a tab close mid-flight.
 * - Node: plain fetch (Node 18+ has it global).
 *
 * On 4xx/5xx the SDK currently drops the event silently — retry +
 * persistent queue is a follow-up if anyone actually wants it.
 */
export type TransportConfig = {
  ingestUrl: string
  token: string
}

const SDK_HEADER = 'sentori-javascript/0.1.0'

export async function send(cfg: TransportConfig, event: Event): Promise<void> {
  await postJson(cfg, '/v1/events', JSON.stringify(event))
}

/**
 * Phase 26 sub-B: session ping. Same beacon → fetch fallback as `send`,
 * because sessions almost always close on the same path that closes
 * the tab — beacon survives that, fetch with `keepalive: true` is the
 * fallback when beacon is unavailable.
 */
export async function sendSession(cfg: TransportConfig, ping: SessionPing): Promise<void> {
  await postJson(cfg, '/v1/sessions', JSON.stringify(ping))
}

async function postJson(cfg: TransportConfig, path: string, body: string): Promise<void> {
  const url = `${cfg.ingestUrl.replace(/\/+$/, '')}${path}`
  const headers = {
    Authorization: `Bearer ${cfg.token}`,
    'Content-Type': 'application/json',
    'Sentori-Sdk': SDK_HEADER,
  }

  // Browser: navigator.sendBeacon is fire-and-forget and survives
  // tab close. Bound by user-agent quotas (~64KB), so we feature-detect
  // and only use it for small bodies.
  const beacon = (globalThis as { navigator?: { sendBeacon?: (u: string, b: Blob) => boolean } })
    .navigator?.sendBeacon
  if (typeof beacon === 'function' && body.length < 60_000) {
    try {
      const blob = new Blob([body], { type: 'application/json' })
      // sendBeacon doesn't carry headers — Authorization moves into
      // a query param so the server's existing Bearer auth still works.
      const beaconUrl = `${url}?token=${encodeURIComponent(cfg.token)}`
      if (beacon.call(globalThis.navigator, beaconUrl, blob)) return
    } catch {
      // fall through to fetch
    }
  }

  try {
    await fetch(url, {
      body,
      headers,
      keepalive: true,
      method: 'POST',
    })
  } catch (e) {
    // No retry — log and forget. Hosts that care can wrap and add
    // their own retry policy at the app layer.
    if (typeof console !== 'undefined') {
      console.warn('[sentori] transport failed:', (e as Error).message)
    }
  }
}

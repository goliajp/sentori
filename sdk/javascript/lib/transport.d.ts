import type { SessionPing } from '@goliapkg/sentori-core';
import type { Event } from './types.js';
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
    ingestUrl: string;
    token: string;
};
export declare function send(cfg: TransportConfig, event: Event): Promise<void>;
/**
 * Phase 26 sub-B: session ping. Same beacon → fetch fallback as `send`,
 * because sessions almost always close on the same path that closes
 * the tab — beacon survives that, fetch with `keepalive: true` is the
 * fallback when beacon is unavailable.
 */
export declare function sendSession(cfg: TransportConfig, ping: SessionPing): Promise<void>;
//# sourceMappingURL=transport.d.ts.map
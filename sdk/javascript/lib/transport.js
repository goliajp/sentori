const SDK_HEADER = 'sentori-javascript/0.1.0';
export async function send(cfg, event) {
    await postJson(cfg, '/v1/events', JSON.stringify(event));
}
/**
 * Phase 26 sub-B: session ping. Same beacon → fetch fallback as `send`,
 * because sessions almost always close on the same path that closes
 * the tab — beacon survives that, fetch with `keepalive: true` is the
 * fallback when beacon is unavailable.
 */
export async function sendSession(cfg, ping) {
    await postJson(cfg, '/v1/sessions', JSON.stringify(ping));
}
async function postJson(cfg, path, body) {
    const url = `${cfg.ingestUrl.replace(/\/+$/, '')}${path}`;
    const headers = {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
        'Sentori-Sdk': SDK_HEADER,
    };
    // Browser: navigator.sendBeacon is fire-and-forget and survives
    // tab close. Bound by user-agent quotas (~64KB), so we feature-detect
    // and only use it for small bodies.
    const beacon = globalThis
        .navigator?.sendBeacon;
    if (typeof beacon === 'function' && body.length < 60_000) {
        try {
            const blob = new Blob([body], { type: 'application/json' });
            // sendBeacon doesn't carry headers — Authorization moves into
            // a query param so the server's existing Bearer auth still works.
            const beaconUrl = `${url}?token=${encodeURIComponent(cfg.token)}`;
            if (beacon.call(globalThis.navigator, beaconUrl, blob))
                return;
        }
        catch {
            // fall through to fetch
        }
    }
    try {
        await fetch(url, {
            body,
            headers,
            keepalive: true,
            method: 'POST',
        });
    }
    catch (e) {
        // No retry — log and forget. Hosts that care can wrap and add
        // their own retry policy at the app layer.
        if (typeof console !== 'undefined') {
            console.warn('[sentori] transport failed:', e.message);
        }
    }
}
//# sourceMappingURL=transport.js.map
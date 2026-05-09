import { getBreadcrumbs } from './breadcrumbs.js';
import { getConfig, isInitialized } from './config.js';
import { parseStack } from './stack.js';
import { send } from './transport.js';
import { uuidV7 } from './uuid.js';
let _user = null;
/**
 * Attach a stable user identifier to events captured after this call.
 *
 * PII policy: User shape is `{ id?, anonymous? }` only — no email,
 * name, IP, or other identifying fields. The server schema enforces
 * the same shape; extras would be rejected with `validationFailed`.
 */
export function setUser(user) {
    _user = user;
}
export function getUser() {
    return _user;
}
export function captureError(error, extras) {
    if (!isInitialized())
        return;
    const cfg = getConfig();
    const event = {
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
    };
    void send({ ingestUrl: cfg.ingestUrl, token: cfg.token }, event);
}
export const captureException = captureError;
function errorToObject(error) {
    const causeRaw = error.cause;
    let cause = null;
    if (causeRaw instanceof Error)
        cause = errorToObject(causeRaw);
    return {
        cause,
        message: error.message,
        stack: parseStack(error.stack),
        type: error.name || 'Error',
    };
}
function parseRelease(release) {
    const m = /^(?:[^@]+@)?([^+]+)(?:\+(.+))?$/.exec(release);
    return { build: m?.[2], version: m?.[1] ?? '0.0.0' };
}
function detectDevice() {
    // Browser: light-touch UA sniff. We deliberately avoid full
    // fingerprinting — the field is for grouping context, not analytics.
    const w = globalThis.navigator;
    if (w?.userAgent) {
        return {
            locale: w.language,
            os: detectBrowserOs(w.userAgent),
            osVersion: '0',
        };
    }
    // Node
    const p = globalThis.process;
    if (p?.platform) {
        return {
            os: p.platform,
            osVersion: p.version?.replace(/^v/, '') ?? '0',
        };
    }
    return { os: 'unknown', osVersion: '0' };
}
function detectBrowserOs(ua) {
    if (ua.includes('Mac OS X') || ua.includes('Macintosh'))
        return 'macos';
    if (ua.includes('Windows'))
        return 'windows';
    if (ua.includes('Linux'))
        return 'linux';
    if (ua.includes('Android'))
        return 'android';
    if (ua.includes('iPhone') || ua.includes('iPad'))
        return 'ios';
    return 'web';
}
//# sourceMappingURL=capture.js.map
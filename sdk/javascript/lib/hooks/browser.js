import { captureError } from '../capture.js';
import { endSession } from '../session-tracker.js';
let installed = false;
/**
 * Wire window.onerror + unhandledrejection so uncaught browser errors
 * land as Sentori events automatically. Idempotent — safe to call
 * twice; the second call no-ops.
 */
export function installBrowserHooks() {
    if (installed)
        return true;
    const w = globalThis;
    if (typeof w.addEventListener !== 'function')
        return false;
    const onError = (e) => {
        const err = e.error;
        if (err instanceof Error)
            captureError(err);
        else if (typeof e.message === 'string') {
            captureError(new Error(e.message));
        }
    };
    const onRejection = (e) => {
        const reason = e.reason;
        if (reason instanceof Error)
            captureError(reason);
        else
            captureError(new Error(typeof reason === 'string' ? reason : 'unhandled rejection'));
    };
    w.addEventListener('error', onError);
    w.addEventListener('unhandledrejection', onRejection);
    // Phase 26 sub-B: pagehide is the right unload event in modern
    // browsers (fires on bfcache → background, full unload, and tab
    // close). beforeunload is unreliable on mobile Safari.
    w.addEventListener('pagehide', () => endSession());
    installed = true;
    return true;
}
/** Test helper — resets the idempotency latch. */
export function _resetBrowserHooksForTesting() {
    installed = false;
}
//# sourceMappingURL=browser.js.map
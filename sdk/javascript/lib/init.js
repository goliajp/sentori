import { setConfig } from './config.js';
import { installBrowserHooks } from './hooks/browser.js';
import { installFetchInstrumentation } from './hooks/fetch.js';
import { installNodeHooks } from './hooks/node.js';
import { installXhrInstrumentation } from './hooks/xhr.js';
import { startSession } from './session-tracker.js';
import { flushSpans, startSpanFlush } from './transport.js';
/**
 * Configure the SDK and (by default) wire global error handlers.
 *
 * Browser: window 'error' + 'unhandledrejection' → captureError.
 * Node: process 'uncaughtException' + 'unhandledRejection' → captureError.
 *
 * Pass `enableGlobalHooks: false` if you want to drive captures
 * manually (e.g. tests, or a host that owns its own crash plumbing).
 *
 * Phase 26 sub-B: also opens a session and binds platform lifecycle
 * (pagehide on browser, beforeExit on Node) so we ship a session ping
 * on close. `enableGlobalHooks: false` disables both error hooks and
 * session lifecycle so test harnesses can drive everything manually.
 */
export function initSentori(options) {
    setConfig(options);
    if (options.enableGlobalHooks === false)
        return;
    // Browser comes first because both globals can exist in some
    // bundlers' shims; we want browser semantics on the web.
    if (!installBrowserHooks())
        installNodeHooks();
    // Phase 35 sub-B + follow-up: instrument both transports so every
    // outbound request emits an http.client span + propagates the W3C
    // traceparent header. fetch covers `fetch()` callers; xhr covers
    // axios (default `xhr` adapter) and any older XHR-based client.
    installFetchInstrumentation();
    installXhrInstrumentation();
    startSession();
    // Drain finished spans to /v1/spans:batch on a timer, plus once more
    // on page-hide so the last batch isn't lost when the tab closes.
    startSpanFlush();
    if (typeof addEventListener === 'function') {
        addEventListener('pagehide', () => {
            void flushSpans();
        });
    }
}
//# sourceMappingURL=init.js.map
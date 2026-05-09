import { setConfig } from './config.js';
import { installBrowserHooks } from './hooks/browser.js';
import { installNodeHooks } from './hooks/node.js';
/**
 * Configure the SDK and (by default) wire global error handlers.
 *
 * Browser: window 'error' + 'unhandledrejection' → captureError.
 * Node: process 'uncaughtException' + 'unhandledRejection' → captureError.
 *
 * Pass `enableGlobalHooks: false` if you want to drive captures
 * manually (e.g. tests, or a host that owns its own crash plumbing).
 */
export function initSentori(options) {
    setConfig(options);
    if (options.enableGlobalHooks === false)
        return;
    // Browser comes first because both globals can exist in some
    // bundlers' shims; we want browser semantics on the web.
    if (!installBrowserHooks())
        installNodeHooks();
}
//# sourceMappingURL=init.js.map
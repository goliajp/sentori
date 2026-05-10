// Server-side Next entry point. Used from instrumentation.ts'
// register() function. The JS SDK's Node hooks (uncaughtException +
// unhandledRejection) are wired here; route-handler errors are
// captured via the onRequestError export below.
import { captureError, initSentori } from '@goliapkg/sentori-javascript';
import { resolveConfig } from './config.js';
let _initialised = false;
/**
 * Initialise the JS SDK on the Node server. Called from
 * instrumentation.ts:
 *
 *     // instrumentation.ts
 *     export async function register() {
 *       if (process.env.NEXT_RUNTIME === 'nodejs') {
 *         const { serverInit } = await import('@goliapkg/sentori-next/server')
 *         serverInit()
 *       }
 *     }
 *
 * Edge runtime is intentionally not initialised here — Next's edge
 * environment lacks `process` and the Node-only Node hooks would
 * throw. Edge errors flow through `onRequestError` below.
 */
export function serverInit(cfg = {}) {
    if (_initialised)
        return;
    try {
        initSentori(resolveConfig('server', cfg));
        _initialised = true;
    }
    catch (e) {
        // eslint-disable-next-line no-console
        console.error('[sentori-next] server init failed', e);
    }
}
export async function onRequestError(err, request, context) {
    const error = err instanceof Error ? err : new Error(String(err));
    captureError(error, {
        tags: {
            'next.method': request?.method ?? '',
            'next.route': context?.routePath ?? request?.path ?? request?.url ?? '',
            'next.routeType': context?.routeType ?? '',
            'next.runtime': context?.runtime ?? 'unknown',
            source: 'next.requestError',
        },
    });
}
//# sourceMappingURL=server.js.map
import type { InitOptions } from './types.js';
/**
 * Configure the SDK and (by default) wire global error handlers.
 *
 * Browser: window 'error' + 'unhandledrejection' → captureError.
 * Node: process 'uncaughtException' + 'unhandledRejection' → captureError.
 *
 * Pass `enableGlobalHooks: false` if you want to drive captures
 * manually (e.g. tests, or a host that owns its own crash plumbing).
 */
export declare function initSentori(options: InitOptions): void;
//# sourceMappingURL=init.d.ts.map
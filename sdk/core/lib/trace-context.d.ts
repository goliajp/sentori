import type { SpanContextLike } from './spans.js';
/** Currently active span context, or null. Falls back across the
 *  fallback impl's save-and-restore boundary. */
export declare function activeSpan(): SpanContextLike | null;
/**
 * Run `fn` with `span` as the active span. Use this to wrap any unit
 * of work whose child spans should attribute up to this one:
 *
 *     const span = startSpan('handler.GET')
 *     try {
 *       return await withSpan(span, async () => {
 *         // any startSpan() in here picks up `span` as parent
 *         return await loadUser()
 *       })
 *     } finally {
 *       span.finish({ status: 'ok' })
 *     }
 *
 * Node: routed through AsyncLocalStorage, so awaits inside `fn`
 * preserve the active span.
 *
 * Browser/RN: save-and-restore. Correct for linear awaits;
 * concurrent promises forked inside `fn` won't see the active span
 * after the first await suspends.
 */
export declare function withSpan<T>(span: SpanContextLike, fn: () => T): T;
/** Reset the implementation choice — test-only. Production code never
 *  calls this; switching propagation strategy at runtime would mean
 *  losing the current active context. */
export declare function __resetTraceContextForTests(): void;
//# sourceMappingURL=trace-context.d.ts.map
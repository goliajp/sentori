import type { Span, SpanStatus } from './types.js';
/** Hint passed to `startSpan`. `parent` overrides whatever
 *  `activeSpan()` would resolve to; `traceId` overrides both. */
export type StartSpanOptions = {
    data?: Record<string, unknown>;
    name?: string;
    parent?: null | SpanContextLike;
    tags?: Record<string, string>;
    /** Wall-clock for testing; defaults to `Date.now()`. */
    startNowMs?: number;
    /** Force the trace id (used when continuing a distributed trace
     *  from a `traceparent` header). When both `parent` and `traceId`
     *  are provided, `traceId` wins. */
    traceId?: string;
    traceparent?: string;
};
/** Anything that has the two id fields we care about — covers
 *  `SpanHandle`, decoded `traceparent`, and naked literal objects. */
export type SpanContextLike = {
    spanId: string;
    traceId: string;
};
/** Returned from `startSpan`. Mutable; sealed by `finish()`. */
export declare class SpanHandle {
    readonly spanId: string;
    readonly traceId: string;
    readonly parentSpanId: null | string;
    readonly op: string;
    readonly startedAt: string;
    readonly traceparent: string | undefined;
    private name;
    private readonly tags;
    private data;
    private readonly startNowMs;
    private finished;
    constructor(op: string, opts?: StartSpanOptions);
    setName(name: string): this;
    setTag(key: string, value: string): this;
    setData(key: string, value: unknown): this;
    isFinished(): boolean;
    /**
     * Seal the span and push it onto `buffer`. Second + later calls are
     * a no-op (returning the already-sealed result is harder than it
     * sounds because we don't keep the Span around — easier to just
     * forbid double finish).
     */
    finish(opts?: {
        endNowMs?: number;
        status?: SpanStatus;
        tags?: Record<string, string>;
    }, buffer?: SpanBuffer): Span | null;
}
export declare class SpanBuffer {
    private readonly cap;
    private readonly items;
    constructor(cap?: number);
    push(span: Span): void;
    snapshot(): Span[];
    drain(): Span[];
    clear(): void;
    get size(): number;
}
/**
 * Open a span. When no `parent` or `traceId` is provided, this
 * inherits from the current active span (see `trace-context.ts`); if
 * there is none either, a fresh trace is rooted with `parentSpanId =
 * null`.
 */
export declare function startSpan(op: string, opts?: StartSpanOptions): SpanHandle;
/** Snapshot the global buffer (does not drain). */
export declare function getSpans(): Span[];
/** Take everything out of the global buffer (used by transport flush). */
export declare function drainSpans(): Span[];
export declare function clearSpans(): void;
//# sourceMappingURL=spans.d.ts.map
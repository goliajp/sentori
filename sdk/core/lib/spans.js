// Phase 35 sub-A: client-side span buffer + lifecycle.
//
// Mirrors the breadcrumb buffer pattern: bounded ring, module-scoped
// default, opt-in fresh instance for SDKs that need per-process
// isolation. Callers don't push pre-built spans; they call
// `startSpan()` to get a mutable handle, mutate as work happens, then
// `finish()` — that's the moment the span is sealed and pushed onto
// the buffer. The SDK's transport flushes whatever's in the buffer
// at its own cadence.
import { uuidV7 } from './uuid.js';
const DEFAULT_CAP = 1000;
/** Returned from `startSpan`. Mutable; sealed by `finish()`. */
export class SpanHandle {
    spanId;
    traceId;
    parentSpanId;
    op;
    startedAt;
    traceparent;
    name;
    tags;
    data;
    startNowMs;
    finished = false;
    constructor(op, opts = {}) {
        this.op = op;
        this.name = opts.name ?? op;
        this.tags = { ...(opts.tags ?? {}) };
        this.data = opts.data;
        this.traceparent = opts.traceparent;
        const parent = opts.parent;
        this.traceId = opts.traceId ?? parent?.traceId ?? uuidV7();
        this.parentSpanId = parent ? parent.spanId : null;
        this.spanId = uuidV7();
        this.startNowMs = opts.startNowMs ?? Date.now();
        this.startedAt = new Date(this.startNowMs).toISOString();
    }
    setName(name) {
        this.name = name;
        return this;
    }
    setTag(key, value) {
        this.tags[key] = value;
        return this;
    }
    setData(key, value) {
        if (!this.data)
            this.data = {};
        this.data[key] = value;
        return this;
    }
    isFinished() {
        return this.finished;
    }
    /**
     * Seal the span and push it onto `buffer`. Second + later calls are
     * a no-op (returning the already-sealed result is harder than it
     * sounds because we don't keep the Span around — easier to just
     * forbid double finish).
     */
    finish(opts = {}, buffer = _global) {
        if (this.finished)
            return null;
        this.finished = true;
        if (opts.tags)
            Object.assign(this.tags, opts.tags);
        const endMs = opts.endNowMs ?? Date.now();
        const durationMs = Math.max(0, endMs - this.startNowMs);
        const span = {
            data: this.data,
            durationMs,
            id: this.spanId,
            name: this.name,
            op: this.op,
            parentSpanId: this.parentSpanId,
            startedAt: this.startedAt,
            status: opts.status ?? 'ok',
            tags: { ...this.tags },
            traceId: this.traceId,
            ...(this.traceparent ? { traceparent: this.traceparent } : {}),
        };
        buffer.push(span);
        return span;
    }
}
export class SpanBuffer {
    cap;
    items = [];
    constructor(cap = DEFAULT_CAP) {
        this.cap = cap;
    }
    push(span) {
        this.items.push(span);
        while (this.items.length > this.cap) {
            this.items.shift();
        }
    }
    snapshot() {
        return this.items.slice();
    }
    drain() {
        const out = this.items.slice();
        this.items.length = 0;
        return out;
    }
    clear() {
        this.items.length = 0;
    }
    get size() {
        return this.items.length;
    }
}
const _global = new SpanBuffer();
/**
 * Open a span. When no `parent` or `traceId` is provided, this
 * inherits from the current active span (see `trace-context.ts`); if
 * there is none either, a fresh trace is rooted with `parentSpanId =
 * null`.
 */
export function startSpan(op, opts = {}) {
    const resolved = opts.parent === undefined ? activeSpan() : opts.parent;
    return new SpanHandle(op, { ...opts, parent: resolved });
}
/** Snapshot the global buffer (does not drain). */
export function getSpans() {
    return _global.snapshot();
}
/** Take everything out of the global buffer (used by transport flush). */
export function drainSpans() {
    return _global.drain();
}
export function clearSpans() {
    _global.clear();
}
// Trace context is imported lazily to avoid a circular module load —
// trace-context.ts itself imports SpanHandle.
import { activeSpan } from './trace-context.js';
//# sourceMappingURL=spans.js.map
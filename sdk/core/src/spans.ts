// Phase 35 sub-A: client-side span buffer + lifecycle.
//
// Mirrors the breadcrumb buffer pattern: bounded ring, module-scoped
// default, opt-in fresh instance for SDKs that need per-process
// isolation. Callers don't push pre-built spans; they call
// `startSpan()` to get a mutable handle, mutate as work happens, then
// `finish()` — that's the moment the span is sealed and pushed onto
// the buffer. The SDK's transport flushes whatever's in the buffer
// at its own cadence.

import type { Span, SpanStatus } from './types.js'
import { uuidV7 } from './uuid.js'

const DEFAULT_CAP = 1000

/** Hint passed to `startSpan`. `parent` overrides whatever
 *  `activeSpan()` would resolve to; `traceId` overrides both. */
export type StartSpanOptions = {
  data?: Record<string, unknown>
  name?: string
  parent?: null | SpanContextLike
  tags?: Record<string, string>
  /** Wall-clock for testing; defaults to `Date.now()`. */
  startNowMs?: number
  /** Force the trace id (used when continuing a distributed trace
   *  from a `traceparent` header). When both `parent` and `traceId`
   *  are provided, `traceId` wins. */
  traceId?: string
  traceparent?: string
}

/** Anything that has the two id fields we care about — covers
 *  `SpanHandle`, decoded `traceparent`, and naked literal objects. */
export type SpanContextLike = { spanId: string; traceId: string }

/** Returned from `startSpan`. Mutable; sealed by `finish()`. */
export class SpanHandle {
  readonly spanId: string
  readonly traceId: string
  readonly parentSpanId: null | string
  readonly op: string
  readonly startedAt: string
  readonly traceparent: string | undefined
  private name: string
  private readonly tags: Record<string, string>
  private data: Record<string, unknown> | undefined
  private readonly startNowMs: number
  private finished = false

  constructor(op: string, opts: StartSpanOptions = {}) {
    this.op = op
    this.name = opts.name ?? op
    this.tags = { ...(opts.tags ?? {}) }
    this.data = opts.data
    this.traceparent = opts.traceparent

    const parent = opts.parent
    this.traceId = opts.traceId ?? parent?.traceId ?? uuidV7()
    this.parentSpanId = parent ? parent.spanId : null
    this.spanId = uuidV7()
    this.startNowMs = opts.startNowMs ?? Date.now()
    this.startedAt = new Date(this.startNowMs).toISOString()
  }

  setName(name: string): this {
    this.name = name
    return this
  }

  setTag(key: string, value: string): this {
    this.tags[key] = value
    return this
  }

  setData(key: string, value: unknown): this {
    if (!this.data) this.data = {}
    this.data[key] = value
    return this
  }

  isFinished(): boolean {
    return this.finished
  }

  /**
   * Seal the span and push it onto `buffer`. Second + later calls are
   * a no-op (returning the already-sealed result is harder than it
   * sounds because we don't keep the Span around — easier to just
   * forbid double finish).
   */
  finish(
    opts: { endNowMs?: number; status?: SpanStatus; tags?: Record<string, string> } = {},
    buffer: SpanBuffer = _global,
  ): Span | null {
    if (this.finished) return null
    this.finished = true
    if (opts.tags) Object.assign(this.tags, opts.tags)
    const endMs = opts.endNowMs ?? Date.now()
    const durationMs = Math.max(0, endMs - this.startNowMs)
    const span: Span = {
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
    }
    buffer.push(span)
    return span
  }
}

export class SpanBuffer {
  private readonly cap: number
  private readonly items: Span[] = []

  constructor(cap: number = DEFAULT_CAP) {
    this.cap = cap
  }

  push(span: Span): void {
    this.items.push(span)
    while (this.items.length > this.cap) {
      this.items.shift()
    }
  }

  snapshot(): Span[] {
    return this.items.slice()
  }

  drain(): Span[] {
    const out = this.items.slice()
    this.items.length = 0
    return out
  }

  clear(): void {
    this.items.length = 0
  }

  get size(): number {
    return this.items.length
  }
}

const _global = new SpanBuffer()

/**
 * Open a span. When no `parent` or `traceId` is provided, this
 * inherits from the current active span (see `trace-context.ts`); if
 * there is none either, a fresh trace is rooted with `parentSpanId =
 * null`.
 */
export function startSpan(op: string, opts: StartSpanOptions = {}): SpanHandle {
  const resolved = opts.parent === undefined ? activeSpan() : opts.parent
  return new SpanHandle(op, { ...opts, parent: resolved })
}

/** Snapshot the global buffer (does not drain). */
export function getSpans(): Span[] {
  return _global.snapshot()
}

/** Take everything out of the global buffer (used by transport flush). */
export function drainSpans(): Span[] {
  return _global.drain()
}

export function clearSpans(): void {
  _global.clear()
}

// Trace context is imported lazily to avoid a circular module load —
// trace-context.ts itself imports SpanHandle.
import { activeSpan } from './trace-context.js'

export type Platform = 'android' | 'ios' | 'javascript';
/** The five kinds. The union IS the concept model. */
export type EventKind = 'assert' | 'error' | 'probe' | 'trace' | 'warn';
/** One stack frame, symbolication-ready. */
export type Frame = {
    file?: string;
    function?: string;
    line?: number;
    column?: number;
    inApp?: boolean;
    absolutePath?: string;
};
/** A thrown error, normalized (coerce-error.ts produces these). */
export type SentoriError = {
    type: string;
    message: string;
    stack?: Frame[];
    cause?: SentoriError | null;
};
/**
 * One entry of the signal ring — the last-30-seconds context that
 * ships inside `payload.signals` when an error/warn goes out.
 * Replaces the Sentry breadcrumb + trail pair.
 */
export type Signal = {
    /** Seconds relative to the event (negative = before). */
    t: number;
    /** nav | tap | http | lifecycle | trace | log */
    kind: string;
    data?: Record<string, unknown>;
};
export type Device = {
    os: string;
    osVersion?: string;
    model?: string;
    locale?: string;
    screen?: {
        width: number;
        height: number;
        scale?: number;
    };
    memoryMb?: number;
    batteryLevel?: number;
    network?: string;
};
export type App = {
    version: string;
    build?: string;
    framework?: {
        name: string;
        version: string;
    };
};
/** Where a warn happened — fingerprint input on the server. */
export type Surface = {
    screen?: string;
    element?: string;
    [k: string]: unknown;
};
/**
 * One event on the wire. Top-level fields are what the server
 * routes/fingerprints on; everything else rides in `payload`
 * untouched (zero-migration SDK additions).
 */
export type WireEvent = {
    /** Client-minted UUIDv7; the server accepts or mints. */
    id?: string;
    kind: EventKind;
    /** RFC 3339. */
    occurredAt: string;
    platform: Platform;
    release?: string;
    environment?: string;
    /** warn/trace/assert name; probe ref. */
    name?: string;
    surface?: Surface;
    /** Salted identity hash — computed client-side (identity.ts). */
    userKey?: string;
    payload: WirePayload;
};
export type WirePayload = {
    error?: SentoriError;
    device?: Device;
    app?: App;
    signals?: Signal[];
    /** The verb's data argument, error instances already serialized. */
    data?: Record<string, unknown>;
    /** Ambient context (flags / tags) as patched via sentori.context(). */
    context?: Record<string, unknown>;
    [k: string]: unknown;
};
/** Client-side aggregate of assert passes (design.md §2). */
export type AssertStat = {
    name: string;
    release?: string;
    passDelta: number;
    failDelta?: number;
};
/** POST /v1/events:batch envelope. */
export type BatchEnvelope = {
    events: WireEvent[];
    assertStats?: AssertStat[];
};
/** Per-event server outcome. */
export type IngestOutcome = {
    eventId?: string;
    issueId?: string;
    isNewIssue?: boolean;
    regressed?: boolean;
    error?: string;
};
export type BatchResponse = {
    accepted: number;
    outcomes: IngestOutcome[];
};
export type AttachmentKind = 'logTail' | 'replay' | 'screenshot' | 'stateSnapshot' | 'viewTree';
export type AttachmentSource = 'android' | 'ios' | 'js';
export type User = {
    id?: string;
    name?: string;
    email?: string;
};
export type EventData = Record<string, unknown>;
export type TraceOptions = {
    /** Ring-only: keep it as context, do not report an event. */
    quiet?: boolean;
};
export interface SentoriApi {
    init(config: InitConfig): void;
    user(u: User | null): void;
    context(patch: Record<string, unknown>): void;
    error(err: unknown, data?: EventData): string;
    warn(name: string, data?: EventData): string;
    trace(name: string, data?: EventData, opts?: TraceOptions): string;
    assert(name: string, ok: boolean, data?: EventData): string;
    probe(ref: string, data?: EventData): string;
}
export type InitConfig = {
    /** Ingest token (`st_…`), scope `ingest`. */
    token: string;
    /** The instance to report to, e.g. `https://sentori.golia.jp`. */
    ingestUrl: string;
    release?: string;
    environment?: string;
    /** Warn-scenario auto-detection switches; conservative defaults. */
    detect?: {
        rageTap?: boolean;
        longFreeze?: boolean;
        slowColdStart?: boolean;
        slowApi?: boolean;
    };
    /** B-type replay rolling buffer, seconds. 0 disables. */
    replaySeconds?: number;
    /** Console gate: default `warn` — silent unless genuinely broken. */
    logLevel?: 'debug' | 'error' | 'info' | 'silent' | 'warn';
    /** Last-resort event filter; exceptions fall back to the event. */
    beforeSend?: (event: WireEvent) => WireEvent | null;
};
//# sourceMappingURL=types.d.ts.map
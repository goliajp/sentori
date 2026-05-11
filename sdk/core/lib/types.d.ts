/**
 * Wire-format types for the Sentori `/v1/events` endpoint.
 *
 * Single source of truth shared by every `@goliapkg/sentori-*` SDK and
 * mirrored by the server's `event::Event` Rust type. Anything added /
 * removed / renamed here must move in lockstep with `docs/protocol.md`
 * and the server.
 */
export type Platform = 'android' | 'ios' | 'javascript';
export type DeviceOS = 'android' | 'ios' | 'other' | 'web';
/**
 * `error` is the default — anything thrown / uncaught.
 * `anr` is the Android ANR watchdog (≥ 5 s main-thread freeze) and,
 * once Phase 22 sub-E lands, iOS hang detection.
 */
export type EventKind = 'anr' | 'error';
export type BreadcrumbType = 'custom' | 'log' | 'nav' | 'net' | 'user';
export type Event = {
    app: App;
    breadcrumbs?: Breadcrumb[];
    device: Device;
    environment: string;
    error: SentoriError;
    fingerprint?: string[];
    id: string;
    kind: EventKind;
    platform: Platform;
    release: string;
    spanId?: null | string;
    tags?: Tags;
    timestamp: string;
    traceId?: null | string;
    user?: null | User;
};
export type Device = {
    locale?: string;
    model?: string;
    os: DeviceOS;
    osVersion: string;
};
export type App = {
    build?: string;
    framework?: {
        name: string;
        version: string;
    };
    version: string;
};
/** PII-minimal — matches the server schema. */
export type User = {
    anonymous?: boolean;
    id?: string;
};
export type Tags = Record<string, string>;
export type SentoriError = {
    cause?: null | SentoriError;
    message: string;
    stack: Frame[];
    type: string;
};
export type Frame = {
    absolutePath?: string;
    column?: number;
    file: string;
    function?: string;
    inApp: boolean;
    line: number;
    /** RN native symbolication may attach surrounding source lines. */
    postContext?: string[];
    preContext?: string[];
};
export type Breadcrumb = {
    data: Record<string, unknown>;
    timestamp: string;
    type: BreadcrumbType;
};
/** Optional context attached at capture time. */
export type CaptureExtras = {
    fingerprint?: string[];
    tags?: Tags;
    user?: User;
};
/** Phase 34 sub-A: span wire format. See docs/protocol.md#span-schema. */
export type SpanStatus = 'cancelled' | 'error' | 'ok';
export type Span = {
    data?: Record<string, unknown>;
    durationMs: number;
    id: string;
    name: string;
    op: string;
    parentSpanId: null | string;
    startedAt: string;
    status: SpanStatus;
    tags: Record<string, string>;
    /** Original W3C traceparent header value if this span continues a
     *  trace from another process. Optional. */
    traceparent?: string;
    traceId: string;
};
/** Subset of init options that every SDK accepts. SDKs may extend. */
export type CommonInitOptions = {
    /** "prod" / "dev" / "staging" / whatever you want. */
    environment: string;
    /** e.g. https://ingest.sentori.golia.jp */
    ingestUrl: string;
    /** e.g. "myapp@1.2.3+456" */
    release: string;
    /** Public token, format `st_pk_<26 base32 chars>`. */
    token: string;
};
//# sourceMappingURL=types.d.ts.map
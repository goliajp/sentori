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
    /** Phase 42 sub-C.05 / sub-D.02: references to blobs previously
     *  uploaded via `POST /v1/events/<id>/attachments/<kind>`. Server
     *  validates each `ref` matches a row it issued for this event_id;
     *  unknown refs are silently dropped (the rest of the event still
     *  lands). Empty / absent on every event today; sub-D / E / F / G
     *  populate this as native + JS layers ship attachment capture. */
    attachments?: AttachmentMeta[];
    breadcrumbs?: Breadcrumb[];
    device: Device;
    environment: string;
    error: SentoriError;
    fingerprint?: string[];
    /** v0.8.0-d — server-set from a GeoIP lookup on the client's IP.
     *  Clients never set this; the server overwrites any incoming
     *  value before persist. `undefined` when the operator hasn't
     *  configured a db or the IP isn't resolvable (private range). */
    geo?: Geo;
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
export type Geo = {
    /** ISO 3166-1 alpha-2, uppercase. */
    country: string;
    /** ISO 3166-2 subdivision (no country prefix). City-grade db only. */
    region?: string;
    /** Localised English city name. City-grade db only. */
    city?: string;
};
/**
 * Phase 42 sub-D.02 — wire-format reference to an already-uploaded
 * blob. The SDK uploads the binary first (multipart POST), the
 * server returns a `ref` (UUID it generated), and the SDK echoes
 * the ref back inside the next `event.attachments[]`.
 */
export type AttachmentKind = 'logTail' | 'screenshot' | 'sessionTrail' | 'stateSnapshot' | 'viewTree';
export type AttachmentSource = 'android' | 'ios' | 'js';
export type AttachmentMeta = {
    /** Server-issued UUID — the only field ingest actually trusts. */
    ref: string;
    kind: AttachmentKind;
    /** Echoed back so the dashboard can render the right viewer
     *  without a second round-trip. */
    mediaType?: string;
    sizeBytes?: number;
    source?: AttachmentSource;
};
export type Device = {
    locale?: string;
    model?: string;
    /** v0.8.0-c — effective connection class at capture time.
     *  Web: `navigator.connection.effectiveType` (Network Information
     *  API, Chrome / Edge / Safari Tech). RN: `@react-native-community/netinfo`
     *  if installed (NetInfo's `details.cellularGeneration` mapped to the
     *  same enum). `undefined` when not available. */
    networkType?: '2g' | '3g' | '4g' | 'offline' | 'slow-2g' | 'unknown' | 'wifi';
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
/**
 * Phase 44 sub-A — per-event-class client-side sampling. Each rate
 * is in `[0, 1]`; absent / null → 1.0 (keep everything). The
 * **client** drops sampled-out events before they ever leave the
 * device, so a 10w-user app can dial down trace volume by 10x
 * without ingest-side budget changes.
 *
 * `traces` is sampled deterministically over `traceId` so every
 * span in the same trace shares the same decision — you never get
 * the root-span-without-children / half-trace shape.
 *
 * `errors` is sampled uniformly per event (no notion of "session"
 * here); apps that want a session-keyed decision can pre-compute
 * a derived rate per session and feed it through.
 */
export type SamplingConfig = {
    errors?: null | number;
    traces?: null | number;
};
//# sourceMappingURL=types.d.ts.map
/**
 * Wire shape for an event sent to the Sentori `/v1/events` endpoint.
 * Identical to the protocol documented in `docs/protocol.md` and the
 * server's `event::Event` Rust type.
 */
export type Event = {
    app: {
        build?: string;
        framework?: {
            name: string;
            version: string;
        };
        version: string;
    };
    breadcrumbs: Breadcrumb[];
    device: {
        locale?: string;
        model?: string;
        os: string;
        osVersion: string;
    };
    environment: string;
    error: SentoriError;
    fingerprint?: string[];
    id: string;
    kind: 'error';
    platform: 'javascript';
    release: string;
    spanId?: null | string;
    tags?: Tags;
    timestamp: string;
    traceId?: null | string;
    user?: null | User;
};
export type SentoriError = {
    cause: null | SentoriError;
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
};
export type BreadcrumbType = 'custom' | 'log' | 'nav' | 'net' | 'user';
export type Breadcrumb = {
    data: Record<string, unknown>;
    timestamp: string;
    type: BreadcrumbType;
};
/** PII-minimal — same shape as the RN SDK and the server schema. */
export type User = {
    anonymous?: boolean;
    id?: string;
};
export type Tags = Record<string, string>;
export type CaptureExtras = {
    fingerprint?: string[];
    tags?: Tags;
    user?: User;
};
export type InitOptions = {
    /** Override automatic global hooks. Default: true on browser + node. */
    enableGlobalHooks?: boolean;
    /** "prod" / "dev" / "staging" / whatever you want. */
    environment: string;
    /** e.g. https://ingest.sentori.golia.jp */
    ingestUrl: string;
    /** e.g. "myapp@1.2.3+456" */
    release: string;
    /** st_pk_<26 base32 chars> */
    token: string;
};
//# sourceMappingURL=types.d.ts.map
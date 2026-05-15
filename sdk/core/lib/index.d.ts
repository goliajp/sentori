export type { App, AttachmentKind, AttachmentMeta, AttachmentSource, Breadcrumb, BreadcrumbType, Bundle, CaptureExtras, CommonInitOptions, Device, DeviceOS, Event, EventKind, Frame, Geo, Platform, SamplingConfig, SentoriError, Span, SpanStatus, Tags, User, } from './types.js';
export { coerceError } from './coerce-error.js';
export { MomentHandle, type MomentProperties, type MomentStatus, startMoment, } from './moments.js';
export { shouldSample, shouldSampleTrace } from './sampling.js';
export { uuidV7 } from './uuid.js';
export { BreadcrumbBuffer, addBreadcrumb, clearBreadcrumbs, getBreadcrumbs, } from './breadcrumbs.js';
export { parseStack, type ParseStackOptions } from './stack.js';
export { normalizeUrl } from './url.js';
export { type SessionContext, type SessionPing, type SessionStatus, SessionTracker, } from './session.js';
export { SpanBuffer, SpanHandle, type SpanContextLike, type StartSpanOptions, clearSpans, drainSpans, getSpans, startSpan, } from './spans.js';
export { __resetTraceContextForTests, __useFallbackTraceContextForTests, activeSpan, setActiveSpan, withSpan, } from './trace-context.js';
export { TrailBuffer, sealTrail, type SessionTrailPayload, type TrailStep, } from './trail.js';
//# sourceMappingURL=index.d.ts.map
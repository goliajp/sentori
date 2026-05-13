export type {
  App,
  AttachmentKind,
  AttachmentMeta,
  AttachmentSource,
  Breadcrumb,
  BreadcrumbType,
  CaptureExtras,
  CommonInitOptions,
  Device,
  DeviceOS,
  Event,
  EventKind,
  Frame,
  Platform,
  SamplingConfig,
  SentoriError,
  Span,
  SpanStatus,
  Tags,
  User,
} from './types.js'

export { shouldSample, shouldSampleTrace } from './sampling.js'

export { uuidV7 } from './uuid.js'

export {
  BreadcrumbBuffer,
  addBreadcrumb,
  clearBreadcrumbs,
  getBreadcrumbs,
} from './breadcrumbs.js'

export { parseStack, type ParseStackOptions } from './stack.js'

export { normalizeUrl } from './url.js'

export {
  type SessionContext,
  type SessionPing,
  type SessionStatus,
  SessionTracker,
} from './session.js'

export {
  SpanBuffer,
  SpanHandle,
  type SpanContextLike,
  type StartSpanOptions,
  clearSpans,
  drainSpans,
  getSpans,
  startSpan,
} from './spans.js'

export {
  __resetTraceContextForTests,
  __useFallbackTraceContextForTests,
  activeSpan,
  setActiveSpan,
  withSpan,
} from './trace-context.js'

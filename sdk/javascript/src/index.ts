export { addBreadcrumb, clearBreadcrumbs, getBreadcrumbs } from './breadcrumbs.js'
export {
  captureError,
  captureException,
  captureMessage,
  captureStep,
  getUser,
  setTag,
  setTags,
  setUser,
} from './capture.js'
export { initSentori } from './init.js'
export {
  startSpan,
  startTrace,
  withScopedSpan,
  type SpanContextLike,
  type StartSpanOptions,
} from '@goliapkg/sentori-core'
export type {
  CaptureMessageOptions,
  MessageLevel,
  TrailStep,
} from '@goliapkg/sentori-core'
export type {
  Breadcrumb,
  BreadcrumbType,
  CaptureExtras,
  Event,
  Frame,
  InitOptions,
  SentoriError,
  Tags,
  User,
} from './types.js'

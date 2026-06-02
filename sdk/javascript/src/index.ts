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
// v2.1 W2 — runtime metrics primitives. Hosts (or framework
// adapters) emit auto-instrument points via `emitMetric`; the
// flusher in `./runtime-metrics.js` drains every 30 s. Buffer is
// module-scoped in core so emit + drain stay coherent across
// the SDK bundle.
export {
  RuntimeMetricBuffer,
  drainRuntimeMetricsForFlush,
  emitMetric,
  rebufferRuntimeMetrics,
  type RuntimeMetricPoint,
} from '@goliapkg/sentori-core'
export {
  flushRuntimeMetrics,
  startRuntimeMetricsTimer,
  stopRuntimeMetricsTimer,
} from './runtime-metrics.js'
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

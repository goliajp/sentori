export { addBreadcrumb, clearBreadcrumbs, getBreadcrumbs } from './breadcrumbs.js';
export { captureError, captureException, captureMessage, captureStep, getUser, setTag, setTags, setUser, } from './capture.js';
export { initSentori } from './init.js';
export { startSpan, startTrace, withScopedSpan, type SpanContextLike, type StartSpanOptions, } from '@goliapkg/sentori-core';
export { RuntimeMetricBuffer, drainRuntimeMetricsForFlush, emitMetric, rebufferRuntimeMetrics, type RuntimeMetricPoint, } from '@goliapkg/sentori-core';
export { flushRuntimeMetrics, startRuntimeMetricsTimer, stopRuntimeMetricsTimer, } from './runtime-metrics.js';
export type { CaptureMessageOptions, MessageLevel, TrailStep, } from '@goliapkg/sentori-core';
export type { Breadcrumb, BreadcrumbType, CaptureExtras, Event, Frame, InitOptions, SentoriError, Tags, User, } from './types.js';
//# sourceMappingURL=index.d.ts.map
import { init } from './init';
import { addBreadcrumb } from './breadcrumbs';
import {
  captureError,
  captureException,
  captureStep,
  getUser,
  sendUserFeedback,
  setUser,
} from './capture';
import { ErrorBoundary } from './error-boundary';
import { clearMaskQuery, registerMaskQuery } from './mask';
import { flushMetrics, recordMetric } from './metrics';
import {
  endSession,
  markSessionCrashed,
  startSession,
} from './session-tracker';

export const sentori = {
  init,
  addBreadcrumb,
  setUser,
  getUser,
  captureError,
  captureException,
  captureStep,
  sendUserFeedback,
  recordMetric,
  flushMetrics,
  ErrorBoundary,
  registerMaskQuery,
  clearMaskQuery,
  startSession,
  endSession,
  markSessionCrashed,
};

export default sentori;

export { init, init as initSentori } from './init';
export { addBreadcrumb } from './breadcrumbs';
export {
  captureError,
  captureException,
  captureStep,
  getUser,
  sendUserFeedback,
  setUser,
} from './capture';
export { ErrorBoundary } from './error-boundary';
export { clearMaskQuery, registerMaskQuery } from './mask';
export { flushMetrics, recordMetric } from './metrics';
export {
  startAnrWatchdog,
  stopAnrWatchdog,
  triggerNativeCrash,
} from './native';
export {
  endSession,
  markSessionCrashed,
  startSession,
} from './session-tracker';
export { type NavigationRefLike, useTraceNavigation } from './navigation';

export type {
  Event,
  SentoriError,
  Frame,
  Breadcrumb,
  BreadcrumbType,
  Device,
  DeviceOS,
  App,
  User,
  Tags,
  EventKind,
  Platform,
} from './types';

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
import { FeedbackButton, type FeedbackButtonHandle, type FeedbackButtonProps } from './feedback-widget';
import {
  clearAllFeatureFlags,
  clearFeatureFlag,
  getFeatureFlags,
  setFeatureFlag,
} from './feature-flags';
import { clearMaskQuery, registerMaskQuery } from './mask';
import { measureFn } from './measure';
import {
  getColdStartMs,
  markTimeToFullDisplay,
  type TimeToFullDisplayHandle,
} from './mobile-vitals';
import { bindState, recordState, unbindState } from './state-snapshots';
import { startMoment } from '@goliapkg/sentori-core';
import { flushMetrics, recordMetric } from './metrics';
import { RageTapCapture } from './rage-tap';
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
  measureFn,
  startMoment,
  bindState,
  recordState,
  unbindState,
  markTimeToFullDisplay,
  getColdStartMs,
  setFeatureFlag,
  clearFeatureFlag,
  clearAllFeatureFlags,
  getFeatureFlags,
  ErrorBoundary,
  FeedbackButton,
  RageTapCapture,
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
export { FeedbackButton, type FeedbackButtonHandle, type FeedbackButtonProps } from './feedback-widget';
export {
  clearAllFeatureFlags,
  clearFeatureFlag,
  getFeatureFlags,
  setFeatureFlag,
} from './feature-flags';
export { clearMaskQuery, registerMaskQuery } from './mask';
export { flushMetrics, recordMetric } from './metrics';
export { measureFn } from './measure';
export {
  getColdStartMs,
  markTimeToFullDisplay,
  type TimeToFullDisplayHandle,
} from './mobile-vitals';
export { MomentHandle, type MomentProperties, startMoment } from '@goliapkg/sentori-core';
export {
  bindState,
  recordState,
  type StateSnapshot,
  unbindState,
} from './state-snapshots';
export { RageTapCapture } from './rage-tap';
export {
  probeNativeScreenshot,
  probeNativeWireframe,
  startAnrWatchdog,
  stopAnrWatchdog,
  triggerNativeCrash,
} from './native';
export { drainReplay, startReplay, stopReplay } from './replay';
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

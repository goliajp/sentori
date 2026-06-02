import { init } from './init';
import { addBreadcrumb } from './breadcrumbs';
import {
  captureError,
  captureException,
  captureMessage,
  captureStep,
  getUser,
  sendUserFeedback,
  setTag,
  setTags,
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
import {
  startMoment,
  startSpan,
  startTrace,
  withScopedSpan,
} from '@goliapkg/sentori-core';
import { getInstallId } from './install-id';
import { flushMetrics, recordMetric } from './metrics';
import { close, flush } from './lifecycle';
import { linkFederatedIdentity, reportPinMismatch, reportSecurity } from './report-security';
import { flushTrack, track } from './track';
import { queryTrustScore } from './trust-score';
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
  setTag,
  setTags,
  captureError,
  captureException,
  captureMessage,
  captureStep,
  sendUserFeedback,
  recordMetric,
  flushMetrics,
  track,
  flushTrack,
  getInstallId,
  reportSecurity,
  reportPinMismatch,
  queryTrustScore,
  linkFederatedIdentity,
  measureFn,
  startMoment,
  startSpan,
  startTrace,
  withScopedSpan,
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
  flush,
  close,
};

export default sentori;

export { init, init as initSentori } from './init';
export { addBreadcrumb } from './breadcrumbs';
export {
  captureError,
  captureException,
  captureMessage,
  captureStep,
  getUser,
  sendUserFeedback,
  setTag,
  setTags,
  setUser,
} from './capture';
export {
  startMoment,
  startSpan,
  startTrace,
  withScopedSpan,
  type SpanContextLike,
  type StartSpanOptions,
} from '@goliapkg/sentori-core';
export { close, flush } from './lifecycle';
export type {
  CaptureMessageOptions,
  MessageLevel,
} from '@goliapkg/sentori-core';
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
export { flushTrack, track, type TrackEvent, type TrackProps } from './track';
export { getInstallId, peekInstallId } from './install-id';
export {
  linkFederatedIdentity,
  reportPinMismatch,
  reportSecurity,
  type SecurityReportData,
} from './report-security';
export {
  queryTrustScore,
  type TrustScore,
  type TrustSignal,
} from './trust-score';
export { measureFn } from './measure';
export {
  getColdStartMs,
  markTimeToFullDisplay,
  type TimeToFullDisplayHandle,
} from './mobile-vitals';
export { MomentHandle, type MomentProperties } from '@goliapkg/sentori-core';
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

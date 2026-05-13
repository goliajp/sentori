import { init } from './init';
import { addBreadcrumb } from './breadcrumbs';
import { setUser, getUser, captureError, captureException, captureStep } from './capture';
import { ErrorBoundary } from './error-boundary';
import { MaskRegion, setMaskedNode, unsetMaskedNode } from './mask';
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
  ErrorBoundary,
  MaskRegion,
  setMaskedNode,
  unsetMaskedNode,
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
  setUser,
} from './capture';
export { ErrorBoundary } from './error-boundary';
export { MaskRegion, setMaskedNode, unsetMaskedNode } from './mask';
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

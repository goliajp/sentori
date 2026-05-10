import { init } from './init';
import { addBreadcrumb } from './breadcrumbs';
import { setUser, getUser, captureError, captureException } from './capture';
import { ErrorBoundary } from './error-boundary';
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
  ErrorBoundary,
  startSession,
  endSession,
  markSessionCrashed,
};

export default sentori;

export { init, init as initSentori } from './init';
export { addBreadcrumb } from './breadcrumbs';
export { setUser, getUser, captureError, captureException } from './capture';
export { ErrorBoundary } from './error-boundary';
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

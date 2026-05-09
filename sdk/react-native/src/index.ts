import { init } from './init';
import { addBreadcrumb } from './breadcrumbs';
import { setUser, getUser, captureError, captureException } from './capture';
import { ErrorBoundary } from './error-boundary';

export const sentori = {
  init,
  addBreadcrumb,
  setUser,
  getUser,
  captureError,
  captureException,
  ErrorBoundary,
};

export default sentori;

export { init } from './init';
export { addBreadcrumb } from './breadcrumbs';
export { setUser, getUser, captureError, captureException } from './capture';
export { ErrorBoundary } from './error-boundary';
export { triggerNativeCrash } from './native';

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

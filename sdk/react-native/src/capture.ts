import { getConfig, isInitialized } from './config';
import { getBreadcrumbs } from './breadcrumbs';
import { symbolicateErrorViaMetro } from './handlers/dev-symbolicate';
import { markSessionErrored } from './session-tracker';
import { parseStack } from './stack';
import { enqueue } from './transport';
import { uuidV7 } from './uuid';
import type { App, Device, Event, SentoriError, Tags, User } from './types';

declare const __DEV__: boolean | undefined;

let _user: User | null = null;

/**
 * Attach a stable user identifier to events captured after this call.
 *
 * PII policy (Phase 16 sub-D): the User shape is intentionally limited
 * to `{ id?, anonymous? }` — no email, name, IP, or other identifying
 * fields. Use a hashed / pseudonymous id (e.g. uuid v4 stored in
 * AsyncStorage on first launch). The server schema enforces the same
 * shape, so any extra fields you tack on at the JS layer would be
 * rejected with `validationFailed` and never persisted.
 *
 * Pass `null` to clear (e.g. on sign-out).
 */
export const setUser = (user: User | null): void => {
  _user = user;
};

export const getUser = (): User | null => _user;

export type CaptureExtras = {
  tags?: Tags;
  user?: User;
  fingerprint?: string[];
};

export const captureError = (error: Error, extras?: CaptureExtras): void => {
  if (!isInitialized()) return;
  const config = getConfig();
  if (!config) return;

  const event: Event = {
    id: uuidV7(),
    timestamp: new Date().toISOString(),
    kind: 'error',
    platform: 'javascript',
    release: config.release,
    environment: config.environment,
    device: collectDevice(),
    app: collectApp(config.release),
    user: extras?.user ?? _user,
    tags: extras?.tags,
    breadcrumbs: getBreadcrumbs(),
    error: errorToObject(error),
    fingerprint: extras?.fingerprint,
  };

  // Phase 26 sub-B: a captured error promotes the current session to
  // `errored` so the next AppState=background ping reports unhealthy.
  markSessionErrored();

  // Phase 40 sub-E: in dev there's no uploaded source map, so ask
  // Metro to symbolicate the stack before we send it (best-effort,
  // short timeout). Release builds skip straight to enqueue and let
  // the server symbolicate at ingest against the uploaded map.
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    void symbolicateErrorViaMetro(event.error)
      .catch(() => {})
      .then(() => enqueue(event));
  } else {
    enqueue(event);
  }
};

export const captureException = captureError;

const errorToObject = (error: Error): SentoriError => {
  const causeRaw = (error as { cause?: unknown }).cause;
  let cause: SentoriError | null = null;
  if (causeRaw instanceof Error) {
    cause = errorToObject(causeRaw);
  }

  return {
    type: error.name || 'Error',
    message: error.message,
    stack: parseStack(error.stack),
    cause,
  };
};

const collectDevice = (): Device => {
  let os: Device['os'] = 'other';
  let osVersion = '0';
  try {
    const RN = require('react-native') as {
      Platform: { OS: string; Version: string | number };
    };
    const rnOS = RN.Platform.OS;
    os = rnOS === 'ios' || rnOS === 'android' || rnOS === 'web' ? rnOS : 'other';
    osVersion = String(RN.Platform.Version);
  } catch {
    // not in RN runtime (jest, bun test)
  }
  return { os, osVersion };
};

const collectApp = (release: string): App => {
  const m = /^(?:[^@]+@)?([^+]+)(?:\+(.+))?$/.exec(release);
  const version = m?.[1] ?? '0.0.0';
  const build = m?.[2];

  let rnVersion = 'unknown';
  try {
    rnVersion = (require('react-native/package.json') as { version: string }).version;
  } catch {
    // not in RN runtime
  }

  return {
    version,
    build,
    framework: { name: 'react-native', version: rnVersion },
  };
};

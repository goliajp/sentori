import { getConfig, isInitialized } from './config';
import { getBreadcrumbs } from './breadcrumbs';
import { parseStack } from './stack';
import { enqueue } from './transport';
import { uuidV7 } from './uuid';
import type { App, Device, Event, SentoriError, Tags, User } from './types';

let _user: User | null = null;

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

  enqueue(event);
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

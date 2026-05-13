import { addBreadcrumb, getBreadcrumbs } from './breadcrumbs';
import { getConfig, isInitialized } from './config';
import { symbolicateErrorViaMetro } from './handlers/dev-symbolicate';
import { captureScreenshot } from './handlers/screenshot';
import { markSessionErrored } from './session-tracker';
import { parseStack } from './stack';
import { enqueue, uploadAttachment } from './transport';
import { uuidV7 } from './uuid';
import type { App, AttachmentMeta, Device, Event, SentoriError, Tags, User } from './types';

declare const __DEV__: boolean | undefined;

let _user: User | null = null;

// Phase 42 sub-D.08 — per-session screenshot quota. Defaults: 10 in
// prod, unlimited (-1 sentinel) in dev so test loops + react-error-
// overlay reruns don't run out partway through the session.
const SCREENSHOT_PROD_LIMIT = 10;
let _screenshotsTaken = 0;

function screenshotBudget(): number {
  return typeof __DEV__ !== 'undefined' && __DEV__ ? -1 : SCREENSHOT_PROD_LIMIT;
}

export const __resetScreenshotBudgetForTests = (): void => {
  _screenshotsTaken = 0;
};

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
  /** Phase 42 sub-D.07: per-call screenshot override. `false` skips
   *  screenshot capture even when `init({ capture: { screenshot:
   *  true } })` is on — handy for sensitive screens. Defaults to
   *  whatever `config.screenshotsEnabled` says. */
  screenshot?: boolean;
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

  // Phase 42 sub-D.07: opt-in screenshot. Default off; per-call
  // `extras.screenshot: false` always wins so callers can mute it
  // on a sensitive flow even when init has it on globally.
  const wantScreenshot =
    config.screenshotsEnabled && extras?.screenshot !== false && allowScreenshot();

  // Phase 40 sub-E: in dev there's no uploaded source map, so ask
  // Metro to symbolicate the stack before we send it (best-effort,
  // short timeout). Release builds skip straight to enqueue and let
  // the server symbolicate at ingest against the uploaded map.
  const pipeline = async (): Promise<void> => {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      await symbolicateErrorViaMetro(event.error).catch(() => {});
    }
    if (wantScreenshot) {
      await captureAndAttachScreenshot(event);
    }
    enqueue(event);
  };
  void pipeline();
};

export const captureException = captureError;

/** Phase 42 sub-D.08: per-session screenshot quota gate. */
function allowScreenshot(): boolean {
  const budget = screenshotBudget();
  if (budget < 0) return true; // dev: unlimited
  if (_screenshotsTaken >= budget) return false;
  _screenshotsTaken += 1;
  return true;
}

/**
 * Phase 42 sub-D.06/07: take a screenshot, upload it, push the
 * server-issued ref into `event.attachments`. Every step is
 * best-effort — on any failure we leave a breadcrumb and let the
 * event ship without a thumbnail.
 */
async function captureAndAttachScreenshot(event: Event): Promise<void> {
  let blob: Awaited<ReturnType<typeof captureScreenshot>> = null;
  try {
    blob = await captureScreenshot();
  } catch {
    // capture itself shouldn't throw — `captureScreenshot` already
    // catches — but be defensive.
  }
  if (!blob) {
    addBreadcrumb({ type: 'custom', data: { reason: 'screenshot-capture-failed' } });
    return;
  }
  const attachment: AttachmentMeta | null = await uploadAttachment(
    event.id,
    'screenshot',
    blob,
    { source: 'js' },
  );
  if (!attachment) {
    addBreadcrumb({ type: 'custom', data: { reason: 'screenshot-upload-failed' } });
    return;
  }
  if (!event.attachments) event.attachments = [];
  event.attachments.push(attachment);
}

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

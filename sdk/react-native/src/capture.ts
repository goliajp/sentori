import { sealTrail, shouldSample } from '@goliapkg/sentori-core';

import { addBreadcrumb, getBreadcrumbs } from './breadcrumbs';
import { getBundleInfo } from './bundle-info';
import { getConfig, isInitialized } from './config';
import { getFeatureFlagSnapshot } from './feature-flags';
import { symbolicateErrorViaMetro } from './handlers/dev-symbolicate';
import { captureScreenshot } from './handlers/screenshot';
import { markSessionErrored } from './session-tracker';
import { parseStack } from './stack';
import { getTrailBuffer } from './trail';
import { enqueue, sendUserReport, uploadAttachment } from './transport';
import { uuidV7 } from './uuid';
import { getCachedNetworkType } from './netinfo';
import type { App, AttachmentMeta, Device, Event, SentoriError, Tags, User } from './types';

export { captureStep, __resetTrailForTests } from './trail';

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

/**
 * v0.8.2 — submit an end-user-supplied bug report. Use this when the
 * host app surfaces a "Report a problem" form. Pass `eventId` if the
 * user is reporting a specific crash they just saw — the server links
 * the report to that event's issue automatically.
 *
 * Returns `{ id, issueId }` on success or `null` on any failure
 * (network down, ingest token revoked, validation rejected). Doesn't
 * throw.
 */
export const sendUserFeedback = async (input: {
  body: string;
  email?: string;
  eventId?: string;
  name?: string;
  title: string;
}): Promise<null | { id: string; issueId: null | string }> => {
  if (!isInitialized()) return null;
  const config = getConfig();
  if (!config) return null;
  return sendUserReport(config.ingestUrl, config.token, input);
};

export const captureError = (error: Error, extras?: CaptureExtras): void => {
  if (!isInitialized()) return;
  const config = getConfig();
  if (!config) return;

  // Phase 44 sub-B: client-side sampling. Skip the whole pipeline
  // (no screenshot capture either) when the sample dice come up
  // wrong. Default rate = null = keep, so existing callers unaffected.
  if (!shouldSample(config.errorSampleRate)) {
    addBreadcrumb({ type: 'custom', data: { reason: 'sampled-out', kind: 'error' } });
    return;
  }

  const flags = getFeatureFlagSnapshot();
  const bundle = getBundleInfo();
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
    ...(flags ? { flags } : {}),
    ...(bundle ? { bundle } : {}),
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
    const trail = getTrailBuffer();
    if (config.sessionTrailEnabled && trail.size() > 0) {
      await captureAndAttachSessionTrail(event);
    }
    enqueue(event);
  };
  void pipeline();
};

/**
 * Phase 46 — seal the trail buffer, upload it as a `sessionTrail`
 * attachment, attach the ref. Best-effort: any failure leaves a
 * breadcrumb and lets the event ship without the trail.
 *
 * The trail is **always cleared** after `captureException`, even if
 * upload fails — we don't want a stale 30-step buffer leaking into
 * the next crash's trail.
 */
async function captureAndAttachSessionTrail(event: Event): Promise<void> {
  const trail = getTrailBuffer();
  const payload = sealTrail(trail);
  trail.clear();
  const json = JSON.stringify(payload);
  // base64 the JSON for the `data:` URI multipart bridge (same
  // trick the screenshot path uses).
  const base64 =
    typeof globalThis.btoa === 'function'
      ? globalThis.btoa(unescape(encodeURIComponent(json)))
      : Buffer.from(json, 'utf-8').toString('base64');
  const attachment = await uploadAttachment(
    event.id,
    'sessionTrail',
    { base64, mediaType: 'application/json' },
    { source: 'js' },
  );
  if (!attachment) {
    addBreadcrumb({ type: 'custom', data: { reason: 'session-trail-upload-failed' } });
    return;
  }
  if (!event.attachments) event.attachments = [];
  event.attachments.push(attachment);
}

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
  let locale: string | undefined;
  const networkType = getCachedNetworkType();
  try {
    const RN = require('react-native') as {
      NativeModules: {
        I18nManager?: { localeIdentifier?: string };
        SettingsManager?: {
          settings?: { AppleLanguages?: string[]; AppleLocale?: string };
        };
      };
      Platform: { OS: string; Version: string | number };
    };
    const rnOS = RN.Platform.OS;
    os = rnOS === 'ios' || rnOS === 'android' || rnOS === 'web' ? rnOS : 'other';
    osVersion = String(RN.Platform.Version);
    // v0.8.0-a — RN reads user locale through native modules. These
    // are stable RN-internal modules (SettingsManager since 0.4,
    // I18nManager since 0.16) so we can read them directly without
    // an extra peer dep. iOS returns e.g. "en_US"; Android returns
    // e.g. "en_US" via `getDefault().toString()`. `AppleLocale` is
    // the format the user picked in Settings; `AppleLanguages[0]`
    // is the resolved language priority — prefer the former.
    if (rnOS === 'ios') {
      const s = RN.NativeModules.SettingsManager?.settings;
      locale = s?.AppleLocale ?? s?.AppleLanguages?.[0];
    } else if (rnOS === 'android') {
      locale = RN.NativeModules.I18nManager?.localeIdentifier;
    }
  } catch {
    // not in RN runtime (jest, bun test)
  }
  const device: Device = { os, osVersion };
  if (locale) device.locale = locale;
  if (networkType) device.networkType = networkType;
  return device;
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

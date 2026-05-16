import { sealTrail, shouldSample } from '@goliapkg/sentori-core';

import {
  __peekBreadcrumbCount,
  addBreadcrumb,
  getBreadcrumbs,
} from './breadcrumbs';
import { getBundleInfo } from './bundle-info';
import { getConfig, isInitialized } from './config';
import { getFeatureFlagSnapshot } from './feature-flags';
import { drainReplay } from './replay';
import { clearStateSnapshots, getStateSnapshots } from './state-snapshots';
import { symbolicateErrorViaMetro } from './handlers/dev-symbolicate';
import { captureScreenshot } from './handlers/screenshot';
import { markSessionErrored } from './session-tracker';
import { parseStack } from './stack';
import { getTrailBuffer } from './trail';
import { enqueue, sendUserReport, uploadAttachment } from './transport';
import { uuidV7 } from './uuid';
import { getCachedNetworkType } from './netinfo';
import { getRecentNativeException } from './native';
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

/** v1.1 +S7 升级 — read just the current user id for the control
 *  channel poll. Returns `undefined` until `setUser({ id })` runs. */
export const getCurrentUserId = (): string | undefined => _user?.id ?? undefined;

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
  const crumbs = getBreadcrumbs();
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
    breadcrumbs: crumbs,
    error: errorToObject(error),
    fingerprint: extras?.fingerprint,
  };
  // v0.9.8 — dev-only diagnostic. Insight saw `breadcrumbs: []` on
  // every event in 0.9.7 despite handlers being installed; this line
  // makes it visible in Metro that the snapshot at captureException
  // time really is empty (no breadcrumb events fired yet) vs. having
  // been silently dropped on the wire. Production builds gate out.
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      '[sentori] captureException',
      'eventId=', event.id,
      'breadcrumbs=', crumbs.length,
      'wantScreenshot=', config.screenshotsEnabled && extras?.screenshot !== false,
      'wantSessionTrail=', config.sessionTrailEnabled,
    );
  }

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
    // v0.9.2 +S2 — state time-travel attachment. Only if anything has
    // been bound or recorded; cleared on success so the next crash's
    // ring doesn't carry stale entries.
    const stateSnapshots = getStateSnapshots();
    if (stateSnapshots.length > 0) {
      await captureAndAttachStateSnapshots(event, stateSnapshots);
      clearStateSnapshots();
    }
    // v0.9.6 #2 — wireframe replay attachment. drainReplay clears the
    // ring as a side effect so next session's replay starts fresh.
    const replayNdjson = drainReplay();
    if (replayNdjson.length > 0) {
      await captureAndAttachReplay(event, replayNdjson);
    }
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        '[sentori] enqueue',
        'eventId=', event.id,
        'attachments=', event.attachments?.length ?? 0,
        'kinds=', (event.attachments ?? []).map((a) => a.kind).join(',') || '(none)',
        'breadcrumbsAtEnqueue=', __peekBreadcrumbCount(),
      );
    }
    enqueue(event);
  };
  void pipeline();
};

/** v0.9.6 #2 — upload the wireframe replay ring as a `replay`
 *  attachment. Plain NDJSON (one snapshot per line) — server may
 *  gzip on storage; the network upload is base64. */
async function captureAndAttachReplay(event: Event, ndjson: string): Promise<void> {
  try {
    const base64 =
      typeof globalThis.btoa === 'function'
        ? globalThis.btoa(ndjson)
        : Buffer.from(ndjson, 'utf8').toString('base64');
    const meta = await uploadAttachment(
      event.id,
      'replay',
      { base64, mediaType: 'application/x-ndjson' },
      { source: 'js' },
    );
    if (meta) {
      if (!event.attachments) event.attachments = [];
      event.attachments.push(meta);
    }
  } catch {
    // best-effort
  }
}

/** v0.9.2 +S2 — upload the rolling state-snapshot ring as a
 *  `stateSnapshot` attachment so the dashboard time-travel viewer can
 *  scrub through diffs alongside the breadcrumb timeline. */
async function captureAndAttachStateSnapshots(
  event: Event,
  snapshots: ReturnType<typeof getStateSnapshots>,
): Promise<void> {
  try {
    const payload = JSON.stringify({ snapshots });
    const base64 =
      typeof globalThis.btoa === 'function'
        ? globalThis.btoa(payload)
        : // Bun / node fallback
          Buffer.from(payload, 'utf8').toString('base64');
    const meta = await uploadAttachment(
      event.id,
      'stateSnapshot',
      { base64, mediaType: 'application/json' },
      { source: 'js' },
    );
    if (meta) {
      if (!event.attachments) event.attachments = [];
      event.attachments.push(meta);
    }
  } catch {
    // best-effort
  }
}

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
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[sentori] screenshot capture threw', e);
    }
  }
  if (!blob) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn(
        '[sentori] screenshot blob null — native module missing or capture returned null',
        'eventId=', event.id,
      );
    }
    addBreadcrumb({ type: 'custom', data: { reason: 'screenshot-capture-failed' } });
    return;
  }
  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.warn(
      '[sentori] screenshot blob ok, uploading',
      'eventId=', event.id,
      'mediaType=', blob.mediaType,
      'base64Bytes=', blob.base64.length,
    );
  }
  const attachment: AttachmentMeta | null = await uploadAttachment(
    event.id,
    'screenshot',
    blob,
    { source: 'js' },
  );
  if (!attachment) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      // eslint-disable-next-line no-console
      console.warn('[sentori] screenshot upload returned null', 'eventId=', event.id);
    }
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

  // v0.9.5 #8 — TurboModule swallowed-exception bridge. If the host
  // wrapped a native call with `@try @catch + recordException`, the
  // native ring may hold a fresh entry (< 1 s old). Synthesize that
  // as a `cause` so the JS event includes the original native stack.
  if (cause === null) {
    const recent = getRecentNativeException();
    if (recent && recent.ageMs <= 1500) {
      cause = {
        type: recent.name || 'NativeException',
        message: recent.reason,
        stack: recent.stack.map((line, i) => ({
          function: line.trim(),
          file: '<native>',
          inApp: false,
          line: i + 1,
        })),
        cause: null,
      };
    }
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

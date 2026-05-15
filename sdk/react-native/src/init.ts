import { setConfig } from './config';
import { installGlobalHandler } from './handlers/global';
import { installLifecycleHandler } from './handlers/lifecycle';
import { installPromiseHandler } from './handlers/promise';
import { installNetworkHandler } from './handlers/network';
import { drainNativePending, setNativeConfig } from './native';
import { startNetworkTypeWatch } from './netinfo';
import { startSession } from './session-tracker';
import {
  drainOfflineQueue,
  enqueue,
  startTransport,
  uploadAttachment,
} from './transport';
import type { AttachmentKind, AttachmentMeta, AttachmentSource, Event } from './types';

declare const __DEV__: boolean | undefined;

export type InitOptions = {
  /** Project token starting with `st_pk_`. Required. */
  token: string;
  /** Release identifier, e.g. `myapp@1.2.3+456`. Required. */
  release: string;
  /** Environment label. Defaults to `dev` if `__DEV__`, else `prod`. */
  environment?: string;
  /** Override ingestion URL (self-hosted). Default: https://ingest.sentori.golia.jp */
  ingestUrl?: string;
  /** Toggle individual capture sources. All enabled by default. */
  capture?: {
    globalErrors?: boolean;
    promiseRejections?: boolean;
    network?: boolean;
    /** Session tracking: opens a session on init and on each
     *  foreground (`AppState` → `active`), ends it on background.
     *  Drives crash-free rate. Set `false` to opt out. */
    sessions?: boolean;
    /** Capture a screenshot of the current screen on
     *  `captureException`. Opt-in. The capture runs through the
     *  bundled native module — no extra peer dep required since
     *  v0.7.3. To redact PII regions, register a mask query via
     *  `sentori.registerMaskQuery(() => string[])` and put
     *  `nativeID="..."` on the `<View>`s the SDK should black out.
     *  The image is webp q=70 / jpeg q=70 at 480 px max, < 100 KB
     *  typical. */
    screenshot?: boolean;
    /** Phase 46: record the last N steps (route changes, custom
     *  breadcrumbs) leading up to a crash. On `captureException`
     *  the buffer is sealed and uploaded as a `sessionTrail`
     *  attachment. Defaults to false. */
    sessionTrail?: boolean;
  };
  /** Phase 44 sub-B: client-side sampling. Each rate is `[0, 1]`;
   *  absent / null keeps everything. Defaults to 1.0 for both
   *  (no drop). Set traces to e.g. 0.1 once the app's at user
   *  volume to keep ingest budget under control without changing
   *  the server-side quota. Decisions are made per-event for
   *  errors and per-trace (all spans together) for traces. */
  sampling?: {
    errors?: null | number;
    traces?: null | number;
  };
};

const DEFAULT_INGEST_URL = 'https://ingest.sentori.golia.jp';

export const init = (options: InitOptions): void => {
  if (!options.token || !options.token.startsWith('st_pk_')) {
    throw new Error("Sentori: token is required and must start with 'st_pk_'");
  }
  if (!options.release) {
    throw new Error('Sentori: release is required');
  }

  const env =
    options.environment ??
    (typeof __DEV__ !== 'undefined' && __DEV__ ? 'dev' : 'prod');

  setConfig({
    token: options.token,
    release: options.release,
    environment: env,
    ingestUrl: options.ingestUrl ?? DEFAULT_INGEST_URL,
    enabled: true,
    screenshotsEnabled: options.capture?.screenshot === true,
    errorSampleRate: options.sampling?.errors ?? null,
    traceSampleRate: options.sampling?.traces ?? null,
    sessionTrailEnabled: options.capture?.sessionTrail === true,
  });

  // Tell the native crash handler about the config so the JSON it writes
  // on the next NSException / Java uncaught carries release + env.
  setNativeConfig({
    token: options.token,
    release: options.release,
    environment: env,
  });

  startTransport();
  // v0.8.0-c — start watching network class. No-op if NetInfo isn't
  // installed; events just won't carry `device.networkType` in that
  // case.
  startNetworkTypeWatch();

  const capture = options.capture ?? {};
  if (capture.globalErrors !== false) installGlobalHandler();
  if (capture.promiseRejections !== false) installPromiseHandler();
  if (capture.network !== false) installNetworkHandler();
  if (capture.sessions !== false) {
    // Open the cold-start session now (RN doesn't fire an AppState
    // `change` for the initial `active` state), then bind AppState so
    // background ends it and the next foreground opens a fresh one.
    startSession();
    installLifecycleHandler();
  }

  // Drain events persisted from previous session (best-effort):
  // - native crashes from <Documents>/sentori/pending/*.json
  // - JS transport offline queue from AsyncStorage
  drainNativePending()
    .then(async (items) => {
      for (const json of items) {
        try {
          const event = JSON.parse(json) as Event & {
            _pendingAttachments?: PendingAttachment[];
          };
          // Phase 42 sub-E.05 / F.09: the native crash handler couldn't
          // upload attachments at crash time (the app was dying); it
          // base64-encoded them into `_pendingAttachments` instead.
          // On next launch we upload each before enqueueing the event,
          // so the dashboard sees the refs in `event.attachments[]`.
          if (event._pendingAttachments && event._pendingAttachments.length > 0) {
            for (const p of event._pendingAttachments) {
              const meta = await uploadAttachment(
                event.id,
                p.kind,
                { base64: p.base64, mediaType: p.mediaType },
                { source: p.source },
              );
              if (meta) {
                if (!event.attachments) event.attachments = [];
                event.attachments.push(meta);
              }
            }
            delete event._pendingAttachments;
          }
          enqueue(event);
        } catch {
          // skip malformed
        }
      }
    })
    .catch(() => {});
  drainOfflineQueue().catch(() => {});
};

/**
 * Phase 42 sub-E.05: shape of each entry in the native crash JSON's
 * `_pendingAttachments` array. Mirrors what
 * `SentoriCrashHandler.write` writes on iOS and (sub-F) what
 * `SentoriCrashWriter` writes on Android.
 */
type PendingAttachment = {
  base64: string;
  kind: AttachmentKind;
  mediaType: string;
  source: AttachmentSource;
};

// Keep AttachmentMeta in the imports — it's part of the public type
// surface re-exported from this module's bundle.
export type { AttachmentMeta };

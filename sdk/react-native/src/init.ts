import { setConfig } from './config';
import { installGlobalHandler } from './handlers/global';
import { installLifecycleHandler } from './handlers/lifecycle';
import { installPromiseHandler } from './handlers/promise';
import { installNetworkHandler } from './handlers/network';
import { getBundleInfo } from './bundle-info';
import {
  markLaunchCompleted,
  runLaunchCrashGuard,
} from './launch-crash-guard';
import { startMetricsTimer } from './metrics';
import { drainNativePending, markNativeJsBridgeReady, setNativeConfig } from './native';
import { getColdStartMs } from './mobile-vitals';
import { startSpan } from '@goliapkg/sentori-core';
import { startNetworkTypeWatch } from './netinfo';
import { startPreCrashSentinel, type PreCrashChannel } from './pre-crash-sentinel';
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
    network?:
      | boolean
      | {
          /** v0.9.0 #11 — auto-extract GraphQL `operationName` from
           *  POST request bodies and use it as the breadcrumb / span
           *  name (instead of `POST /graphql`). Default `true`. */
          graphql?: boolean;
        };
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
    /** v0.9.1 +S4 — pre-crash sentinel. Subscribes to JS-thread
     *  frame timing; when ≥ 50% of a 60-frame window misses the
     *  budget (default 32 ms / < 30 fps), emits a `kind: nearCrash`
     *  event proactively so dashboards see the "about-to-die"
     *  signal before an actual crash. */
    preCrashSentinel?: boolean;
    sentinelChannels?: PreCrashChannel[];
    /** v0.9.0 #3 — launch-crash loop guard. When two consecutive
     *  launches don't reach `markLaunchCompleted()` (typical of an
     *  OTA update with a fatal bug), invoke the host callback with
     *  a 200 ms timeout to decide rollback / reset / continue. */
    launchCrashGuard?: {
      enabled: boolean;
      onLaunchCrashDetected?: (
        info: import('./launch-crash-guard').LaunchCrashInfo,
      ) =>
        | import('./launch-crash-guard').LaunchCrashAction
        | Promise<import('./launch-crash-guard').LaunchCrashAction>;
      threshold?: number;
      timeoutMs?: number;
    };
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

  // v0.9.0 #3 — launch-crash guard. Fires *before* any other setup so
  // a known-bad bundle can roll back instead of running JS that's
  // about to die again. AsyncStorage-backed; if the host doesn't have
  // it the guard is a no-op.
  const lcg = options.capture?.launchCrashGuard;
  if (lcg?.enabled) {
    void runLaunchCrashGuard(
      lcg,
      options.release,
      getBundleInfo()?.id ?? null,
    );
  }

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
  // v0.9.4 #1 — finalize cold-start measurement. iOS uses the
  // delta from `applicationDidFinishLaunching` to this call;
  // Android uses Process.getStartElapsedRealtime() so the value is
  // computed at this point and cached.
  markNativeJsBridgeReady();
  // Emit a one-off cold-start span. Server aggregates these per
  // release for the Mobile Vitals dashboard. No-op when native
  // module isn't linked.
  const coldMs = getColdStartMs();
  if (coldMs !== null && coldMs > 0 && coldMs < 60_000) {
    const span = startSpan('sentori.cold_start', {
      name: 'cold-start',
      parent: null,
      startNowMs: Date.now() - coldMs,
      tags: { 'vital.kind': 'cold_start' },
    });
    span.finish({ status: 'ok' });
  }

  startTransport();
  // v0.8.0-c — start watching network class. No-op if NetInfo isn't
  // installed; events just won't carry `device.networkType` in that
  // case.
  startNetworkTypeWatch();
  // v0.8.3 — drain custom-metric ring every 30 s.
  startMetricsTimer();
  // v0.9.1 +S4 — pre-crash sentinel. Off by default; opt-in via
  // `capture.preCrashSentinel: true`.
  if (options.capture?.preCrashSentinel === true) {
    startPreCrashSentinel({
      enabled: true,
      channels: options.capture.sentinelChannels,
    });
  }

  const capture = options.capture ?? {};
  if (capture.globalErrors !== false) installGlobalHandler();
  if (capture.promiseRejections !== false) installPromiseHandler();
  if (capture.network !== false) {
    const netOpts = typeof capture.network === 'object' ? capture.network : undefined;
    installNetworkHandler({ graphql: netOpts?.graphql });
  }
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

  // v0.9.0 #3 — init reached the end without throwing. Schedule the
  // "launch completed" marker after one tick so any synchronous user
  // code right after `init()` gets to run first; we want the marker to
  // confirm the JS bridge stayed alive, not just that `init()` returned.
  if (lcg?.enabled) {
    setTimeout(() => {
      void markLaunchCompleted(getBundleInfo()?.id ?? null);
    }, 2_000);
  }
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

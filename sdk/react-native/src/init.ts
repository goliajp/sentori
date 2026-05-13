import { setConfig } from './config';
import { installGlobalHandler } from './handlers/global';
import { installLifecycleHandler } from './handlers/lifecycle';
import { installPromiseHandler } from './handlers/promise';
import { installNetworkHandler } from './handlers/network';
import { drainNativePending, setNativeConfig } from './native';
import { startSession } from './session-tracker';
import { drainOfflineQueue, enqueue, startTransport } from './transport';
import type { Event } from './types';

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
  });

  // Tell the native crash handler about the config so the JSON it writes
  // on the next NSException / Java uncaught carries release + env.
  setNativeConfig({
    token: options.token,
    release: options.release,
    environment: env,
  });

  startTransport();

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
    .then((items) => {
      for (const json of items) {
        try {
          enqueue(JSON.parse(json) as Event);
        } catch {
          // skip malformed
        }
      }
    })
    .catch(() => {});
  drainOfflineQueue().catch(() => {});
};

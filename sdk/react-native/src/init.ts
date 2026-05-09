import { setConfig } from './config';
import { installGlobalHandler } from './handlers/global';
import { installPromiseHandler } from './handlers/promise';
import { installNetworkHandler } from './handlers/network';
import { startTransport, drainOfflineQueue } from './transport';

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

  startTransport();

  const capture = options.capture ?? {};
  if (capture.globalErrors !== false) installGlobalHandler();
  if (capture.promiseRejections !== false) installPromiseHandler();
  if (capture.network !== false) installNetworkHandler();

  // Drain events persisted from previous session (best-effort).
  drainOfflineQueue().catch(() => {});
};

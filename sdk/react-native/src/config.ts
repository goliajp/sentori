import type { LogLevel } from '@goliapkg/sentori-core';

/**
 * Optional structured signal handed to `onReady` after init
 * completes. Host wires the callback if they want to know the SDK
 * is live (alternative to scanning console).
 */
export type ReadyInfo = {
  /** npm version string of @goliapkg/sentori-react-native */
  sdkVersion: string;
  /** Milliseconds between RN cold-start signal and SDK init
   *  completion. May be undefined if native module wasn't bound. */
  coldStartMs?: number;
  /** Native module status. `bound: false` means screenshot /
   *  wireframe / native crash capture won't fire — useful for
   *  host to know if e.g. they forgot to autolink. */
  native: { bound: boolean; methods: string[] };
};

export type Config = {
  token: string;
  release: string;
  environment: string;
  ingestUrl: string;
  enabled: boolean;
  /** Phase 42 sub-D.07: opt-in screenshot capture on captureException. */
  screenshotsEnabled: boolean;
  /** Phase 44 sub-B: per-event-class sampling rates 0..1.
   *  `null` = keep everything (default). */
  errorSampleRate: null | number;
  traceSampleRate: null | number;
  /** v2.0 — sampling rate for `kind: 'message'` events emitted via
   *  `captureMessage`. `null` = keep all (default). */
  messageSampleRate: null | number;
  /** Phase 46: when true, every `captureException` seals the
   *  session-trail buffer and uploads it as a `sessionTrail`
   *  attachment. Defaults to false. */
  sessionTrailEnabled: boolean;
  /** v2.3 — Sentori console output gate.
   *
   *  Default `warn`: SDK is silent on host's console unless
   *  something is genuinely broken (transport sustained failure,
   *  native module not found, internal SDK exception). No
   *  per-tick / per-init / per-breadcrumb noise.
   *
   *  Set `'silent'` for absolute silence (e.g. CI smoke runs);
   *  set `'info'` or `'debug'` when debugging Sentori itself. */
  logLevel?: LogLevel;
  /** v2.3 — fires once after init completes. Use this to know the
   *  SDK is live instead of scanning the console. `info` carries
   *  the native-module bind status + cold-start timing. Host
   *  wraps any host-side logging here. */
  onReady?: (info: ReadyInfo) => void;
};

let _config: Config | null = null;

export const setConfig = (config: Config): void => {
  _config = config;
};

export const getConfig = (): Config | null => _config;

export const isInitialized = (): boolean => _config !== null;

export const __resetForTests = (): void => {
  _config = null;
};

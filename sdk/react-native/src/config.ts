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
  /** Phase 46: when true, every `captureException` seals the
   *  session-trail buffer and uploads it as a `sessionTrail`
   *  attachment. Defaults to false. */
  sessionTrailEnabled: boolean;
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

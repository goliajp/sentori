export type Config = {
  token: string;
  release: string;
  environment: string;
  ingestUrl: string;
  enabled: boolean;
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

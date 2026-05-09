export type Platform = 'javascript' | 'ios' | 'android';
export type DeviceOS = 'ios' | 'android' | 'web' | 'other';
export type EventKind = 'error';
export type BreadcrumbType = 'nav' | 'net' | 'log' | 'user' | 'custom';

export type Event = {
  id: string;
  timestamp: string;
  kind: EventKind;
  platform: Platform;
  release: string;
  environment: string;
  device: Device;
  app: App;
  user?: User | null;
  tags?: Tags;
  breadcrumbs?: Breadcrumb[];
  error: SentoriError;
  fingerprint?: string[];
  traceId?: string | null;
  spanId?: string | null;
};

export type Device = {
  os: DeviceOS;
  osVersion: string;
  model?: string;
  locale?: string;
};

export type App = {
  version: string;
  build?: string;
  framework?: { name: string; version: string };
};

export type User = { id?: string; anonymous?: boolean };

export type Tags = Record<string, string>;

export type SentoriError = {
  type: string;
  message: string;
  stack: Frame[];
  cause?: SentoriError | null;
};

export type Frame = {
  function?: string;
  file: string;
  line: number;
  column?: number;
  inApp: boolean;
  absolutePath?: string;
  preContext?: string[];
  postContext?: string[];
};

export type Breadcrumb = {
  timestamp: string;
  type: BreadcrumbType;
  data: Record<string, unknown>;
};

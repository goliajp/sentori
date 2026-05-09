import type { Breadcrumb, BreadcrumbType } from './types';

const MAX_BREADCRUMBS = 100;

let _buffer: Breadcrumb[] = [];

export type AddBreadcrumbInput = {
  type: BreadcrumbType;
  data: Record<string, unknown>;
  timestamp?: string;
};

export const addBreadcrumb = (input: AddBreadcrumbInput): void => {
  const crumb: Breadcrumb = {
    timestamp: input.timestamp ?? new Date().toISOString(),
    type: input.type,
    data: input.data,
  };
  _buffer.push(crumb);
  if (_buffer.length > MAX_BREADCRUMBS) {
    _buffer.shift();
  }
};

export const getBreadcrumbs = (): Breadcrumb[] => [..._buffer];

export const clearBreadcrumbs = (): void => {
  _buffer = [];
};

export const __resetForTests = (): void => {
  _buffer = [];
};

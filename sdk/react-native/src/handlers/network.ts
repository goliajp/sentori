import { addBreadcrumb } from '../breadcrumbs';

let _installed = false;

const AUTH_PARAMS = ['token', 'key', 'password', 'secret', 'access_token'];

export const installNetworkHandler = (): void => {
  if (_installed) return;
  if (typeof globalThis.fetch !== 'function') return;
  _installed = true;

  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const start = Date.now();
    const url = extractUrl(input);
    const method = (init?.method ??
      (typeof input !== 'string' && 'method' in (input as Request)
        ? (input as Request).method
        : 'GET')) as string;

    try {
      const resp = await original(input, init);
      addBreadcrumb({
        type: 'net',
        data: {
          method,
          url: scrubUrl(url),
          status: resp.status,
          durationMs: Date.now() - start,
        },
      });
      return resp;
    } catch (e) {
      addBreadcrumb({
        type: 'net',
        data: {
          method,
          url: scrubUrl(url),
          status: 0,
          durationMs: Date.now() - start,
          error: String(e),
        },
      });
      throw e;
    }
  }) as typeof fetch;
};

const extractUrl = (input: RequestInfo | URL): string => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
};

const scrubUrl = (url: string): string => {
  try {
    const u = new URL(url);
    let modified = false;
    for (const p of AUTH_PARAMS) {
      if (u.searchParams.has(p)) {
        u.searchParams.set(p, '[redacted]');
        modified = true;
      }
    }
    return modified ? u.toString() : url;
  } catch {
    return url;
  }
};

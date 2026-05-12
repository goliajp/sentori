import { startSpan } from '@goliapkg/sentori-core';

import { addBreadcrumb } from '../breadcrumbs';

let _installed = false;

const AUTH_PARAMS = ['token', 'key', 'password', 'secret', 'access_token'];

export const installNetworkHandler = (): void => {
  if (_installed) return;
  _installed = true;
  patchFetch();
  patchXhr();
};

// ── fetch ──────────────────────────────────────────────────────────

function patchFetch(): void {
  if (typeof globalThis.fetch !== 'function') return;
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const start = Date.now();
    const url = extractUrl(input);
    const scrubbed = scrubUrl(url);
    const method = (init?.method ??
      (typeof input !== 'string' && 'method' in (input as Request)
        ? (input as Request).method
        : 'GET')) as string;

    // Phase 35 sub-C: also open an http.client span so the request
    // shows up in the trace waterfall. Breadcrumbs stay — they're
    // attached to error events at capture time and serve a different
    // surface (the "last 100 things" timeline on the issue page).
    const span = startSpan('http.client', {
      name: `${method.toUpperCase()} ${scrubbed}`,
      tags: { 'http.method': method.toUpperCase(), 'http.url': scrubbed },
    });

    // Inject traceparent header on outbound requests.
    const reqInit: RequestInit = { ...(init ?? {}) };
    const headers = mergeHeaders(input, init);
    headers.set('traceparent', toTraceparent(span.traceId, span.spanId));
    reqInit.headers = headers;

    try {
      const resp = await original(input, reqInit);
      span.setTag('http.status', String(resp.status));
      span.finish({ status: resp.status >= 400 ? 'error' : 'ok' });
      addBreadcrumb({
        type: 'net',
        data: {
          method,
          url: scrubbed,
          status: resp.status,
          durationMs: Date.now() - start,
        },
      });
      return resp;
    } catch (e) {
      const isAbort = isAbortError(e);
      if (e instanceof Error) span.setTag('error.message', e.message);
      span.finish({ status: isAbort ? 'cancelled' : 'error' });
      addBreadcrumb({
        type: 'net',
        data: {
          method,
          url: scrubbed,
          status: 0,
          durationMs: Date.now() - start,
          error: String(e),
        },
      });
      throw e;
    }
  }) as typeof fetch;
}

// ── XMLHttpRequest ─────────────────────────────────────────────────
//
// React Native's XHR is a native polyfill, not built on fetch — so
// patching `globalThis.fetch` alone misses every axios / older-style
// request. axios on RN uses its `xhr` adapter by default. We patch
// the prototype's `open` + `send` so the instance carries the span
// from `send()` to `loadend`.

type TracedXhr = XMLHttpRequest & {
  __sentoriMethod?: string;
  __sentoriUrl?: string;
  __sentoriSpan?: ReturnType<typeof startSpan>;
  __sentoriStart?: number;
};

function patchXhr(): void {
  const XHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest;
  if (typeof XHR !== 'function') return;
  const proto = XHR.prototype as XMLHttpRequest & {
    __sentoriPatched?: boolean;
  };
  if (proto.__sentoriPatched) return;
  proto.__sentoriPatched = true;

  const originalOpen = proto.open;
  const originalSend = proto.send;
  const originalSetHeader = proto.setRequestHeader;

  proto.open = function (
    this: TracedXhr,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    this.__sentoriMethod = String(method).toUpperCase();
    this.__sentoriUrl = typeof url === 'string' ? url : String(url);
    // @ts-expect-error variadic forwarding to the native signature
    return originalOpen.call(this, method, url, ...rest);
  };

  proto.send = function (this: TracedXhr, body?: Document | XMLHttpRequestBodyInit | null): void {
    const method = this.__sentoriMethod ?? 'GET';
    const url = scrubUrl(this.__sentoriUrl ?? '');
    const span = startSpan('http.client', {
      name: `${method} ${url}`,
      tags: { 'http.method': method, 'http.url': url },
    });
    this.__sentoriSpan = span;
    this.__sentoriStart = Date.now();

    // setRequestHeader must be called between open() and send(); we're
    // inside send() before the underlying call, so this is legal.
    try {
      originalSetHeader.call(this, 'traceparent', toTraceparent(span.traceId, span.spanId));
    } catch {
      // Some XHR polyfills are strict about header timing; if it
      // rejects, drop the header rather than fail the request.
    }

    const finish = () => {
      const s = this.__sentoriSpan;
      if (!s) return;
      this.__sentoriSpan = undefined;
      const status = this.status;
      s.setTag('http.status', String(status));
      // status 0 means network error / aborted / CORS block — treat
      // as error. The `abort` event handler below downgrades aborts.
      s.finish({ status: status === 0 || status >= 400 ? 'error' : 'ok' });
      addBreadcrumb({
        type: 'net',
        data: {
          method,
          url,
          status,
          durationMs: Date.now() - (this.__sentoriStart ?? Date.now()),
        },
      });
    };

    this.addEventListener('loadend', finish);
    this.addEventListener('abort', () => {
      const s = this.__sentoriSpan;
      if (!s) return;
      this.__sentoriSpan = undefined;
      s.finish({ status: 'cancelled' });
      addBreadcrumb({
        type: 'net',
        data: { method, url, status: 0, durationMs: Date.now() - (this.__sentoriStart ?? Date.now()), error: 'aborted' },
      });
    });

    return originalSend.call(this, body);
  };
}

function mergeHeaders(input: RequestInfo | URL, init?: RequestInit): Headers {
  const out = new Headers();
  if (typeof input !== 'string' && !(input instanceof URL)) {
    (input as Request).headers.forEach((v, k) => out.set(k, v));
  }
  if (init?.headers) {
    new Headers(init.headers).forEach((v, k) => out.set(k, v));
  }
  return out;
}

function toTraceparent(traceId: string, spanId: string): string {
  const trace = traceId.replace(/-/g, '').toLowerCase();
  const parent = spanId.replace(/-/g, '').toLowerCase().slice(0, 16);
  return `00-${trace}-${parent}-01`;
}

function isAbortError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  return (err as { name?: unknown }).name === 'AbortError';
}

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

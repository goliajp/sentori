// Event transport — the only place the SDK talks to the network.
//
// Quiet by default, complete when it matters (design.md §4): events
// batch on a 5 s timer or a 10-deep queue, whichever first; assert
// pass-counts piggyback on whatever batch goes out next (never their
// own request); failures back off and finally persist to an offline
// queue drained on next launch. Nothing here ever throws into the
// host app.

import type { AssertStat, BatchEnvelope, WireEvent } from '@goliapkg/sentori-core';
import { logger } from '@goliapkg/sentori-core';

import { getConfig } from './config';
import { isAnyNativeModuleLinked } from './native-loader';

const FLUSH_INTERVAL_MS = 5_000;
const BATCH_SIZE = 10;
const MAX_RETRY = 3;
const STORAGE_KEY = '@sentori/pending';
const MAX_PERSISTED = 1000;

const SDK_VERSION = '5.0.0';

let _queue: WireEvent[] = [];
let _assertStats = new Map<string, AssertStat>();
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _started = false;

export const enqueue = (event: WireEvent): void => {
  _queue.push(event);
  if (_queue.length >= BATCH_SIZE) {
    void flush();
  } else if (!_flushTimer) {
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      void flush();
    }, FLUSH_INTERVAL_MS);
  }
};

/**
 * Count an assert outcome. Pass-counts NEVER become events — they
 * aggregate here and ride the next batch envelope (the liveness
 * ledger without a heartbeat flood).
 */
export const countAssert = (name: string, ok: boolean, release: string): void => {
  const key = `${name}${release}`;
  const cur = _assertStats.get(key) ?? { name, release, passDelta: 0, failDelta: 0 };
  if (ok) cur.passDelta += 1;
  else cur.failDelta = (cur.failDelta ?? 0) + 1;
  _assertStats.set(key, cur);
  // Stats with no event traffic still ship eventually, on a lazy
  // timer six times the batch interval.
  if (!_flushTimer && _queue.length === 0) {
    _flushTimer = setTimeout(() => {
      _flushTimer = null;
      void flush();
    }, FLUSH_INTERVAL_MS * 6);
  }
};

export const startTransport = (): void => {
  _started = true;
};

export const flush = async (): Promise<void> => {
  if (!_started) return;
  const config = getConfig();
  if (!config) return;

  const events = _queue.splice(0, _queue.length);
  const stats = [..._assertStats.values()];
  _assertStats = new Map();
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }
  if (events.length === 0 && stats.length === 0) return;

  const envelope: BatchEnvelope = { events };
  if (stats.length > 0) envelope.assertStats = stats;

  try {
    await sendWithRetry(envelope, config.ingestUrl, config.token);
  } catch {
    // Events survive offline; assert deltas are cheap enough to lose.
    await persist(events);
  }
};

const sendWithRetry = async (
  envelope: BatchEnvelope,
  ingestUrl: string,
  token: string,
): Promise<void> => {
  let attempt = 0;
  let delayMs = 1000;
  while (true) {
    try {
      await sendOnce(envelope, ingestUrl, token);
      return;
    } catch (e) {
      attempt++;
      if (attempt >= MAX_RETRY) throw e;
      await sleep(delayMs);
      delayMs *= 2;
    }
  }
};

const sendOnce = async (
  envelope: BatchEnvelope,
  ingestUrl: string,
  token: string,
): Promise<void> => {
  const resp = await fetch(`${ingestUrl}/v1/events:batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Sentori-Sdk': `react-native/${SDK_VERSION}`,
    },
    body: JSON.stringify(envelope),
  });

  if (resp.status === 429) {
    let retryAfterMs = 5000;
    try {
      const j = (await resp.json()) as { retryAfterMs?: number };
      if (typeof j.retryAfterMs === 'number') retryAfterMs = j.retryAfterMs;
    } catch {
      // ignore body parse error
    }
    await sleep(retryAfterMs);
    throw new Error('rate-limited');
  }

  if (resp.status >= 500) {
    throw new Error(`server-${resp.status}`);
  }
  // 4xx other than 429 = client error; per-item outcomes are the
  // server's business — drop silently rather than crashloop.
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const getAsyncStorage = async (): Promise<AsyncStorageLike | null> => {
  // Host may have the JS package without pod install / prebuild →
  // getItem would crash from a microtask outside our reach.
  if (!isAnyNativeModuleLinked(['RNCAsyncStorage', 'AsyncStorageModule'])) {
    return null;
  }
  try {
    // Resolve via the host's runtime `require` rather than `import()`
    // — the peer dep is optional and absent in monorepo CI.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage') as {
      default?: AsyncStorageLike;
    } & AsyncStorageLike;
    return mod.default ?? mod;
  } catch {
    return null;
  }
};

const persist = async (events: WireEvent[]): Promise<void> => {
  if (events.length === 0) return;
  const AsyncStorage = await getAsyncStorage();
  if (!AsyncStorage) return;
  try {
    const existing = await AsyncStorage.getItem(STORAGE_KEY);
    const prev: WireEvent[] = existing ? JSON.parse(existing) : [];
    const merged = [...prev, ...events].slice(-MAX_PERSISTED);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // best-effort
  }
};

export const drainOfflineQueue = async (): Promise<void> => {
  const AsyncStorage = await getAsyncStorage();
  if (!AsyncStorage) return;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    await AsyncStorage.removeItem(STORAGE_KEY);
    const events: WireEvent[] = JSON.parse(raw);
    for (const e of events) _queue.push(e);
    await flush();
  } catch {
    // best-effort
  }
};

/**
 * Upload one attachment for an already-enqueued event. Returns null
 * on any non-fatal failure — the event still ships without the
 * attachment so the crash itself is never lost.
 */
export const uploadAttachment = async (
  eventId: string,
  kind: import('@goliapkg/sentori-core').AttachmentKind,
  blob: { base64: string; mediaType: string },
  opts: { source?: 'android' | 'ios' | 'js' } = {},
): Promise<{ ref: string } | null> => {
  const config = getConfig();
  if (!config) return null;
  const url = `${config.ingestUrl}/v1/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(kind)}`;

  const form = new FormData();
  form.append('file', {
    name: `${kind}.bin`,
    type: blob.mediaType,
    uri: `data:${blob.mediaType};base64,${blob.base64}`,
  } as unknown as Blob);
  form.append('source', opts.source ?? 'js');

  try {
    const resp = await fetch(url, {
      body: form,
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Sentori-Sdk': `react-native/${SDK_VERSION}`,
      },
      method: 'POST',
    });
    if (resp.status < 200 || resp.status >= 300) {
      logger.warn(`attachment ${kind} upload http_${resp.status}`);
      return null;
    }
    const body = (await resp.json()) as { refId?: string };
    return body.refId ? { ref: body.refId } : null;
  } catch (e) {
    logger.warn(`attachment ${kind} upload failed: ${String(e)}`);
    return null;
  }
};

export const __resetForTests = (): void => {
  _queue = [];
  _assertStats = new Map();
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = null;
  _started = false;
};

export const __peekQueue = (): readonly WireEvent[] => _queue;
export const __peekAssertStats = (): readonly AssertStat[] => [..._assertStats.values()];

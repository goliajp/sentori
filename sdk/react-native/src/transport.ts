import { getConfig } from './config';
import type { Event } from './types';

const FLUSH_INTERVAL_MS = 5_000;
const BATCH_SIZE = 10;
const MAX_RETRY = 3;
const STORAGE_KEY = '@sentori/pending';
const MAX_PERSISTED = 1000;

let _queue: Event[] = [];
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
let _started = false;

const SDK_VERSION = '0.0.0';

export const enqueue = (event: Event): void => {
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

export const startTransport = (): void => {
  _started = true;
};

export const flush = async (): Promise<void> => {
  if (!_started) return;
  if (_queue.length === 0) return;

  const config = getConfig();
  if (!config) return;

  const batch = _queue.splice(0, _queue.length);
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushTimer = null;
  }

  try {
    await sendWithRetry(batch, config.ingestUrl, config.token);
  } catch {
    await persist(batch);
  }
};

const sendWithRetry = async (
  events: Event[],
  ingestUrl: string,
  token: string,
): Promise<void> => {
  let attempt = 0;
  let delayMs = 1000;
  while (true) {
    try {
      await sendOnce(events, ingestUrl, token);
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
  events: Event[],
  ingestUrl: string,
  token: string,
): Promise<void> => {
  const url =
    events.length === 1 ? `${ingestUrl}/v1/events` : `${ingestUrl}/v1/events:batch`;
  const body = events.length === 1 ? events[0] : { events };

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Sentori-Sdk': `react-native/${SDK_VERSION}`,
    },
    body: JSON.stringify(body),
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
  // 4xx other than 429 = client error, drop silently
};

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

type AsyncStorageLike = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

const getAsyncStorage = async (): Promise<AsyncStorageLike | null> => {
  try {
    const mod = (await import(
      '@react-native-async-storage/async-storage'
    )) as { default: AsyncStorageLike };
    return mod.default;
  } catch {
    return null;
  }
};

const persist = async (events: Event[]): Promise<void> => {
  const AsyncStorage = await getAsyncStorage();
  if (!AsyncStorage) return;
  try {
    const existing = await AsyncStorage.getItem(STORAGE_KEY);
    const prev: Event[] = existing ? JSON.parse(existing) : [];
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
    const events: Event[] = JSON.parse(raw);
    for (const e of events) _queue.push(e);
    await flush();
  } catch {
    // best-effort
  }
};

export const __resetForTests = (): void => {
  _queue = [];
  if (_flushTimer) clearTimeout(_flushTimer);
  _flushTimer = null;
  _started = false;
};

export const __peekQueue = (): readonly Event[] => _queue;

/**
 * Phase 26 sub-B: session ping transport. Best-effort; we don't queue
 * pings the way we queue events because they fire on background and
 * AsyncStorage writes during background can be killed by the OS. If
 * the network's down, the ping is lost — the session counters tolerate
 * this.
 */
export const sendSessionPing = async (
  ingestUrl: string,
  token: string,
  ping: unknown
): Promise<void> => {
  try {
    await fetch(`${ingestUrl}/v1/sessions`, {
      body: JSON.stringify(ping),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Sentori-Sdk': `react-native/${SDK_VERSION}`,
      },
      method: 'POST',
    });
  } catch {
    // best-effort
  }
};

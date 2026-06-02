import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

import { createPersister, queryShouldPersist, STORAGE_KEY } from './query-persistence'
import { qk } from '@/api/query-keys'

// In-memory localStorage shim so the test environment (jsdom) and
// CI both behave the same.
class MemoryStorage implements Storage {
  private map = new Map<string, string>()
  get length() {
    return this.map.size
  }
  clear() {
    this.map.clear()
  }
  getItem(k: string) {
    return this.map.get(k) ?? null
  }
  key(i: number) {
    return Array.from(this.map.keys())[i] ?? null
  }
  removeItem(k: string) {
    this.map.delete(k)
  }
  setItem(k: string, v: string) {
    this.map.set(k, v)
  }
}

let storage: MemoryStorage

beforeEach(() => {
  storage = new MemoryStorage()
})

afterEach(() => {
  storage.clear()
})

describe('queryShouldPersist', () => {
  it('returns false when meta is missing', () => {
    expect(queryShouldPersist({ meta: undefined } as never)).toBe(false)
  })
  it('returns false when meta.persist is not true', () => {
    expect(queryShouldPersist({ meta: { persist: false } } as never)).toBe(false)
    expect(queryShouldPersist({ meta: { other: 'thing' } } as never)).toBe(false)
  })
  it('returns true when meta.persist === true', () => {
    expect(queryShouldPersist({ meta: { persist: true } } as never)).toBe(true)
  })
})

describe('createPersister round-trip', () => {
  it('writes persist:true queries and reads them back', async () => {
    const qc1 = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })
    // Seed with a query that opts into persistence.
    qc1.setQueryData(qk.liveDetail('project-1'), { concurrent: 7 })
    qc1
      .getQueryCache()
      .find({ queryKey: qk.liveDetail('project-1') })!
      .setOptions({ meta: { persist: true } })

    // Seed with a non-persist query.
    qc1.setQueryData(qk.issue.list('project-1'), [{ id: 'foo' }])

    const persister = createPersister(storage)
    await persister.persistClient({
      buster: 'v1',
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: qc1
          .getQueryCache()
          .getAll()
          .map((q) => ({
            queryHash: q.queryHash,
            queryKey: q.queryKey,
            state: q.state,
            meta: q.meta,
          })) as never,
      },
    })

    const raw = storage.getItem(STORAGE_KEY)
    expect(raw, 'expected storage to contain serialised cache').toBeTruthy()
    const parsed = JSON.parse(raw!) as {
      clientState: { queries: { queryKey: unknown[] }[] }
    }
    // Only the persist:true entry should survive.
    expect(parsed.clientState.queries.length).toBe(1)
    expect(parsed.clientState.queries[0]?.queryKey).toEqual(qk.liveDetail('project-1'))

    // Read back into a fresh client.
    const restored = await persister.restoreClient()
    expect(restored?.clientState.queries.length).toBe(1)
  })

  it('evicts to fit the size cap', async () => {
    const persister = createPersister(storage, { maxBytes: 200 })
    const huge = 'x'.repeat(400)
    await persister.persistClient({
      buster: 'v1',
      timestamp: Date.now(),
      clientState: {
        mutations: [],
        queries: [
          {
            queryHash: 'a',
            queryKey: ['big'],
            state: {
              data: huge,
              dataUpdateCount: 1,
              dataUpdatedAt: Date.now(),
              error: null,
              errorUpdateCount: 0,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle',
            },
            meta: { persist: true },
          } as never,
        ],
      },
    })

    // Bigger than maxBytes → the persister should refuse to write (or
    // drop oldest until under cap). For the v1 shape we refuse and
    // leave storage empty rather than truncating mid-cache.
    expect(storage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('survives malformed stored payload by returning undefined', async () => {
    storage.setItem(STORAGE_KEY, '{ not valid')
    const persister = createPersister(storage)
    const restored = await persister.restoreClient()
    expect(restored).toBeUndefined()
  })
})

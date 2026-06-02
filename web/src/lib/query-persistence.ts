// F3 — opt-in react-query L2 cache persistence.
//
// Per architecture-standards.md §2: we want SWR rehydration so the
// dashboard's first paint comes from L2 within 20 ms before the
// server even responds. The trade-off is that we DON'T persist
// everything — only queries that explicitly opt in via
// `meta: { persist: true }`. This avoids accidentally persisting
// PII-heavy responses (event detail bodies, breadcrumbs) while
// letting low-risk aggregates (live count, audience metrics)
// rehydrate instantly.
//
// Storage layout under STORAGE_KEY:
//   {
//     buster: "<schema-version>",
//     timestamp: <ms>,
//     clientState: { queries: [...], mutations: [] }
//   }
//
// Mutations never persist — they're side-effecting and replaying
// them on hydrate would re-send state-change requests.

import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client'
import type { Query } from '@tanstack/react-query'

export const STORAGE_KEY = 'sentori:cache:v1'

/** Size cap matching the standards-doc 5 MB / origin guideline. */
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

/** Inspect a query's `meta.persist` flag. Default off — a query has
 *  to opt in explicitly to be persisted. */
export function queryShouldPersist(q: Pick<Query, 'meta'>): boolean {
  const m = q.meta as { persist?: unknown } | undefined
  return m?.persist === true
}

export type PersisterOptions = {
  maxBytes?: number
}

/** Build a persister that reads/writes through the provided Storage
 *  (typically `window.localStorage`). Filters the persisted state to
 *  only include queries with `meta.persist === true`, applies the
 *  max-bytes cap, and gracefully falls back when storage is missing
 *  / quota-exceeded / payload corrupted. */
export function createPersister(storage: Storage, opts: PersisterOptions = {}): Persister {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

  return {
    async persistClient(client: PersistedClient) {
      const filtered: PersistedClient = {
        ...client,
        clientState: {
          ...client.clientState,
          mutations: [], // never persist mutations
          queries: client.clientState.queries.filter((q) =>
            queryShouldPersist(q as unknown as Pick<Query, 'meta'>)
          ),
        },
      }
      let serialised: string
      try {
        serialised = JSON.stringify(filtered)
      } catch {
        return
      }
      if (serialised.length > maxBytes) {
        // Refuse to truncate — partial cache would silently mislead
        // observers. Drop the persist attempt, instrument for later
        // sweep when F4 self-tracing lands.
        return
      }
      try {
        storage.setItem(STORAGE_KEY, serialised)
      } catch {
        // QuotaExceededError, private-mode storage, etc. Silent — L1
        // still works.
      }
    },
    async restoreClient(): Promise<PersistedClient | undefined> {
      let raw: null | string
      try {
        raw = storage.getItem(STORAGE_KEY)
      } catch {
        return undefined
      }
      if (!raw) return undefined
      try {
        return JSON.parse(raw) as PersistedClient
      } catch {
        // Malformed payload — drop on the floor so a corrupted L2
        // doesn't poison a fresh load.
        try {
          storage.removeItem(STORAGE_KEY)
        } catch {
          // ignore
        }
        return undefined
      }
    },
    async removeClient() {
      try {
        storage.removeItem(STORAGE_KEY)
      } catch {
        // ignore
      }
    },
  }
}

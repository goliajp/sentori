import { beforeEach, describe, expect, it } from 'vitest'

import { densityClasses } from './density'

// Same jsdom localStorage quirk as column-prefs.spec — install a real
// in-memory store for the load/save round-trip.
const _store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    clear() {
      _store.clear()
    },
    getItem(k: string) {
      return _store.has(k) ? _store.get(k)! : null
    },
    removeItem(k: string) {
      _store.delete(k)
    },
    setItem(k: string, v: string) {
      _store.set(k, String(v))
    },
  },
})

describe('density', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns distinct row/cell classes per density', () => {
    expect(densityClasses('compact').rowClass).not.toEqual(densityClasses('cozy').rowClass)
    expect(densityClasses('compact').cellPaddingY).not.toEqual(densityClasses('cozy').cellPaddingY)
  })

  it('compact rows use the smaller height token', () => {
    expect(densityClasses('compact').rowClass).toContain('h-7')
    expect(densityClasses('cozy').rowClass).toContain('h-10')
  })
})

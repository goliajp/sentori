import { beforeEach, describe, expect, it } from 'vitest'

import { type ColumnDef, loadPrefs, resolveVisible, savePrefs } from './column-prefs'

// jsdom in vitest 4 ships a stub `localStorage` object without methods.
// Real apps run in a browser, but the parser tests need a working
// in-memory store — install one here.
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

const DEFS: readonly ColumnDef<'a' | 'b' | 'c'>[] = [
  { defaultVisible: true, id: 'a', label: 'A' },
  { defaultVisible: true, id: 'b', label: 'B' },
  { defaultVisible: false, id: 'c', label: 'C' },
]

const KEY = 'test:cols'

describe('column-prefs', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('returns defaults when no prefs stored', () => {
    const v = resolveVisible(DEFS, loadPrefs(KEY))
    expect([...v].sort()).toEqual(['a', 'b'])
  })

  it('user prefs override defaults', () => {
    savePrefs(KEY, { a: false, c: true })
    const v = resolveVisible(DEFS, loadPrefs(KEY))
    expect([...v].sort()).toEqual(['b', 'c'])
  })

  it('new column added to defs uses its own default, not stored snapshot', () => {
    // User saved prefs only mention 'a' and 'b'; later 'c' is added.
    savePrefs(KEY, { a: true, b: false })
    // 'c' is not in stored prefs but defaultVisible: false, so absent.
    expect([...resolveVisible(DEFS, loadPrefs(KEY))].sort()).toEqual(['a'])

    const withDefaultC: readonly ColumnDef<'a' | 'b' | 'c'>[] = [
      { defaultVisible: true, id: 'a', label: 'A' },
      { defaultVisible: true, id: 'b', label: 'B' },
      { defaultVisible: true, id: 'c', label: 'C' }, // newly added, default-on
    ]
    expect([...resolveVisible(withDefaultC, loadPrefs(KEY))].sort()).toEqual(['a', 'c'])
  })

  it('ignores corrupted localStorage payloads', () => {
    localStorage.setItem(KEY, '{"a": "yes"}') // wrong type
    const v = resolveVisible(DEFS, loadPrefs(KEY))
    // Falls through to defaults.
    expect([...v].sort()).toEqual(['a', 'b'])

    localStorage.setItem(KEY, 'not-json')
    expect([...resolveVisible(DEFS, loadPrefs(KEY))].sort()).toEqual(['a', 'b'])

    localStorage.setItem(KEY, '["a","b"]') // array, not object
    expect([...resolveVisible(DEFS, loadPrefs(KEY))].sort()).toEqual(['a', 'b'])
  })

  it('round-trips via savePrefs / loadPrefs', () => {
    savePrefs(KEY, { a: false, b: true, c: false })
    expect(loadPrefs(KEY)).toEqual({ a: false, b: true, c: false })
  })
})

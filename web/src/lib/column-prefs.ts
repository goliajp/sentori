/**
 * Phase 24 sub-B: persisted per-table column visibility.
 *
 * Each table that wants user-toggleable columns declares a
 * `ColumnDef[]`, then calls `useColumnPrefs(storageKey, defs)`. The
 * hook returns:
 *
 *   - `visible`: a Set<id> of currently-shown columns
 *   - `toggle(id)`: flip one column
 *   - `reset()`: drop the user's choices, fall back to defaults
 *
 * Persistence shape (localStorage): `{ "errorType": true, "env": false }`
 * — explicit per-id booleans so adding a new column to the def list
 * later defaults its visibility from the def, not from the user's
 * stored snapshot. (Earlier draft used a `string[]` of visible ids;
 * that meant new columns defaulted to *hidden* for existing users,
 * which is the wrong polarity.)
 *
 * Storage failures (private mode, full quota) are swallowed silently
 * — column prefs are convenience, not data.
 */

import { useCallback, useState } from 'react'

export type ColumnDef<Id extends string = string> = {
  defaultVisible: boolean
  id: Id
  label: string
}

export type ColumnPrefs = Record<string, boolean>

export function loadPrefs(storageKey: string): ColumnPrefs {
  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: ColumnPrefs = {}
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'boolean') out[k] = v
      }
      return out
    }
  } catch {
    // Ignore: bad JSON, no localStorage, etc.
  }
  return {}
}

export function savePrefs(storageKey: string, prefs: ColumnPrefs): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(prefs))
  } catch {
    // Ignore quota / unavailable.
  }
}

export function resolveVisible<Id extends string>(
  defs: readonly ColumnDef<Id>[],
  prefs: ColumnPrefs
): Set<Id> {
  const out = new Set<Id>()
  for (const d of defs) {
    const stored = prefs[d.id]
    if (stored === undefined ? d.defaultVisible : stored) out.add(d.id)
  }
  return out
}

export function useColumnPrefs<Id extends string>(
  storageKey: string,
  defs: readonly ColumnDef<Id>[]
) {
  const [prefs, setPrefs] = useState<ColumnPrefs>(() => loadPrefs(storageKey))
  const visible = resolveVisible(defs, prefs)

  const toggle = useCallback(
    (id: Id) => {
      setPrefs((prev) => {
        const def = defs.find((d) => d.id === id)
        const current = prev[id] ?? def?.defaultVisible ?? true
        const next: ColumnPrefs = { ...prev, [id]: !current }
        savePrefs(storageKey, next)
        return next
      })
    },
    [defs, storageKey]
  )

  const reset = useCallback(() => {
    setPrefs({})
    savePrefs(storageKey, {})
  }, [storageKey])

  return { reset, toggle, visible }
}

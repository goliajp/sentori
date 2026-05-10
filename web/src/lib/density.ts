/**
 * Phase 24 sub-E: global density preference (compact / cozy).
 *
 * Tables consume `useDensity()` and pick row heights / cell padding /
 * cell text size from the returned token map. Storing the *tokens*
 * (not Tailwind class strings) keeps the data shape readable and lets
 * each table pick which slots it cares about.
 *
 * Persistence: localStorage `sentori:ui:density:v1`. Failure-tolerant
 * — if the browser refuses we fall back to the in-memory state.
 *
 * The provider lives near the app root so the header toggle and every
 * table read the same value. We don't put density on the React Query
 * cache or in URL — it's a personal preference, not navigation state.
 */

import {
  createContext,
  createElement,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from 'react'

export type Density = 'compact' | 'cozy'

const STORAGE_KEY = 'sentori:ui:density:v1'

type DensityContextValue = {
  density: Density
  set: (d: Density) => void
  toggle: () => void
}

const DensityContext = createContext<DensityContextValue | null>(null)

function load(): Density {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'compact' || raw === 'cozy') return raw
  } catch {
    // Ignore.
  }
  return 'cozy'
}

function save(d: Density): void {
  try {
    localStorage.setItem(STORAGE_KEY, d)
  } catch {
    // Ignore.
  }
}

export function DensityProvider({ children }: { children: ReactNode }) {
  const [density, setDensityState] = useState<Density>(() => load())
  const set = useCallback((d: Density) => {
    setDensityState(d)
    save(d)
  }, [])
  const toggle = useCallback(() => {
    setDensityState((prev) => {
      const next = prev === 'compact' ? 'cozy' : 'compact'
      save(next)
      return next
    })
  }, [])
  return createElement(DensityContext.Provider, { value: { density, set, toggle } }, children)
}

export function useDensity(): DensityContextValue {
  const ctx = useContext(DensityContext)
  if (!ctx) throw new Error('useDensity outside DensityProvider')
  return ctx
}

/**
 * Common Tailwind class slots tables can pull from.
 *
 * `tr.row` is the per-row class used on `<tr>` (height + base text size
 * + a forced `border-b` so density never strips dividers). `td.cell`
 * goes on `<td>` to apply the right vertical padding without touching
 * `px-*` (we leave horizontal padding to the table — different tables
 * use different gutters).
 */
export const DENSITY_CLASSES: Record<Density, { rowClass: string; cellPaddingY: string }> = {
  compact: {
    cellPaddingY: 'py-0.5',
    rowClass: 'h-7 text-[12px]',
  },
  cozy: {
    cellPaddingY: 'py-1.5',
    rowClass: 'h-10 text-[13px]',
  },
}

export function densityClasses(d: Density) {
  return DENSITY_CLASSES[d]
}

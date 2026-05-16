import { atom, getDefaultStore } from 'jotai'
import { atomWithStorage } from 'jotai/utils'

export type ThemeMode = 'dark' | 'light' | 'system'

export const themeModeAtom = atomWithStorage<ThemeMode>('sentori.theme', 'system')

const resolvedThemeAtom = atom((get) => {
  const mode = get(themeModeAtom)
  if (mode !== 'system') return mode
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
})

export const themeStore = getDefaultStore()

export function applyTheme(): void {
  const resolved = themeStore.get(resolvedThemeAtom)
  document.documentElement.dataset.theme = resolved
}

/**
 * Wire the theme system at module load: apply once, subscribe so
 * every atom change repaints `data-theme`, plus an OS-level
 * `prefers-color-scheme` listener that only fires when the user is in
 * `system` mode.
 *
 * Lives at module scope (not in a React effect) because the previous
 * `useThemeEffect` was defined but never called — the toggle changed
 * the atom but no subscription re-applied, so the html element's
 * `data-theme` was stuck at first-paint state. Module-scope wiring
 * removes the "did anyone mount the effect" footgun entirely.
 */
let _themeWired = false
export function installThemeWiring(): void {
  if (_themeWired) return
  _themeWired = true
  applyTheme()
  themeStore.sub(resolvedThemeAtom, applyTheme)
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', () => {
      if (themeStore.get(themeModeAtom) === 'system') applyTheme()
    })
  }
}

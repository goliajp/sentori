import { atom, getDefaultStore } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { useEffect } from 'react'

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

export function useThemeEffect(): void {
  useEffect(() => {
    applyTheme()
    const unsub = themeStore.sub(resolvedThemeAtom, applyTheme)
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (themeStore.get(themeModeAtom) === 'system') applyTheme()
    }
    mql.addEventListener('change', onChange)
    return () => {
      unsub()
      mql.removeEventListener('change', onChange)
    }
  }, [])
}

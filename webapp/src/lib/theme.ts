// Theme selection: dark, light, or follow the OS.
//
// The choice lives on `<html data-theme>`, which is what the token
// definitions in styles/index.css key off. Everything else in the app
// names roles (`bg-surface`, `text-fg-muted`) and never learns which
// theme is active.

export type ThemePreference = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

const STORAGE_KEY = 'sentori_theme';

/** What the OS currently asks for. */
export function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

export function readPreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'dark' || raw === 'light' || raw === 'system') return raw;
  } catch {
    // Storage disabled — fall through to the default.
  }
  return 'system';
}

export function resolve(pref: ThemePreference): ResolvedTheme {
  return pref === 'system' ? systemTheme() : pref;
}

/** Write the resolved theme to `<html>` and remember the preference. */
export function applyPreference(pref: ThemePreference): ResolvedTheme {
  const resolved = resolve(pref);
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolved;
  }
  try {
    localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // Preference just won't survive the reload.
  }
  return resolved;
}

/**
 * Apply the stored preference as early as possible.
 *
 * Called from the entry module before React mounts so the first paint
 * is already the right theme — otherwise a light-mode user gets a
 * dark flash on every load.
 */
export function initTheme(): ResolvedTheme {
  return applyPreference(readPreference());
}

/**
 * Re-resolve when the OS flips, but only while the preference is
 * `system` — an explicit choice outranks the OS.
 */
export function watchSystemTheme(onChange: (t: ResolvedTheme) => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const handler = () => {
    if (readPreference() !== 'system') return;
    const resolved = systemTheme();
    document.documentElement.dataset.theme = resolved;
    onChange(resolved);
  };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

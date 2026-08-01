// Theme selection, delegated to GDS.
//
// The colour values live in @goliapkg/gds — the same system golia.jp
// and the legacy dashboard run on, so the three surfaces read as one
// product rather than three houses with similar paint. GDS keeps the
// theme in an atom, persists it, and `useThemeEffect()` paints the
// resolved `--gds-*` custom properties onto <html> reactively.
//
// This module adds only what Sentori needs on top: the first-run
// posture, and one synchronous paint before React mounts.
//
// Dark stays the default. GDS is dark-native (light is a derived
// adaptation), golia.jp and the marketing site default dark, and half
// an hour of reading stack traces in light mode is measurably more
// tiring.

import {
  DEFAULT_THEME,
  loadPersistedTheme,
  resolveThemeCssVars,
  type ThemeMode,
} from '@goliapkg/gds/systems';

export type { ThemeMode };

/** Compact density: this is a triage tool, not a marketing page.
 *  The primary is the GOLIA brand purple — same ink as golia.jp and
 *  the devops console, so the product reads as part of the family. */
export const BRAND = {
  primaryColor: '#863bff',
  elevation: 'subtle',
  glass: 'off',
} as const;

const SENTORI_DEFAULT = {
  ...DEFAULT_THEME,
  mode: 'dark' as ThemeMode,
  density: 'compact' as const,
  elevation: BRAND.elevation,
  glass: BRAND.glass,
  primaryColor: BRAND.primaryColor,
};

export function systemMode(): 'dark' | 'light' {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

/**
 * Paint the persisted theme before React mounts.
 *
 * Resolving inside an effect means a light-mode user watches the app
 * flash dark on every single load, so the entry module calls this
 * synchronously. `useThemeEffect()` takes over for changes afterwards.
 */
export function initTheme(): 'dark' | 'light' {
  // Brand ink is not a user preference: a persisted theme from
  // before the GOLIA repaint keeps its mode but takes the ink.
  const saved = {
    ...(loadPersistedTheme() ?? SENTORI_DEFAULT),
    primaryColor: BRAND.primaryColor,
    elevation: BRAND.elevation,
    glass: BRAND.glass,
  };
  // Persist the merged state BEFORE React mounts: GDS's theme atom
  // initialises from storage, and useThemeEffect repaints from the
  // atom — without this write the effect would repaint the GDS
  // default (blue) over the brand ink a frame after first paint.
  // (GDS doesn't re-export persistTheme from the systems entry, so
  // this writes its storage key directly, same JSON shape
  // loadPersistedTheme reads.)
  try {
    localStorage.setItem('gds-theme', JSON.stringify(saved));
  } catch {
    // Storage may be unavailable (private mode) — first paint still
    // lands via the synchronous var pass below.
  }
  const resolved = saved.mode === 'system' ? systemMode() : saved.mode;
  if (typeof document !== 'undefined') {
    const vars = resolveThemeCssVars(saved, resolved);
    const root = document.documentElement;
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    root.dataset.theme = resolved;
  }
  return resolved;
}

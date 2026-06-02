/**
 * v2.4 — Users module shared time-window vocabulary.
 *
 * Lives in its own file so the `WindowSwitcher` component file can be
 * Fast-Refresh-friendly (component file should only export components).
 */

export const WINDOW_DAYS: { days: number; label: string }[] = [
  { days: 1, label: '1d' },
  { days: 7, label: '7d' },
  { days: 30, label: '30d' },
]

export const VALID_WINDOW_DAYS: ReadonlySet<number> = new Set(WINDOW_DAYS.map((w) => w.days))

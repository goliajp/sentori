/**
 * Tiny formatting helpers — kept in-tree so we don't pull date-fns just
 * for one relative-time string. Add other format* helpers here as views
 * need them; the rule is "one short function per format, deterministic
 * input → string output, no React imports".
 */

/**
 * Format a past timestamp as a short relative string suitable for table
 * cells: `30s`, `12m`, `4h`, `2d`, `3mo`, `1y`. Anything within 1s rounds
 * up to `1s` so we never render `0s`.
 *
 * Defensive against clock skew / fixtures dated in the future: takes the
 * absolute difference, so a "future" timestamp shows the same magnitude
 * (e.g. `+0` is treated as `~0s` rather than `-Ns`).
 */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const ms = Math.abs(now - new Date(iso).getTime())
  const sec = ms / 1000
  if (sec < 60) return `${Math.max(1, Math.round(sec))}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86_400) return `${Math.round(sec / 3600)}h`
  if (sec < 86_400 * 30) return `${Math.round(sec / 86_400)}d`
  if (sec < 86_400 * 365) return `${Math.round(sec / 86_400 / 30)}mo`
  return `${Math.round(sec / 86_400 / 365)}y`
}

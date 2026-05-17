/**
 * Curated 32-colour wireframe palette.
 *
 * Goals:
 *
 *  1. Visual consistency across host UIs. The SDK emits whatever
 *     `view.background` / `currentTextColor` reports — for a dark-mode
 *     host this is mostly near-white, for a light-mode host mostly
 *     near-black. Either way the literal colours fight the dashboard
 *     canvas and the wireframe doubles as a screenshot. A wireframe
 *     is a *structural* diagram; the colour comes from the paired
 *     screenshot tile. Force the palette here and stop reading
 *     `node.color`.
 *
 *  2. Stable per-node hue. Same spatial fingerprint hashes to the
 *     same palette index → the same node keeps the same colour across
 *     frames. Visual continuity when scrubbing + diff overlays read
 *     clean (added/removed don't repaint a stable node).
 *
 *  3. Stack legibility. Every fill renders at 0.75 alpha so
 *     overlapping rects composite visibly — the eye picks up depth
 *     order without needing explicit z-index cues.
 *
 *  4. Equal perceptual weight. All 32 swatches sit in the Tailwind
 *     `-400` / `-500` luminance band (≈40-55% perceptual lightness)
 *     so no single hue dominates the canvas.
 *
 * Mask, text, and image still get their own treatment — palette
 * applies only to generic `kind: rect` and unknown nodes.
 */

/**
 * 32 colours hand-picked from the Tailwind calibrated set, mixed
 * `-400`/`-500` for even perceptual luminance. Order is irrelevant
 * (the hash mod 32 picks an index); we keep the list flat so the
 * hue progression is easy to scan visually when debugging.
 */
export const WIREFRAME_PALETTE: readonly string[] = [
  // Neutrals — for typical container rects (largest hash class).
  '#94a3b8', // slate-400
  '#9ca3af', // gray-400
  '#a1a1aa', // zinc-400
  '#a8a29e', // stone-400
  // Warm hues
  '#f87171', // red-400
  '#fb923c', // orange-400
  '#fbbf24', // amber-400
  '#eab308', // yellow-500 (skip -400 which is too neon)
  '#a3e635', // lime-400
  // Greens / teals
  '#4ade80', // green-400
  '#34d399', // emerald-400
  '#2dd4bf', // teal-400
  '#22d3ee', // cyan-400
  '#06b6d4', // cyan-500
  // Blues / violets
  '#38bdf8', // sky-400
  '#60a5fa', // blue-400
  '#3b82f6', // blue-500
  '#818cf8', // indigo-400
  '#6366f1', // indigo-500
  '#a78bfa', // violet-400
  '#c084fc', // purple-400
  '#a855f7', // purple-500
  // Pinks / magentas
  '#e879f9', // fuchsia-400
  '#f472b6', // pink-400
  '#fb7185', // rose-400
  // Punchier accents — used by smaller spatial buckets.
  '#ef4444', // red-500
  '#f97316', // orange-500
  '#f59e0b', // amber-500
  '#84cc16', // lime-500
  '#22c55e', // green-500
  '#10b981', // emerald-500
  '#14b8a6', // teal-500
] as const

export const WIREFRAME_FILL_OPACITY = 0.75

/** Mask nodes always render with a strong dark fill — signals
 *  redaction regardless of canvas theme. */
export const WIREFRAME_MASK_FILL = 'rgba(20, 18, 16, 0.78)'

/** Text fill — text content + position matter more than the host
 *  app's text colour. Use the ink token so wireframe text reads on
 *  any host UI. */
export const WIREFRAME_TEXT_FILL = 'var(--ink)'

/** Rect stroke — subtle outline so adjacent same-colour rects don't
 *  visually merge. Theme-agnostic alpha. */
export const WIREFRAME_STROKE = 'rgba(0,0,0,0.18)'

/**
 * Deterministic palette index from a node's spatial fingerprint.
 * Same fingerprint → same colour across every frame in the replay.
 * djb2-style hash; pure JS, no allocs.
 */
export function paletteColorFor(node: { x: number; y: number; w: number; h: number }): string {
  const key = `${Math.round(node.x)},${Math.round(node.y)},${Math.round(node.w)},${Math.round(node.h)}`
  let h = 5381
  for (let i = 0; i < key.length; i++) {
    h = (h * 33) ^ key.charCodeAt(i)
  }
  return WIREFRAME_PALETTE[Math.abs(h) % WIREFRAME_PALETTE.length]!
}

/** Image-kind nodes get rendered as rounded rects (or circles when
 *  the frame is roughly square — avatar-style). Centralised so both
 *  the inline player and the dedicated tab agree. */
export function isCircleShape(w: number, h: number): boolean {
  const min = Math.min(w, h)
  if (min < 8) return false // tiny dots stay rect, no perceptual win from circle
  return Math.abs(w - h) <= min * 0.08
}

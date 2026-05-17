/**
 * Wireframe rendering tokens — muted, structural, single-hue.
 *
 * History: a 32-colour palette landed first when the original bg-
 * matching default fill (paper-3 on paper-3 canvas) erased Android
 * wireframes. The palette over-corrected — every rect/image got a
 * vivid hash-picked hue and the wireframe lost its structural
 * "design-tool placeholder" character, looking arcade. Reverted
 * here to a single tone (ink) with kind-specific alpha levels,
 * which matches design-tool wireframe palettes (Figma's
 * placeholder, Sketch's wireframe symbols, Carbon's empty-state).
 *
 * Why this works on both themes:
 *   - `var(--ink)` is dark in light mode and warm-light in dark
 *     mode, so the same alpha gives readable shapes against either
 *     canvas.
 *   - Lower alpha for generic containers, slightly higher for
 *     images so they read as media, opaque for masks so redaction
 *     is unambiguous.
 *   - Text always renders at full opacity in ink — content reads
 *     regardless of the host app's text colour (Android emits
 *     `currentTextColor` which is white on dark-mode UIs and
 *     would vanish on the light canvas).
 *   - No strokes. The canvas paper colour is the negative space
 *     between rects and you can see edges by alpha alone — borders
 *     felt heavy on dense stacks (cf. user feedback after the
 *     palette round).
 */

/** Fill colour for every non-mask node. Theme-aware via the ink
 *  token; combine with the per-kind alpha tokens below. */
export const WIREFRAME_FILL = 'var(--ink)'

/** Mask nodes — solid ink, high opacity. Signals redaction
 *  unambiguously on either canvas. */
export const WIREFRAME_MASK_FILL = 'var(--ink)'
export const WIREFRAME_MASK_OPACITY = 0.78

/** Image nodes — slightly heavier than generic rects so they read
 *  as "media" without needing a separate hue. */
export const WIREFRAME_IMAGE_OPACITY = 0.18

/** Generic container rects — soft tint, enough to outline the
 *  layout grid but quiet enough that nested rects compose
 *  visibly. */
export const WIREFRAME_RECT_OPACITY = 0.09

/** Text — full opacity, ink colour, always readable against the
 *  canvas. */
export const WIREFRAME_TEXT_FILL = 'var(--ink)'

/** Image-kind nodes get rendered as rounded rects (or circles when
 *  the frame is roughly square — avatar-style). Centralised so both
 *  the inline player and the dedicated tab agree. */
export function isCircleShape(w: number, h: number): boolean {
  const min = Math.min(w, h)
  if (min < 8) return false // tiny dots stay rect, no perceptual win from circle
  return Math.abs(w - h) <= min * 0.08
}

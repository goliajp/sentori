/**
 * Wireframe rendering tokens — original-style defaults (translucent
 * white on whatever canvas), with borders dropped.
 *
 * Iteration history (latest first):
 *
 *   rev 4 (current): back to the original 0.9.x logic — translucent
 *     white defaults, honour `node.color` when the SDK gives one.
 *     Borders dropped per user preference.
 *
 *   rev 3: 4-shade neutral palette + SDK colour pass-through. Felt
 *     too clever for the structure-signalling job.
 *
 *   rev 2: pure ink + per-kind alpha. Too monotone.
 *
 *   rev 1: 32-hue hash palette. Too colourful.
 *
 *   rev 0: bg colour same as canvas → invisible (Insight verify).
 */

/** Generic container rect fill — translucent white. */
export const WIREFRAME_RECT_FILL = 'rgba(255,255,255,0.06)'

/** Image-kind fill — slightly heavier so media regions distinguish
 *  from generic containers when the SDK provided no `color`. */
export const WIREFRAME_IMAGE_FILL = 'rgba(255,255,255,0.18)'

/** Mask — opaque dark for unambiguous redaction on either canvas. */
export const WIREFRAME_MASK_FILL = 'rgba(0,0,0,0.65)'

/** Text fill — always ink, regardless of the SDK-emitted text
 *  colour. Wireframes are structural diagrams; content readability
 *  beats colour fidelity. */
export const WIREFRAME_TEXT_FILL = 'var(--ink)'

/** When the SDK emitted an explicit colour (iOS UIView.backgroundColor,
 *  iOS UILabel.textColor, Android TextView.currentTextColor), render
 *  at this opacity so the host UI's real colour shows through but
 *  still composes with overlapping layers. */
export const WIREFRAME_COLORED_OPACITY = 1

/** Image-kind nodes get rendered as rounded rects (or circles when
 *  the frame is roughly square — avatar-style). */
export function isCircleShape(w: number, h: number): boolean {
  const min = Math.min(w, h)
  if (min < 8) return false
  return Math.abs(w - h) <= min * 0.08
}

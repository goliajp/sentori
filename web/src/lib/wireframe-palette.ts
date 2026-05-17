/**
 * Wireframe rendering tokens.
 *
 * Iteration history (latest first):
 *
 *   rev 5 (current): single-knob `fill-opacity` model. Fallback fill
 *     is now solid white and every rect / image / circle composes via
 *     a shared opacity so an SDK-emitted brand colour (`node.color`)
 *     and the default fallback both layer the same way. Overlapping
 *     rectangles describe depth instead of saturating into a flat
 *     block, which the pre-rev-5 `node.color ?? rgba(...,0.06)` mix
 *     couldn't do (explicit colours rendered fully opaque).
 *
 *   rev 4: original-style translucent white defaults, no borders.
 *     `node.color` passed through opaque — overlapping coloured CTAs
 *     stacked into solid blocks.
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

/** Generic container fallback fill — solid white. The shared
 *  `WIREFRAME_RECT_OPACITY` decides how visible it actually is on
 *  the dark canvas; keeping the fallback solid means overlap
 *  composition matches `node.color` exactly. */
export const WIREFRAME_RECT_FILL = 'rgb(255,255,255)'

/** Image fallback fill — solid white. Image nodes use a slightly
 *  higher fill-opacity so media regions read distinct from generic
 *  containers when the SDK didn't pass `node.color`. */
export const WIREFRAME_IMAGE_FILL = 'rgb(255,255,255)'

/** Shared fill-opacity for rect / circle / colour-passed-through
 *  nodes. 0.95 lands on the high-saturation side — the previous
 *  0.25 was too pale to read on the dashboard's dark canvas (user
 *  feedback 2026-05-18: "看不清了"). Overlap composition is still
 *  visible at this opacity, just subtler. */
export const WIREFRAME_RECT_OPACITY = 0.95

/** Image regions stay fully opaque — they represent media and
 *  reading them as solid blocks is fine; container overlap is
 *  carried by the rect tier. */
export const WIREFRAME_IMAGE_OPACITY = 1

/** Mask — opaque dark for unambiguous redaction on either canvas. */
export const WIREFRAME_MASK_FILL = 'rgba(0,0,0,0.65)'

/** Text fill — always ink, regardless of the SDK-emitted text
 *  colour. Wireframes are structural diagrams; content readability
 *  beats colour fidelity. */
export const WIREFRAME_TEXT_FILL = 'var(--ink)'

/** Image-kind nodes get rendered as rounded rects (or circles when
 *  the frame is roughly square — avatar-style). */
export function isCircleShape(w: number, h: number): boolean {
  const min = Math.min(w, h)
  if (min < 8) return false
  return Math.abs(w - h) <= min * 0.08
}

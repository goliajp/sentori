/**
 * Phase 42 sub-A.06 — derive a "package name" from a frame's file
 * path so consecutive vendor frames can be grouped in the stack
 * viewer.
 *
 * Returns:
 *   - `node_modules/<pkg>/...`                → "pkg"
 *   - `node_modules/@scope/<pkg>/...`         → "@scope/pkg"
 *   - `.../react-native/Libraries/...`        → "react-native"   (Hermes-bundled RN core)
 *   - `.../Libraries/react-native/...`        → "react-native"   (Metro path variant)
 *   - URL-encoded `node_modules%2F...` paths  → same as above (Metro lazy bundle URLs)
 *   - everything else                          → null
 *
 * `null` means "I don't know how to group this frame" — the caller
 * should fall back to treating it as ungrouped (single row) or use
 * the broader `inApp` boolean instead.
 *
 * Heuristics, not deterministic — `node_modules/<pkg>/` and the RN
 * core path cover ~95% of real frames; the rest end up ungrouped,
 * which is no worse than today's behaviour.
 */
export function packageOf(file: null | string | undefined): null | string {
  if (!file) return null

  // Decode any percent-encoding (Metro lazy-bundle URLs sometimes ship
  // path segments as `node_modules%2F<pkg>%2F...`).
  let normalised = file
  if (normalised.includes('%2F') || normalised.includes('%2f')) {
    try {
      normalised = decodeURIComponent(normalised)
    } catch {
      // bad escape — keep the raw string
    }
  }

  // React Native core, both layouts seen in the wild. Accept the
  // `node_modules/...` segment either after a path separator or at the
  // start of a relative path (e.g. server symbolicator may emit
  // `node_modules/react-native/...` rather than absolute paths).
  if (
    /(?:^|\/)(?:react-native\/Libraries|Libraries\/react-native)\//.test(normalised) ||
    /(?:^|\/)node_modules\/react-native\//.test(normalised)
  ) {
    return 'react-native'
  }

  // node_modules/<@scope/pkg>/... or node_modules/<pkg>/...
  const nm = normalised.match(/(?:^|\/)node_modules\/(@[^/]+\/[^/]+|[^/]+)\//)
  if (nm) return nm[1] ?? null

  return null
}

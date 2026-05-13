#!/usr/bin/env bash
# Phase 42 sub-A.03 helper. Re-extracts @wooorm/starry-night's prebuilt
# light + dark CSS into a single file scoped to the dashboard's
# `data-theme` attribute. Run after bumping starry-night.

set -euo pipefail

cd "$(dirname "$0")/.."

DARK=node_modules/@wooorm/starry-night/style/dark.css
LIGHT=node_modules/@wooorm/starry-night/style/light.css
OUT=src/styles/syntax.css

[ -f "$DARK" ] && [ -f "$LIGHT" ] || {
  echo "starry-night CSS not found — did you 'bun install'?" >&2
  exit 1
}

# Vars between `:root {` and the next `}`. Rules: everything after that.
extract_vars() { awk '/^:root \{/{p=1;next} p && /^}/{exit} p' "$1"; }
extract_rules() { awk 'flag; /^}/ && !flag{flag=1}' "$1"; }

{
  cat <<EOF
/*
 * Phase 42 sub-A.03 — syntax highlighting palette.
 *
 * GitHub-style colors from @wooorm/starry-night, scoped to the
 * dashboard's \`data-theme\` attribute (not \`prefers-color-scheme\`).
 * Vars default to the light palette; \`html[data-theme='dark']\`
 * overrides to the dark palette. The \`.pl-*\` rules below are
 * theme-agnostic; they reference the vars.
 *
 * Sourced 1:1 from \`@wooorm/starry-night/style/{light,dark}.css\` —
 * regenerate via \`web/scripts/regenerate-syntax-css.sh\` if you bump
 * the dependency.
 */

:root {
EOF
  extract_vars "$LIGHT"
  cat <<EOF
}

html[data-theme='dark'] {
EOF
  extract_vars "$DARK"
  cat <<EOF
}

EOF
  extract_rules "$DARK"
} > "$OUT"

echo "wrote $(wc -l < "$OUT") lines to $OUT"

# Format to match the project's prettier rules so `bun run check`
# doesn't fail right after a regen.
if command -v bunx >/dev/null 2>&1; then
  bunx prettier --write "$OUT" >/dev/null
  echo "formatted $OUT with prettier"
fi

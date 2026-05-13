/**
 * Phase 42 sub-A.13 post-Insight feedback — user-pickable URI
 * template for "Open in editor".
 *
 * Insight reported Safari refusing the hardcoded `vscode://…`
 * scheme — they're on Cursor / Xcode and have no app registered
 * for `vscode://`. Different machines run different IDEs, so we
 * make it a per-user preference (localStorage), with a list of
 * known editors plus a "custom" template option.
 *
 * Templates accept `{file}`, `{line}`, `{column}` placeholders.
 * The substitution is plain string-replace, no escaping — every
 * known scheme expects raw paths.
 */

export type EditorChoice = {
  /** Stable id used in localStorage. */
  id: string
  label: string
  /** URI template. `{file}` / `{line}` / `{column}` are substituted. */
  template: string
}

export const KNOWN_EDITORS: EditorChoice[] = [
  { id: 'vscode', label: 'VS Code', template: 'vscode://file/{file}:{line}:{column}' },
  { id: 'cursor', label: 'Cursor', template: 'cursor://file/{file}:{line}:{column}' },
  { id: 'windsurf', label: 'Windsurf', template: 'windsurf://file/{file}:{line}:{column}' },
  { id: 'xcode', label: 'Xcode', template: 'xed:///{file}' },
  { id: 'webstorm', label: 'WebStorm', template: 'webstorm://open?file={file}&line={line}' },
  { id: 'sublime', label: 'Sublime Text', template: 'subl://open?url=file://{file}&line={line}' },
  { id: 'fleet', label: 'Fleet', template: 'fleet://open/{file}?line={line}' },
  { id: 'zed', label: 'Zed', template: 'zed://file/{file}:{line}:{column}' },
]

const STORAGE_KEY = 'sentori:ui:editor-template:v1'
const STORAGE_CUSTOM_KEY = 'sentori:ui:editor-template-custom:v1'

/** Always returns a usable template — falls back to VS Code if the
 *  stored id is unknown / corrupted. */
export function getEditorTemplate(): EditorChoice {
  if (typeof window === 'undefined') return KNOWN_EDITORS[0]!
  try {
    const id = window.localStorage.getItem(STORAGE_KEY) ?? 'vscode'
    if (id === 'custom') {
      const t = window.localStorage.getItem(STORAGE_CUSTOM_KEY)
      if (t && t.includes('{file}')) {
        return { id: 'custom', label: 'Custom', template: t }
      }
    }
    return KNOWN_EDITORS.find((e) => e.id === id) ?? KNOWN_EDITORS[0]!
  } catch {
    return KNOWN_EDITORS[0]!
  }
}

export function setEditorTemplate(choice: { id: string; customTemplate?: string }): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, choice.id)
    if (choice.id === 'custom' && choice.customTemplate) {
      window.localStorage.setItem(STORAGE_CUSTOM_KEY, choice.customTemplate)
    }
    // Notify same-window listeners (storage event only fires across
    // tabs); button rows re-read on each hover/render anyway, but a
    // global event makes the picker UI live-update.
    window.dispatchEvent(new CustomEvent('sentori:editor-template-changed'))
  } catch {
    // localStorage unavailable (private mode etc.) — silently ignore
  }
}

export function applyTemplate(
  template: string,
  vars: { file: string; line: number; column: number }
): string {
  return template
    .replace('{file}', vars.file)
    .replace('{line}', String(vars.line))
    .replace('{column}', String(vars.column))
}

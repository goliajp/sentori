import { useEffect, useState } from 'react'

import { getEditorTemplate, KNOWN_EDITORS, setEditorTemplate } from '@/lib/editor-template'

/**
 * Phase 42 sub-A.13 post-Insight feedback — sidebar picker for the
 * per-user "Open in editor" URI scheme. localStorage-backed so it
 * persists per-browser-profile, not per-account; that matches the
 * model where a developer with two workstations might run a
 * different editor on each.
 *
 * The "Custom" option exposes a free-form template field with
 * `{file}` / `{line}` / `{column}` placeholders for editors that
 * aren't in the known list.
 */
export function EditorPicker() {
  const [current, setCurrent] = useState(() => getEditorTemplate())
  const [showCustom, setShowCustom] = useState(current.id === 'custom')
  const [customDraft, setCustomDraft] = useState(current.id === 'custom' ? current.template : '')

  // Live-sync if some other tab / component changed the preference.
  useEffect(() => {
    const onChange = () => {
      const next = getEditorTemplate()
      setCurrent(next)
      if (next.id === 'custom') setCustomDraft(next.template)
    }
    window.addEventListener('sentori:editor-template-changed', onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('sentori:editor-template-changed', onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  return (
    <div className="space-y-1">
      <label className="text-fg-muted block px-1 text-[10px] tracking-wider uppercase">
        Open frame in
      </label>
      <select
        className="border-border bg-bg-tertiary text-fg w-full rounded-md border px-2 py-1 text-[11px]"
        onChange={(e) => {
          const id = e.target.value
          setShowCustom(id === 'custom')
          if (id === 'custom') {
            // Only commit once the user types a valid template.
            setCurrent({
              id: 'custom',
              label: 'Custom',
              template: customDraft || 'vscode://file/{file}:{line}:{column}',
            })
          } else {
            setEditorTemplate({ id })
            setCurrent(getEditorTemplate())
          }
        }}
        value={current.id}
      >
        {KNOWN_EDITORS.map((e) => (
          <option key={e.id} value={e.id}>
            {e.label}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {showCustom && (
        <input
          aria-label="Custom editor URI template"
          className="border-border bg-bg-tertiary text-fg w-full rounded-md border px-2 py-1 font-mono text-[10px]"
          onBlur={(e) => {
            const t = e.target.value.trim()
            if (t.includes('{file}')) {
              setEditorTemplate({ customTemplate: t, id: 'custom' })
              setCurrent(getEditorTemplate())
            }
          }}
          onChange={(e) => setCustomDraft(e.target.value)}
          placeholder="myeditor://open?path={file}&line={line}"
          spellCheck={false}
          value={customDraft}
        />
      )}
    </div>
  )
}

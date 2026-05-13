import { useEffect, useState } from 'react'

import type { Frame } from '@/api/client'
import { applyTemplate, getEditorTemplate } from '@/lib/editor-template'

/**
 * Phase 42 sub-A.13 — quick-jump to your local IDE.
 *
 * Picks the URI scheme from a per-user `localStorage` preference
 * (`<EditorPreference>` lives in the sidebar). VS Code by default;
 * other choices include Cursor, Windsurf, Zed, WebStorm, Xcode,
 * Sublime, Fleet, and a free-form custom template with
 * `{file}` / `{line}` / `{column}` placeholders.
 *
 * The button is only meaningful when the frame's `file` is an
 * absolute path on the developer's machine — typical for dev-mode
 * stacks (Metro symbolicates to `/Users/.../src/Foo.tsx`) and for
 * server-symbolicated stacks where the SDK's source map points at
 * the original absolute paths. We skip rendering when the path
 * doesn't look like an absolute file path.
 */
export function OpenInEditorButton({ frame }: { frame: Frame | null | undefined }) {
  // Listen for picker changes in the same tab so the next render
  // picks up the new URI scheme without a page reload.
  const [, bump] = useState(0)
  useEffect(() => {
    const onChange = () => bump((n) => n + 1)
    window.addEventListener('sentori:editor-template-changed', onChange)
    return () => window.removeEventListener('sentori:editor-template-changed', onChange)
  }, [])

  if (!frame) return null
  const file = frame.file
  if (!file || !file.startsWith('/')) return null
  // Skip bundle URLs / file:// (frame.file may be a URL when the
  // SDK didn't symbolicate).
  if (/^https?:\/\//.test(file) || file.startsWith('file://')) return null

  const editor = getEditorTemplate()
  const url = applyTemplate(editor.template, {
    column: frame.column ?? 1,
    file,
    line: frame.line,
  })
  return (
    <a
      className="border-border hover:border-accent/60 hover:text-fg text-fg-muted flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
      href={url}
      rel="noopener noreferrer"
      title={`Open ${file}:${frame.line} in ${editor.label}`}
    >
      ↗ Open in {editor.label}
    </a>
  )
}

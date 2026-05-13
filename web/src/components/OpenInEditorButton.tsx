import type { Frame } from '@/api/client'

/**
 * Phase 42 sub-A.13 — quick-jump to your local IDE.
 *
 * Uses the `vscode://file/<path>:<line>:<col>` URI scheme that VS
 * Code (and Cursor, Windsurf, and other forks) all register on
 * install. Cmd+Click also opens a path in Finder on macOS, but the
 * URI scheme is the only thing that takes you straight to the line.
 *
 * The button is only meaningful when the frame's `file` is an
 * absolute path on the developer's machine — typical for dev-mode
 * stacks (Metro symbolicates to `/Users/.../src/Foo.tsx`) and for
 * server-symbolicated stacks where the SDK's source map points at
 * the original absolute paths. We skip rendering when the path
 * doesn't look like an absolute file path.
 *
 * Other editors expose similar schemes (`fleet://open/`,
 * `jetbrains://open?file=...`, `windsurf://file/...`); we ship VS
 * Code as the default because Cursor + Windsurf both reuse it. A
 * future per-user preference can switch the scheme without
 * touching callers.
 */
export function OpenInEditorButton({ frame }: { frame: Frame | null | undefined }) {
  if (!frame) return null
  const file = frame.file
  if (!file || !file.startsWith('/')) return null
  // Skip bundle URLs / file:// (frame.file may be a URL when the
  // SDK didn't symbolicate).
  if (/^https?:\/\//.test(file) || file.startsWith('file://')) return null
  const col = frame.column ?? 1
  const url = `vscode://file/${file}:${frame.line}:${col}`
  return (
    <a
      className="border-border hover:border-accent/60 hover:text-fg text-fg-muted flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
      href={url}
      rel="noopener noreferrer"
      title={`Open ${file}:${frame.line} in VS Code`}
    >
      ↗ Open in editor
    </a>
  )
}

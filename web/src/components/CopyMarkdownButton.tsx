import { useState } from 'react'

import type { EventRow, IssueRow } from '@/api/client'
import { renderIssueMarkdown } from '@/lib/issue-markdown'

/**
 * Phase 42 sub-H.02 — render the active event as Markdown and copy
 * it to the clipboard. The shape is tuned for paste-into-AI / paste-
 * into-ticket workflows: error headline, top stack frames with
 * inline source fences, breadcrumb tail.
 *
 * Button gives a 1.5s "Copied" flash on success; falls back to a
 * `prompt()` with the text if `navigator.clipboard.writeText` isn't
 * available (Safari over HTTP, or `localhost` in some configs).
 */
export function CopyMarkdownButton({
  event,
  issue,
  orgSlug,
}: {
  event: EventRow | undefined
  issue: IssueRow
  orgSlug: string
}) {
  const [status, setStatus] = useState<'copied' | 'idle'>('idle')
  if (!event) return null

  const onClick = async () => {
    const md = renderIssueMarkdown({
      event,
      issue,
      orgSlug,
      origin: window.location.origin,
    })
    try {
      await navigator.clipboard.writeText(md)
      setStatus('copied')
      setTimeout(() => setStatus('idle'), 1500)
    } catch {
      // Insecure context (http) or clipboard API blocked — fall back
      // to a prompt the user can manually copy out of.
      window.prompt('Markdown:', md)
    }
  }

  return (
    <button
      aria-label="Copy this issue as Markdown"
      className="border-border hover:border-accent/60 hover:text-fg text-fg-muted flex items-center gap-1 rounded-md border px-2 py-1 text-[11px]"
      onClick={onClick}
      title="Copy a Markdown summary of this issue (stack + source + breadcrumbs) for paste-into-chat or AI debug"
      type="button"
    >
      {status === 'copied' ? '✓ Copied' : '📋 Copy MD'}
    </button>
  )
}

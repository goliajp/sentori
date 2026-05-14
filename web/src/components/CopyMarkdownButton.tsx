import type { EventRow, IssueRow } from '@/api/client'
import { renderIssueMarkdown } from '@/lib/issue-markdown'

import { useToast } from './ui'

/**
 * Phase 42 sub-H.02 — render the active event as Markdown and copy
 * it to the clipboard. Tuned for paste-into-AI / paste-into-ticket
 * workflows: error headline, top stack frames with inline source
 * fences, breadcrumb tail.
 *
 * Phase 50 sub-B5 — confirmation moved from an inline "✓ Copied" flash
 * to a global toast. Lets the user click → see toast → tab away;
 * the inline flash was inconvenient on small screens where the
 * button wasn't on the user's gaze. Fallback path (insecure context)
 * still pops `window.prompt` so power users can grab the text.
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
  const toast = useToast()
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
      toast.success('Copied as Markdown', {
        detail: 'Stack + source + breadcrumbs are on your clipboard.',
      })
    } catch {
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
      📋 Copy MD
    </button>
  )
}

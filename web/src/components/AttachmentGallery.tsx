import type { Attachment } from '@/api/client'

/**
 * Phase 42 sub-C.09 — visual slot for SDK-uploaded attachments on
 * the issue-detail page. Today the SDK doesn't produce any (sub-D
 * lands JS / RN screenshots; sub-E + F do native; sub-G adds view
 * trees), so this component returns `null` when the array is empty
 * — keeping the layout untouched for older events.
 *
 * When attachments arrive, screenshots render inline as lazy-loaded
 * thumbnails; JSON-shaped attachments (view trees, state snapshots,
 * log tails) get a "open in viewer" pill until the dedicated viewers
 * land in sub-G / sub-H.
 */
export function AttachmentGallery({
  attachments,
  eventId,
}: {
  attachments: Attachment[] | undefined
  /** Used to build the GET URL for each blob. */
  eventId: string
}) {
  if (!attachments || attachments.length === 0) return null

  return (
    <section>
      <h2 className="text-fg-muted mb-2 text-[11px] tracking-wider uppercase">Captured at error</h2>
      <ul className="flex flex-wrap gap-3">
        {attachments.map((a) => (
          <li key={a.ref}>
            <AttachmentTile attachment={a} eventId={eventId} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function AttachmentTile({ attachment, eventId }: { attachment: Attachment; eventId: string }) {
  const url = `/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(attachment.ref)}`
  if (attachment.kind === 'screenshot') {
    return (
      <a
        className="border-border hover:border-accent/60 block overflow-hidden rounded-md border"
        href={url}
        rel="noopener noreferrer"
        target="_blank"
        title={`Screenshot · ${attachment.source ?? 'unknown source'}`}
      >
        <img alt="Crash screenshot" className="block max-h-40 w-auto" loading="lazy" src={url} />
      </a>
    )
  }
  // Non-image attachments — just a pill that opens raw JSON in a new tab.
  // sub-G replaces this with a tree viewer for `viewTree`.
  return (
    <a
      className="border-border hover:border-accent/60 text-fg-muted hover:text-fg flex items-center gap-2 rounded-md border px-3 py-2 text-[12px]"
      href={url}
      rel="noopener noreferrer"
      target="_blank"
      title={`${attachment.kind} · ${attachment.source ?? 'unknown source'}`}
    >
      <span className="font-mono">{attachment.kind}</span>
      {attachment.source && <span className="text-[10px] uppercase">{attachment.source}</span>}
    </a>
  )
}

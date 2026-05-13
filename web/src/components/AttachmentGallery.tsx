import { useEffect, useMemo, useState } from 'react'

import type { Attachment } from '@/api/client'

/**
 * Phase 42 sub-C.09 / D.11 / D.12 — visual slot for SDK-uploaded
 * attachments on the issue-detail page.
 *
 * Screenshots render as lazy-loaded thumbnails; clicking one opens
 * a modal `<Lightbox>` with the full-size image plus keyboard
 * controls (esc to close, ← / → to step through siblings) and a
 * download button.
 *
 * Non-image kinds (`viewTree` / `stateSnapshot` / `logTail`) still
 * fall back to a pill that opens the raw blob in a new tab. The
 * dedicated `<ViewTreePanel>` for `viewTree` lands in sub-G.
 */
export function AttachmentGallery({
  attachments,
  eventId,
}: {
  attachments: Attachment[] | undefined
  /** Used to build the GET URL for each blob. */
  eventId: string
}) {
  const screenshots = useMemo(
    () => (attachments ?? []).filter((a) => a.kind === 'screenshot'),
    [attachments]
  )
  const others = useMemo(
    () => (attachments ?? []).filter((a) => a.kind !== 'screenshot'),
    [attachments]
  )
  const [openIdx, setOpenIdx] = useState<null | number>(null)

  if (!attachments || attachments.length === 0) return null

  return (
    <section>
      <h2 className="text-fg-muted mb-2 text-[11px] tracking-wider uppercase">Captured at error</h2>
      <ul className="flex flex-wrap gap-3">
        {screenshots.map((a, i) => (
          <li key={a.ref}>
            <ScreenshotTile attachment={a} eventId={eventId} onOpen={() => setOpenIdx(i)} />
          </li>
        ))}
        {others.map((a) => (
          <li key={a.ref}>
            <NonImageTile attachment={a} eventId={eventId} />
          </li>
        ))}
      </ul>
      {openIdx !== null && (
        <Lightbox
          attachments={screenshots}
          eventId={eventId}
          onClose={() => setOpenIdx(null)}
          onStep={(d) =>
            setOpenIdx((cur) => {
              if (cur === null || screenshots.length === 0) return cur
              return (cur + d + screenshots.length) % screenshots.length
            })
          }
          startIdx={openIdx}
        />
      )}
    </section>
  )
}

function attachmentUrl(eventId: string, ref: string): string {
  return `/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(ref)}`
}

function ScreenshotTile({
  attachment,
  eventId,
  onOpen,
}: {
  attachment: Attachment
  eventId: string
  onOpen: () => void
}) {
  const url = attachmentUrl(eventId, attachment.ref)
  return (
    <button
      className="border-border hover:border-accent/60 block overflow-hidden rounded-md border"
      onClick={onOpen}
      title={`Screenshot · ${attachment.source ?? 'unknown source'}`}
      type="button"
    >
      <img alt="Crash screenshot" className="block max-h-40 w-auto" loading="lazy" src={url} />
    </button>
  )
}

function NonImageTile({ attachment, eventId }: { attachment: Attachment; eventId: string }) {
  const url = attachmentUrl(eventId, attachment.ref)
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

function Lightbox({
  attachments,
  eventId,
  onClose,
  onStep,
  startIdx,
}: {
  attachments: Attachment[]
  eventId: string
  onClose: () => void
  onStep: (delta: number) => void
  startIdx: number
}) {
  const active = attachments[startIdx]

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') onStep(+1)
      else if (e.key === 'ArrowLeft') onStep(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStep])

  if (!active) return null

  const url = attachmentUrl(eventId, active.ref)
  const hasSiblings = attachments.length > 1

  return (
    <div
      aria-modal
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-6"
      onClick={onClose}
      role="dialog"
    >
      {/* Inner wrapper stops click-on-image from closing the modal. */}
      <div
        className="flex max-h-full max-w-full flex-col items-center"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          alt="Crash screenshot"
          className="max-h-[80vh] max-w-[90vw] rounded-md shadow-2xl"
          src={url}
        />
        <div className="text-fg-muted mt-3 flex items-center gap-4 text-[11px]">
          <span>
            {startIdx + 1} / {attachments.length}
            {active.source && <span className="ml-2 uppercase">{active.source}</span>}
          </span>
          {hasSiblings && (
            <>
              <button
                aria-label="Previous"
                className="hover:text-fg"
                onClick={() => onStep(-1)}
                type="button"
              >
                ← prev
              </button>
              <button
                aria-label="Next"
                className="hover:text-fg"
                onClick={() => onStep(+1)}
                type="button"
              >
                next →
              </button>
            </>
          )}
          <a
            className="hover:text-fg"
            download
            href={url}
            rel="noopener noreferrer"
            target="_blank"
          >
            ↓ download
          </a>
          <button aria-label="Close" className="hover:text-fg" onClick={onClose} type="button">
            ✕ esc
          </button>
        </div>
      </div>
    </div>
  )
}

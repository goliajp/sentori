import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { adminApi, type Attachment } from '@/api/client'

import { SessionTrailViewer } from './SessionTrailViewer'
import { StateTimetravelViewer } from './StateTimetravelViewer'
import { ViewTreePanel } from './ViewTreePanel'

/**
 * v2 inline replacement for the deleted `<InfoBox>` — semantic-toned
 * box (info / warning / danger). Kept local so AttachmentGallery has
 * no out-of-module deps beyond its real reason for existing.
 */
function InfoBox({
  children,
  title,
  variant = 'info',
}: {
  children: ReactNode
  title: string
  variant?: 'danger' | 'info' | 'warning'
}) {
  const cls =
    variant === 'danger'
      ? 'border-danger/40 bg-danger/5 text-danger'
      : variant === 'warning'
        ? 'border-warning/40 bg-warning/5 text-warning'
        : 'border-info/40 bg-info/5 text-info'
  return (
    <div className={`t-md rounded-md border px-3 py-2 ${cls}`}>
      <div className="t-sm mb-1 font-semibold tracking-wider uppercase">{title}</div>
      <div className="text-fg">{children}</div>
    </div>
  )
}

/**
 * Phase 42 sub-C.09 / D.11 / D.12 — visual slot for SDK-uploaded
 * attachments on the issue-detail page.
 *
 * Phase 48 sub-A.2 — pulls attachments directly from
 * `/admin/api/events/<id>/attachments` instead of trusting
 * `event.payload.attachments[]` echoed by the client. A broken echo
 * (proxy rewriting 201 → 202 on upload, network blip between attach
 * + event POST) no longer hides screenshots. Server is source-of-
 * truth; `payload.attachments` is treated as a hint at best.
 *
 * Empty state now renders "No attachments captured" instead of
 * `return null` so the user can tell whether the section is wired
 * up vs. truly has no data.
 *
 * Screenshots render as lazy-loaded thumbnails; clicking one opens
 * a modal `<Lightbox>` with the full-size image plus keyboard
 * controls (esc to close, ← / → to step through siblings) and a
 * download button. Non-image kinds (`viewTree` / `stateSnapshot` /
 * `logTail` / `sessionTrail`) get a dedicated viewer.
 */
export function AttachmentGallery({ eventId, projectId }: { eventId: string; projectId: string }) {
  const { data, error, isLoading } = useQuery({
    enabled: !!eventId && !!projectId,
    queryFn: () => adminApi.listEventAttachments(projectId, eventId),
    queryKey: ['event-attachments', projectId, eventId],
    staleTime: 60_000,
  })
  const attachments = data ?? []
  const screenshots = useMemo(
    () => attachments.filter((a) => a.kind === 'screenshot'),
    [attachments]
  )
  const viewTrees = useMemo(() => attachments.filter((a) => a.kind === 'viewTree'), [attachments])
  const sessionTrails = useMemo(
    () => attachments.filter((a) => a.kind === 'sessionTrail'),
    [attachments]
  )
  const stateSnapshots = useMemo(
    () => attachments.filter((a) => a.kind === 'stateSnapshot'),
    [attachments]
  )
  const others = useMemo(
    () =>
      attachments.filter(
        (a) =>
          a.kind !== 'screenshot' &&
          a.kind !== 'viewTree' &&
          a.kind !== 'sessionTrail' &&
          a.kind !== 'stateSnapshot'
      ),
    [attachments]
  )
  const [openIdx, setOpenIdx] = useState<null | number>(null)

  if (isLoading) {
    return (
      <Frame>
        <p className="text-fg-muted text-[12px]">Loading attachments…</p>
      </Frame>
    )
  }
  if (error) {
    return (
      <Frame>
        <InfoBox variant="danger" title="Failed to load attachments">
          The server couldn't return attachments for this event. Retry the page; if it keeps
          failing, check the dashboard console for the request response.
        </InfoBox>
      </Frame>
    )
  }
  if (attachments.length === 0) {
    return (
      <Frame>
        <InfoBox variant="info" title="No attachments captured for this event">
          Add <code className="font-mono">capture: {`{ screenshot: true }`}</code> to your SDK{' '}
          <code className="font-mono">init</code> call to attach a screenshot when{' '}
          <code className="font-mono">captureException</code> fires.
        </InfoBox>
      </Frame>
    )
  }

  return (
    <Frame>
      {(screenshots.length > 0 || others.length > 0) && (
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
      )}
      {/* Phase 42 sub-G.07: inline the view tree right under the gallery
          for `viewTree` attachments. Multiple trees (rare — typically
          one per source: ios, android, js) get stacked. */}
      {viewTrees.map((a) => (
        <details
          className="border-border bg-bg-tertiary/30 rounded-md border"
          key={a.ref}
          open={viewTrees.length === 1}
        >
          <summary className="text-fg cursor-pointer px-3 py-2 text-[12px]">
            View tree at error
            {a.source && (
              <span className="text-fg-muted ml-2 text-[10px] uppercase">{a.source}</span>
            )}
          </summary>
          <div className="px-3 pb-3">
            <ViewTreePanel attachmentRef={a.ref} eventId={eventId} />
          </div>
        </details>
      ))}
      {sessionTrails.map((a) => (
        <details
          className="border-border bg-bg-tertiary/30 rounded-md border"
          key={a.ref}
          open={sessionTrails.length === 1}
        >
          <summary className="text-fg cursor-pointer px-3 py-2 text-[12px]">
            Session trail
            <span className="text-fg-muted ml-2 text-[10px]">steps leading up to the error</span>
          </summary>
          <div className="px-3 pb-3">
            <SessionTrailViewer attachmentRef={a.ref} eventId={eventId} />
          </div>
        </details>
      ))}
      {/* v0.9.3 +S2-VIEW — state time-travel for `stateSnapshot`
          attachments uploaded by SDKs that called `bindState` or
          `recordState`. Default open when there's only one. */}
      {stateSnapshots.map((a) => (
        <details
          className="border-border bg-bg-tertiary/30 rounded-md border"
          key={a.ref}
          open={stateSnapshots.length === 1}
        >
          <summary className="text-fg cursor-pointer px-3 py-2 text-[12px]">
            State time-travel
            <span className="text-fg-muted ml-2 text-[10px]">
              redux / zustand / manual snapshots leading up to the error
            </span>
          </summary>
          <div className="px-3 pb-3">
            <StateTimetravelViewer attachmentRef={a.ref} eventId={eventId} />
          </div>
        </details>
      ))}
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
    </Frame>
  )
}

/** Phase 49 sub-A — every state (loading / error / empty / data) lives
 *  inside this section frame so the section header stays consistent. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-fg-muted text-[11px] font-medium tracking-[0.06em] uppercase">
        Captured at error
      </h2>
      {children}
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

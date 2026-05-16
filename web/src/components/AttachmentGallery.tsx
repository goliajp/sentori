import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useMemo, useState } from 'react'

import { adminApi, type Attachment } from '@/api/client'

import { ReplayPlayer } from './ReplayPlayer'
import { ScreenshotDebugCenter, DefRow } from './ScreenshotDebugCenter'
import { SessionTrailViewer } from './SessionTrailViewer'
import { StateTimetravelViewer } from './StateTimetravelViewer'
import { ViewTreePanel } from './ViewTreePanel'

/**
 * Inline replacement for the deleted `<InfoBox>` — paper-toned, no
 * coloured backgrounds (we collapse semantic status onto the single
 * accent or the danger token). Bordered rule only on the top.
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
  const accent = variant === 'danger' ? 'var(--danger)' : 'var(--accent)'
  return (
    <div className="border-t border-b px-0 py-3" style={{ borderColor: 'var(--rule)' }}>
      <div
        className="mb-1.5 font-mono text-[10px] tracking-[0.22em] uppercase"
        style={{ color: accent }}
      >
        {title}
      </div>
      <div className="text-[13px] text-[color:var(--ink-soft)]">{children}</div>
    </div>
  )
}

/**
 * Attachment gallery — sits on the issue-detail page under the stack
 * trace. Pulls server-of-truth attachments from
 * `/admin/api/events/<id>/attachments` (Phase 48 sub-A.2 — the wire
 * `payload.attachments[]` is treated as a hint, not a contract).
 *
 * Editorial design: thumbnails sit on a hairline-divided strip with
 * no per-tile chrome. Clicking opens the new
 * `<ScreenshotDebugCenter>` — a three-pane fullscreen page that
 * surfaces the screenshot at viewport scale alongside the same
 * event-context fields the issue-detail page already shows.
 *
 * `eventContext` is the slot the parent fills with `<DefRow>`s for
 * release / device / geo / error / breadcrumbs — keeps the gallery
 * scope-free (no second event-detail fetch).
 */
export function AttachmentGallery({
  eventContext,
  eventId,
  projectId,
}: {
  eventContext?: ReactNode
  eventId: string
  projectId: string
}) {
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
  const replays = useMemo(() => attachments.filter((a) => a.kind === 'replay'), [attachments])
  const others = useMemo(
    () =>
      attachments.filter(
        (a) =>
          a.kind !== 'screenshot' &&
          a.kind !== 'viewTree' &&
          a.kind !== 'sessionTrail' &&
          a.kind !== 'stateSnapshot' &&
          a.kind !== 'replay'
      ),
    [attachments]
  )
  const [openIdx, setOpenIdx] = useState<null | number>(null)

  if (isLoading) {
    return (
      <Frame>
        <p className="text-[12px] text-[color:var(--ink-muted)]">Loading attachments…</p>
      </Frame>
    )
  }
  if (error) {
    return (
      <Frame>
        <InfoBox variant="danger" title="Failed to load">
          The server didn't return attachments for this event. Retry the page; if it keeps failing,
          check the dashboard console for the request response.
        </InfoBox>
      </Frame>
    )
  }
  if (attachments.length === 0) {
    return (
      <Frame>
        <InfoBox title="No attachments captured">
          Add <code className="font-mono">capture: {`{ screenshot: true }`}</code> to your SDK{' '}
          <code className="font-mono">init</code> call to attach a screenshot when{' '}
          <code className="font-mono">captureException</code> fires.
        </InfoBox>
      </Frame>
    )
  }

  // Concatenated open-list: screenshots first, then others. The
  // debug center steps through in this order so siblings stay close.
  const openable = [...screenshots, ...others]

  return (
    <Frame>
      {openable.length > 0 && (
        <ul className="flex flex-wrap gap-4 pt-3">
          {screenshots.map((a, i) => (
            <li key={a.ref}>
              <ScreenshotTile attachment={a} eventId={eventId} onOpen={() => setOpenIdx(i)} />
            </li>
          ))}
          {others.map((a, i) => (
            <li key={a.ref}>
              <NonImageTile
                attachment={a}
                eventId={eventId}
                onOpen={() => setOpenIdx(screenshots.length + i)}
              />
            </li>
          ))}
        </ul>
      )}
      {viewTrees.map((a) => (
        <details
          className="mt-4 border-t border-[color:var(--rule)]"
          key={a.ref}
          open={viewTrees.length === 1}
        >
          <summary className="flex cursor-pointer items-baseline gap-3 py-3">
            <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
              View tree
            </span>
            <span className="font-sans text-[14px] text-[color:var(--ink)]">at error</span>
            {a.source && (
              <span className="ml-auto font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
                {a.source}
              </span>
            )}
          </summary>
          <div className="pb-4">
            <ViewTreePanel attachmentRef={a.ref} eventId={eventId} />
          </div>
        </details>
      ))}
      {sessionTrails.map((a) => (
        <details
          className="mt-4 border-t border-[color:var(--rule)]"
          key={a.ref}
          open={sessionTrails.length === 1}
        >
          <summary className="flex cursor-pointer items-baseline gap-3 py-3">
            <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
              Session trail
            </span>
            <span className="font-sans text-[14px] text-[color:var(--ink)]">
              steps leading up to the error
            </span>
          </summary>
          <div className="pb-4">
            <SessionTrailViewer attachmentRef={a.ref} eventId={eventId} />
          </div>
        </details>
      ))}
      {replays.map((a) => (
        <details
          className="mt-4 border-t border-[color:var(--rule)]"
          key={a.ref}
          open={replays.length === 1}
        >
          <summary className="flex cursor-pointer items-baseline gap-3 py-3">
            <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
              Session replay
            </span>
            <span className="font-sans text-[14px] text-[color:var(--ink)]">
              wireframe · up to 60 s pre-error
            </span>
          </summary>
          <div className="pb-4">
            <ReplayPlayer attachmentRef={a.ref} eventId={eventId} />
          </div>
        </details>
      ))}
      {stateSnapshots.map((a) => (
        <details
          className="mt-4 border-t border-[color:var(--rule)]"
          key={a.ref}
          open={stateSnapshots.length === 1}
        >
          <summary className="flex cursor-pointer items-baseline gap-3 py-3">
            <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
              State time-travel
            </span>
            <span className="font-sans text-[14px] text-[color:var(--ink)]">
              redux / zustand / manual snapshots
            </span>
          </summary>
          <div className="pb-4">
            <StateTimetravelViewer attachmentRef={a.ref} eventId={eventId} />
          </div>
        </details>
      ))}
      {openIdx !== null && openable.length > 0 && (
        <ScreenshotDebugCenter
          attachments={openable}
          eventId={eventId}
          onClose={() => setOpenIdx(null)}
          startIdx={openIdx}
        >
          {eventContext}
        </ScreenshotDebugCenter>
      )}
    </Frame>
  )
}

/** Section header lives outside the column container so its hairline
 *  spans the full attachment band. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <section className="space-y-1">
      <header className="sec-head">
        <span className="sec-head-num">06</span>
        <h2 className="sec-head-title">Captured at error</h2>
        <span className="sec-head-sub">attachments</span>
      </header>
      <div className="pt-3">{children}</div>
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
      className="group block transition-all"
      onClick={onOpen}
      title={`Open in debug center · ${attachment.source ?? 'unknown'}`}
      type="button"
    >
      <div className="overflow-hidden outline outline-1 outline-offset-0 outline-[color:var(--rule)] transition-colors group-hover:outline-[color:var(--accent)]">
        <img alt="Crash screenshot" className="block max-h-44 w-auto" loading="lazy" src={url} />
      </div>
      <div className="mt-1.5 font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase transition-colors group-hover:text-[color:var(--accent)]">
        screenshot
        {attachment.source && (
          <span className="ml-2 text-[color:var(--ink-muted)]">· {attachment.source}</span>
        )}
        <span className="ml-2 tracking-normal text-[color:var(--ink-muted)] normal-case group-hover:text-[color:var(--accent)]">
          ↗ open
        </span>
      </div>
    </button>
  )
}

function NonImageTile({
  attachment,
  onOpen,
}: {
  attachment: Attachment
  eventId: string
  onOpen: () => void
}) {
  return (
    <button
      className="flex flex-col items-start gap-1 border-l-2 border-[color:var(--rule)] px-3 py-2 text-[color:var(--ink-soft)] transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--ink)]"
      onClick={onOpen}
      title={`Open in debug center · ${attachment.kind}`}
      type="button"
    >
      <span className="font-mono text-[12px]">{attachment.kind}</span>
      {attachment.source && (
        <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
          {attachment.source}
        </span>
      )}
    </button>
  )
}

// Re-export DefRow so issue-detail can compose its own context block
// inline without importing two paths.
export { DefRow }

import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'

import { adminApi, type Attachment } from '@/api/client'

import { ReplayPlayer } from './ReplayPlayer'
import { ScreenshotDebugCenter, DefRow } from './ScreenshotDebugCenter'
import { SessionTrailViewer } from './SessionTrailViewer'
import { StateTimetravelViewer } from './StateTimetravelViewer'
import { ViewTreePanel } from './ViewTreePanel'
import { qk } from '@/api/query-keys'

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
  const accent = variant === 'danger' ? 'var(--color-danger)' : 'var(--color-accent)'
  return (
    <div className="border-t border-b px-0 py-3" style={{ borderColor: 'var(--color-border)' }}>
      <div
        className="mb-1.5 font-mono text-[10px] tracking-[0.22em] uppercase"
        style={{ color: accent }}
      >
        {title}
      </div>
      <div className="text-fg-secondary text-[13px]">{children}</div>
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
    // v1.1 #ux: keep the previous event's attachments rendered while
    // the new event's load is in flight. Without this every prev/next
    // press flashed the loading state and re-mounted the screenshot,
    // making the rail feel "noisy" when scrubbing.
    placeholderData: (prev) => prev,
    queryFn: () => adminApi.listEventAttachments(projectId, eventId),
    queryKey: qk.event.attachments(projectId, eventId),
    staleTime: 60_000,
  })
  // v1.1 polish-audit: stable identity for the attachments array. The
  // bare `data ?? []` fallback produced a fresh `[]` every render,
  // invalidating every downstream useMemo unnecessarily.
  const attachments = useMemo<Attachment[]>(() => data ?? [], [data])
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
  // v1.1 #ux: per-kind expanded/collapsed override. `undefined` means
  // "use the default (open iff length === 1)"; a boolean means the user
  // clicked the disclosure and we honour that across event scrubs.
  const [kindOpen, setKindOpen] = useState<{
    replay?: boolean
    sessionTrail?: boolean
    stateSnapshot?: boolean
    viewTree?: boolean
  }>({})

  if (isLoading && attachments.length === 0) {
    // First-time load only — placeholderData keeps subsequent
    // event-swaps from hitting this branch.
    return (
      <Frame>
        <p className="text-fg-muted text-[12px]">Loading attachments…</p>
      </Frame>
    )
  }
  if (error && attachments.length === 0) {
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
        // v1.1 #ux: list keys are index-based, not `ref`-based. The
        // attachment ref changes on every event swap, which would
        // unmount + remount the ScreenshotTile and reset its image
        // load state — manifesting as a blank flash. Index keys keep
        // the same tile component instance and let its internal
        // StableImage cross-fade between the old and new screenshot.
        <ul className="flex min-h-[176px] flex-wrap gap-4 pt-3">
          {screenshots.map((a, i) => (
            <li key={`shot-${i}`}>
              <ScreenshotTile attachment={a} eventId={eventId} onOpen={() => setOpenIdx(i)} />
            </li>
          ))}
          {others.map((a, i) => (
            <li key={`other-${i}`}>
              <NonImageTile
                attachment={a}
                eventId={eventId}
                onOpen={() => setOpenIdx(screenshots.length + i)}
              />
            </li>
          ))}
        </ul>
      )}
      {/* v1.1 #ux: index-based keys (not `a.ref`) so the <details>
       *  instance survives event swaps. Combined with the new
       *  user-toggle state below, a user who collapses View tree on
       *  event 1 stays collapsed across [ / ] scrubbing.
       *  `open` is controlled by `kindOpen` per kind — defaults to
       *  open when the kind has exactly one attachment (the common
       *  case) and respects subsequent user clicks. */}
      {viewTrees.map((a, i) => (
        <DetailsSlot
          isOpen={kindOpen.viewTree ?? viewTrees.length === 1}
          key={`viewTree-${i}`}
          label="View tree"
          onToggle={(open) => setKindOpen((m) => ({ ...m, viewTree: open }))}
          subtitle="at error"
          trailing={a.source ?? undefined}
        >
          <ViewTreePanel attachmentRef={a.ref} eventId={eventId} />
        </DetailsSlot>
      ))}
      {sessionTrails.map((a, i) => (
        <DetailsSlot
          isOpen={kindOpen.sessionTrail ?? sessionTrails.length === 1}
          key={`sessionTrail-${i}`}
          label="Session trail"
          onToggle={(open) => setKindOpen((m) => ({ ...m, sessionTrail: open }))}
          subtitle="steps leading up to the error"
        >
          <SessionTrailViewer attachmentRef={a.ref} eventId={eventId} />
        </DetailsSlot>
      ))}
      {replays.map((a, i) => (
        <DetailsSlot
          isOpen={kindOpen.replay ?? replays.length === 1}
          key={`replay-${i}`}
          label="Session replay"
          onToggle={(open) => setKindOpen((m) => ({ ...m, replay: open }))}
          subtitle="wireframe · up to 60 s pre-error"
        >
          <ReplayPlayer attachmentRef={a.ref} eventId={eventId} />
        </DetailsSlot>
      ))}
      {stateSnapshots.map((a, i) => (
        <DetailsSlot
          isOpen={kindOpen.stateSnapshot ?? stateSnapshots.length === 1}
          key={`stateSnapshot-${i}`}
          label="State time-travel"
          onToggle={(open) => setKindOpen((m) => ({ ...m, stateSnapshot: open }))}
          subtitle="redux / zustand / manual snapshots"
        >
          <StateTimetravelViewer attachmentRef={a.ref} eventId={eventId} />
        </DetailsSlot>
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

/**
 * v1.1 #ux — controlled disclosure that preserves the user's
 * expand/collapse choice across event scrubs. Native `<details
 * open={expr}>` re-applies the open attribute every render, which
 * reverts the user's click whenever the parent re-renders for an
 * unrelated reason. This component lifts the open state into the
 * parent's `kindOpen` map and only mutates it on user interaction.
 */
function DetailsSlot({
  children,
  isOpen,
  label,
  onToggle,
  subtitle,
  trailing,
}: {
  children: ReactNode
  isOpen: boolean
  label: string
  onToggle: (open: boolean) => void
  subtitle: string
  trailing?: string
}) {
  return (
    <div className="border-border mt-4 border-t">
      <button
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-baseline gap-3 py-3 text-left"
        onClick={() => onToggle(!isOpen)}
        type="button"
      >
        <span
          aria-hidden
          className="text-fg-muted font-mono text-[10px] tracking-[0.18em]"
          style={{ display: 'inline-block', width: 10 }}
        >
          {isOpen ? '▾' : '▸'}
        </span>
        <span className="text-accent font-mono text-[10px] tracking-[0.22em] uppercase">
          {label}
        </span>
        <span className="text-fg font-sans text-[14px]">{subtitle}</span>
        {trailing && (
          <span className="text-fg-muted ml-auto font-mono text-[10px] tracking-[0.18em] uppercase">
            {trailing}
          </span>
        )}
      </button>
      {isOpen && <div className="pb-4">{children}</div>}
    </div>
  )
}

/** Section header lives outside the column container so its hairline
 *  spans the full attachment band. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <section>
      <header className="sec-head">
        <h2 className="sec-head-title">Captured at error</h2>
        <span className="sec-head-sub">attachments</span>
      </header>
      <div>{children}</div>
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
      aria-label="Open screenshot in debug center"
      className="group inline-block max-w-full text-left transition-all"
      onClick={onOpen}
      title={`Open in debug center · ${attachment.source ?? 'unknown'}`}
      type="button"
    >
      <span className="outline-border group-hover:outline-accent block max-h-44 w-fit overflow-hidden outline outline-1 outline-offset-0 transition-colors">
        <StableImage alt="Crash screenshot" className="block max-h-44 w-auto" src={url} />
      </span>
      <span className="text-fg-muted group-hover:text-accent mt-1.5 block font-mono text-[10px] tracking-[0.18em] uppercase transition-colors">
        screenshot
        {attachment.source && <span className="text-fg-muted ml-2">· {attachment.source}</span>}
        <span className="text-fg-muted group-hover:text-accent ml-2 tracking-normal normal-case">
          ↗ open
        </span>
      </span>
    </button>
  )
}

/**
 * v1.1 #ux — image that holds the previously-rendered URL on screen
 * until the next URL fully decodes, then swaps. Eliminates the blank
 * flash when the parent re-renders with a new `src` (e.g. scrubbing
 * events in the issue-detail rail). Falls back to immediate swap on
 * decode error so a 404 doesn't strand stale content.
 */
function StableImage({ alt, className, src }: { alt: string; className?: string; src: string }) {
  const [shown, setShown] = useState(src)
  const lastSrcRef = useRef(src)
  useEffect(() => {
    if (src === lastSrcRef.current) return
    lastSrcRef.current = src
    let cancelled = false
    const img = new Image()
    const settle = () => {
      if (!cancelled) setShown(src)
    }
    img.onload = settle
    img.onerror = settle
    img.src = src
    return () => {
      cancelled = true
    }
  }, [src])
  return <img alt={alt} className={className} loading="lazy" src={shown} />
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
      className="border-border text-fg-secondary hover:border-accent hover:text-fg flex flex-col items-start gap-1 border-l-2 px-3 py-2 transition-colors"
      onClick={onOpen}
      title={`Open in debug center · ${attachment.kind}`}
      type="button"
    >
      <span className="font-mono text-[12px]">{attachment.kind}</span>
      {attachment.source && (
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          {attachment.source}
        </span>
      )}
    </button>
  )
}

// Re-export DefRow so issue-detail can compose its own context block
// inline without importing two paths.
export { DefRow }

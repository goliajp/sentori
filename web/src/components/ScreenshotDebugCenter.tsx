import { useEffect, useMemo, useState } from 'react'

import type { Attachment } from '@/api/client'

/**
 * Screenshot debug center — replaces the old image-only `<Lightbox>`.
 *
 * Layout (full-viewport):
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │  topbar — event id · attachment kind · close                   │
 *   ├──────────┬─────────────────────────────────────┬───────────────┤
 *   │ thumb    │                                     │ context       │
 *   │ rail     │   center: large screenshot          │ rail          │
 *   │          │   with zoom toggle [fit] / [1:1]    │               │
 *   │ s1       │                                     │ release       │
 *   │ s2 ▸     │                                     │ env / device  │
 *   │ s3       │                                     │ geo / flags   │
 *   │ ⎯⎯⎯⎯⎯⎯⎯  │                                     │ error.type    │
 *   │ trail    │                                     │ top frame     │
 *   │ tree     │                                     │ breadcrumbs   │
 *   │ replay   │                                     │ attachment    │
 *   │          │                                     │ meta          │
 *   └──────────┴─────────────────────────────────────┴───────────────┘
 *
 * Why a center page instead of a card-sized lightbox: when an
 * operator is staring at a crash screenshot, the question is never
 * "make the image bigger" — it's "what release / device / route / flag
 * was on screen when this happened, and what was the user doing the
 * second before?" Surfacing that metadata at the same eye-level as
 * the image collapses the debugging round trips.
 *
 * Right rail receives `<children>` so the issue-detail page can plug
 * in whatever context slot it already has — keeps this component
 * scope-free (no second event-detail fetch).
 */
export function ScreenshotDebugCenter({
  attachments,
  children,
  eventId,
  onClose,
  startIdx,
  topMeta,
}: {
  attachments: Attachment[]
  children?: React.ReactNode
  eventId: string
  onClose: () => void
  startIdx: number
  topMeta?: React.ReactNode
}) {
  const [idx, setIdx] = useState(startIdx)
  const [zoom, setZoom] = useState<'fit' | '1:1'>('fit')

  // Order: images first (the most-visually-driven category), then
  // others. Lets the operator step through screenshot → screenshot
  // → wireframe-replay-thumb in a coherent reading sequence.
  const ordered = useMemo(() => {
    const imgs = attachments.filter((a) => a.kind === 'screenshot')
    const rest = attachments.filter((a) => a.kind !== 'screenshot')
    return [...imgs, ...rest]
  }, [attachments])

  const active = ordered[idx] ?? null

  const step = (delta: number): void => {
    if (ordered.length === 0) return
    setIdx((cur) => (cur + delta + ordered.length) % ordered.length)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'j') step(+1)
      else if (e.key === 'ArrowLeft' || e.key === 'k') step(-1)
      else if (e.key === '0' || e.key === ' ') {
        e.preventDefault()
        setZoom((z) => (z === 'fit' ? '1:1' : 'fit'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ordered.length])

  if (!active) return null

  const url = `/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(active.ref)}`
  const isImage = active.kind === 'screenshot'

  return (
    <div
      aria-modal
      className="scrim fixed inset-0 z-50 flex flex-col"
      onClick={onClose}
      role="dialog"
    >
      <div className="flex h-full flex-col" onClick={(e) => e.stopPropagation()}>
        {/* ── Topbar ────────────────────────────────────────────────── */}
        <header className="border-border bg-bg flex items-center gap-6 border-b px-5 py-3">
          <span className="text-accent font-mono text-[11px] tracking-[0.2em] uppercase">
            Screenshot Debug
          </span>
          <span className="text-fg-secondary font-mono text-[12px] tabular-nums">
            event <span className="text-fg">{eventId.slice(0, 8)}</span>
          </span>
          <span className="text-fg-muted font-mono text-[11px] tracking-[0.18em] uppercase">
            {active.kind}
            {active.source && <span className="text-fg-secondary ml-2">· {active.source}</span>}
          </span>
          {topMeta && <div className="text-fg-secondary text-[12px]">{topMeta}</div>}
          <div className="ml-auto flex items-center gap-4 font-mono text-[11px]">
            <span className="text-fg-muted tracking-[0.1em]">
              {idx + 1} / {ordered.length}
            </span>
            {ordered.length > 1 && (
              <>
                <ToolbarButton onClick={() => step(-1)} title="Previous (←)">
                  ← prev
                </ToolbarButton>
                <ToolbarButton onClick={() => step(+1)} title="Next (→)">
                  next →
                </ToolbarButton>
              </>
            )}
            {isImage && (
              <>
                <span className="bg-border h-3 w-px" />
                <ToolbarButton
                  active={zoom === 'fit'}
                  onClick={() => setZoom('fit')}
                  title="Fit to viewport"
                >
                  fit
                </ToolbarButton>
                <ToolbarButton
                  active={zoom === '1:1'}
                  onClick={() => setZoom('1:1')}
                  title="Actual pixels (space)"
                >
                  1:1
                </ToolbarButton>
              </>
            )}
            <span className="bg-border h-3 w-px" />
            <a
              className="text-fg-secondary hover:text-fg tracking-[0.05em]"
              download
              href={url}
              rel="noopener noreferrer"
              target="_blank"
            >
              ↓ download
            </a>
            <ToolbarButton onClick={onClose} title="Close (esc)">
              ✕ esc
            </ToolbarButton>
          </div>
        </header>

        {/* ── Three-pane body ───────────────────────────────────────── */}
        <div className="divide-border bg-bg-secondary grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)_320px] divide-x">
          {/* Left: thumbnail rail with all attachments. */}
          <aside className="bg-bg overflow-y-auto">
            <RailGroup label="Screenshots">
              {ordered
                .filter((a) => a.kind === 'screenshot')
                .map((a, i) => (
                  <ThumbButton
                    active={ordered[idx]?.ref === a.ref}
                    eventId={eventId}
                    index={i}
                    key={a.ref}
                    onClick={() => setIdx(ordered.indexOf(a))}
                    ref_={a.ref}
                    source={a.source ?? undefined}
                  />
                ))}
            </RailGroup>
            {ordered.some((a) => a.kind !== 'screenshot') && (
              <RailGroup label="Other attachments">
                {ordered
                  .filter((a) => a.kind !== 'screenshot')
                  .map((a) => (
                    <NonImageRail
                      active={ordered[idx]?.ref === a.ref}
                      kind={a.kind}
                      key={a.ref}
                      onClick={() => setIdx(ordered.indexOf(a))}
                      source={a.source ?? undefined}
                    />
                  ))}
              </RailGroup>
            )}
          </aside>

          {/* Center: full-bleed image (or non-image fallback). */}
          <div className="relative min-w-0 overflow-auto">
            <div className="flex min-h-full items-center justify-center p-6">
              {isImage ? (
                zoom === 'fit' ? (
                  <img
                    alt="Crash screenshot"
                    className="block max-h-[calc(100vh-180px)] max-w-full"
                    src={url}
                    style={{
                      boxShadow: '0 24px 64px -24px rgb(from var(--color-fg) r g b / 0.35)',
                    }}
                  />
                ) : (
                  <img
                    alt="Crash screenshot (1:1)"
                    className="block"
                    src={url}
                    style={{
                      boxShadow: '0 24px 64px -24px rgb(from var(--color-fg) r g b / 0.35)',
                    }}
                  />
                )
              ) : (
                <a
                  className="text-fg-secondary hover:text-accent font-mono text-[12px] tracking-[0.18em] uppercase"
                  href={url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  open {active.kind} ↗
                </a>
              )}
            </div>
          </div>

          {/* Right: debug context. children slot from issue-detail. */}
          <aside className="bg-bg overflow-y-auto">
            <div className="border-border border-b px-5 py-3">
              <div className="text-accent font-mono text-[10px] tracking-[0.22em] uppercase">
                Debug context
              </div>
              <div
                className="text-fg mt-1 font-sans"
                style={{
                  fontVariationSettings: "'wdth' 100, 'opsz' 24, 'wght' 550",
                  fontSize: '15px',
                  letterSpacing: '-0.005em',
                }}
              >
                What was on screen
              </div>
            </div>
            <div className="space-y-5 px-5 py-4">
              {children ?? (
                <div className="text-fg-muted text-[12px]">
                  No context provided. The page that opened this debug center can pass an
                  event-context block via the
                  <code className="mx-1 font-mono">children</code>
                  prop.
                </div>
              )}
              {/* Attachment-meta block — always shown so the operator
               *  can correlate to server logs. */}
              <div className="border-border-muted border-t pt-4">
                <div className="text-accent mb-2 font-mono text-[10px] tracking-[0.22em] uppercase">
                  Attachment
                </div>
                <DefRow
                  label="ref"
                  value={<code className="text-[11px] break-all">{active.ref}</code>}
                />
                <DefRow label="kind" value={active.kind} />
                {active.mediaType && <DefRow label="media" value={active.mediaType} />}
                {active.sizeBytes !== undefined && (
                  <DefRow
                    label="size"
                    value={
                      <span className="tabular-nums">
                        {(active.sizeBytes / 1024).toFixed(1)} kb
                      </span>
                    }
                  />
                )}
                {active.source && <DefRow label="source" value={active.source} />}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}

function ToolbarButton({
  active,
  children,
  onClick,
  title,
}: {
  active?: boolean
  children: React.ReactNode
  onClick: () => void
  title?: string
}) {
  return (
    <button
      className={`font-mono tracking-[0.05em] transition-colors ${
        active ? 'text-accent' : 'text-fg-secondary hover:text-fg'
      }`}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  )
}

function RailGroup({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="border-border border-b px-4 py-3">
      <div className="text-fg-muted mb-2 font-mono text-[10px] tracking-[0.22em] uppercase">
        {label}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function ThumbButton({
  active,
  eventId,
  index,
  onClick,
  ref_,
  source,
}: {
  active: boolean
  eventId: string
  index: number
  onClick: () => void
  ref_: string
  source?: string
}) {
  const thumbUrl = `/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(ref_)}`
  return (
    <button
      className={`group block w-full text-left transition-all ${
        active ? '' : 'opacity-70 hover:opacity-100'
      }`}
      onClick={onClick}
      type="button"
    >
      <div
        className={`bg-bg-secondary relative w-full overflow-hidden ${
          active
            ? 'outline-accent outline outline-2 outline-offset-2'
            : 'outline-border outline outline-1 outline-offset-0'
        }`}
      >
        {/* Keep the screenshot's native aspect — phone shots are portrait,
         *  desktop shots are landscape. Letterboxing them into a square
         *  was hiding visual information. */}
        <img
          alt={`Screenshot ${index + 1}`}
          className="block h-auto w-full"
          loading="lazy"
          src={thumbUrl}
        />
        {active && (
          <div className="bg-accent text-bg absolute right-1 bottom-1 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.12em] uppercase">
            current
          </div>
        )}
      </div>
      <div className="text-fg-muted mt-1.5 flex items-center justify-between font-mono text-[10px] tracking-[0.05em]">
        <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>
        {source && <span className="uppercase">{source}</span>}
      </div>
    </button>
  )
}

function NonImageRail({
  active,
  kind,
  onClick,
  source,
}: {
  active: boolean
  kind: string
  onClick: () => void
  source?: string
}) {
  return (
    <button
      className={`block w-full border-l-2 px-2 py-1.5 text-left transition-colors ${
        active
          ? 'border-accent bg-accent/10 text-fg'
          : 'text-fg-secondary hover:bg-bg-secondary hover:text-fg border-transparent'
      }`}
      onClick={onClick}
      type="button"
    >
      <div className="font-mono text-[12px] tabular-nums">{kind}</div>
      {source && (
        <div className="text-fg-muted mt-0.5 font-mono text-[9px] tracking-[0.15em] uppercase">
          {source}
        </div>
      )}
    </button>
  )
}

/**
 * Definition row — `<label> · <value>` with a tabular grid so values
 * line up across N rows. Used inside the right-rail meta block and
 * re-exported for the issue-detail page to render the same shape.
 */
export function DefRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_1fr] items-baseline gap-3 py-1 text-[12px]">
      <div className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">{label}</div>
      <div className="text-fg font-mono break-words">{value}</div>
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * Phase 46 sub-D — render an event's `sessionTrail` attachment.
 *
 * The attachment payload is the JSON the SDK sealed at crash time
 * (see sdk/core/src/trail.ts):
 *
 *     {
 *       "sealedAt": "2026-05-14T01:02:03.456Z",
 *       "steps": [
 *         { "ts": 1715645234567, "label": "screen:Home",
 *           "breadcrumb": { "type": "navigation", "message": "/ → /home" } },
 *         ...
 *       ]
 *     }
 *
 * UI shape:
 *   - left rail: vertical timeline of step labels, click to focus.
 *   - right pane: details of the focused step (ts, label, breadcrumb,
 *     screenshot if `screenshotRef` is present).
 *   - keyboard: ← / → step through, ESC clears focus.
 *   - top right: relative-ts column ("3 s before crash") so the user
 *     gets temporal bearing without doing arithmetic.
 */

type TrailStep = {
  ts: number
  label: string
  breadcrumb?: { message: string; type: string }
  screenshotRef?: string
  viewTreeRef?: string
}

type SessionTrail = {
  sealedAt: string
  steps: TrailStep[]
}

async function fetchTrail(eventId: string, ref: string): Promise<SessionTrail> {
  const url = `/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(ref)}`
  const resp = await fetch(url, { credentials: 'include' })
  if (!resp.ok) throw new Error(`session trail ${resp.status}`)
  return (await resp.json()) as SessionTrail
}

export function SessionTrailViewer({
  attachmentRef,
  eventId,
}: {
  attachmentRef: string
  eventId: string
}) {
  const { data, error, isLoading } = useQuery({
    queryFn: () => fetchTrail(eventId, attachmentRef),
    queryKey: ['session-trail', eventId, attachmentRef],
    staleTime: Infinity,
  })

  const steps = useMemo(() => data?.steps ?? [], [data])
  // `focus` is "user override or null"; the derived `effectiveFocus`
  // defaults to the last step (closest to the crash) on first load
  // and on data churn, without ever calling setState in an effect.
  const [focus, setFocus] = useState<null | number>(null)
  const effectiveFocus = focus !== null ? focus : steps.length > 0 ? steps.length - 1 : null

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (steps.length === 0) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setFocus((cur) => {
          const base = cur ?? steps.length - 1
          return Math.max(0, base - 1)
        })
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setFocus((cur) => {
          const base = cur ?? steps.length - 1
          return Math.min(steps.length - 1, base + 1)
        })
      }
    },
    [steps.length]
  )
  useEffect(() => {
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onKey])

  const crashTs = useMemo(() => {
    if (steps.length === 0) return null
    return steps[steps.length - 1]!.ts
  }, [steps])

  if (isLoading) return <div className="text-fg-muted text-[11px]">Loading session trail…</div>
  if (error)
    return (
      <div className="text-[11px] text-[color:var(--color-danger)]">
        Failed to load session trail.
      </div>
    )
  if (steps.length === 0) return <div className="text-fg-muted text-[11px]">No steps recorded.</div>

  const focused = effectiveFocus === null ? null : (steps[effectiveFocus] ?? null)

  return (
    <div className="grid grid-cols-[200px_1fr] gap-3">
      <ol className="border-border max-h-[320px] overflow-y-auto rounded border" role="listbox">
        {steps.map((s, i) => (
          <li key={i}>
            <button
              aria-selected={effectiveFocus === i}
              className={`hover:bg-bg-tertiary/50 block w-full px-2 py-1 text-left text-[11px] ${
                effectiveFocus === i ? 'bg-bg-tertiary text-fg' : 'text-fg-muted'
              }`}
              onClick={() => setFocus(i)}
              type="button"
            >
              <span className="font-mono">{String(i + 1).padStart(2, '0')}</span>{' '}
              <span className="truncate">{s.label}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="border-border rounded border p-3 text-[12px]">
        {focused === null ? (
          <p className="text-fg-muted">Use ← / → or click a step.</p>
        ) : (
          <dl className="space-y-2">
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <dt className="text-fg-muted">Step</dt>
              <dd>
                {effectiveFocus !== null ? effectiveFocus + 1 : '?'} of {steps.length}
                {crashTs !== null && (
                  <span className="text-fg-muted ml-2">
                    ({relativeFromCrash(focused.ts, crashTs)})
                  </span>
                )}
              </dd>
              <dt className="text-fg-muted">Label</dt>
              <dd className="font-mono">{focused.label}</dd>
              {focused.breadcrumb && (
                <>
                  <dt className="text-fg-muted">Breadcrumb</dt>
                  <dd>
                    <span className="bg-bg-tertiary text-fg-muted rounded px-1 py-[1px] text-[10px] uppercase">
                      {focused.breadcrumb.type}
                    </span>{' '}
                    {focused.breadcrumb.message}
                  </dd>
                </>
              )}
              {focused.screenshotRef && (
                <>
                  <dt className="text-fg-muted">Screenshot</dt>
                  <dd>
                    <a
                      className="text-accent underline"
                      href={`/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(focused.screenshotRef)}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      open
                    </a>
                  </dd>
                </>
              )}
              {focused.viewTreeRef && (
                <>
                  <dt className="text-fg-muted">View tree</dt>
                  <dd>
                    <a
                      className="text-accent underline"
                      href={`/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(focused.viewTreeRef)}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      open
                    </a>
                  </dd>
                </>
              )}
            </div>
          </dl>
        )}
      </div>
    </div>
  )
}

function relativeFromCrash(ts: number, crashTs: number): string {
  const delta = crashTs - ts
  if (delta === 0) return 'at crash'
  if (delta < 1000) return `${delta} ms before`
  if (delta < 60_000) return `${(delta / 1000).toFixed(1)} s before`
  return `${(delta / 60_000).toFixed(1)} min before`
}

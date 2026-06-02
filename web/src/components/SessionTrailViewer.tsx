import { useQuery } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { qk } from '@/api/query-keys'

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
    placeholderData: (prev) => prev,
    queryFn: () => fetchTrail(eventId, attachmentRef),
    queryKey: qk.event.sessionTrail(eventId, attachmentRef),
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

  if (isLoading)
    return (
      <p className="border-y border-[color:var(--rule)] py-3 text-[12px] text-[color:var(--ink-soft)]">
        Loading session trail…
      </p>
    )
  if (error)
    return (
      <p className="border-y border-[color:var(--rule)] py-3 text-[12px] text-[color:var(--danger)]">
        Failed to load session trail.
      </p>
    )
  if (steps.length === 0)
    return (
      <p className="border-y border-[color:var(--rule)] py-3 text-[12px] text-[color:var(--ink-soft)]">
        No steps recorded.
      </p>
    )

  const focused = effectiveFocus === null ? null : (steps[effectiveFocus] ?? null)

  return (
    <div className="grid grid-cols-[200px_1fr] gap-4">
      <ol
        aria-label="Session trail steps"
        className="max-h-[320px] overflow-y-auto border-y border-[color:var(--rule)]"
        role="listbox"
      >
        {steps.map((s, i) => (
          <li key={i}>
            <button
              aria-selected={effectiveFocus === i}
              className={`block w-full border-b border-[color:var(--rule-soft)] px-2.5 py-1.5 text-left transition-colors last:border-b-0 ${
                effectiveFocus === i
                  ? 'bg-[color:var(--accent-soft)] text-[color:var(--ink)]'
                  : 'text-[color:var(--ink-soft)] hover:bg-[color:var(--paper-2)]'
              }`}
              onClick={() => setFocus(i)}
              type="button"
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[11px] text-[color:var(--ink-muted)] tabular-nums">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="truncate text-[12px]">{s.label}</span>
              </div>
            </button>
          </li>
        ))}
      </ol>
      <div className="border-y border-[color:var(--rule)] py-3 text-[12px]">
        {focused === null ? (
          <p className="text-[color:var(--ink-muted)]">Use ← / → or click a step.</p>
        ) : (
          <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-2">
            <Dt>Step</Dt>
            <dd className="text-[color:var(--ink)]">
              {effectiveFocus !== null ? effectiveFocus + 1 : '?'} of {steps.length}
              {crashTs !== null && (
                <span className="ml-2 font-mono text-[11px] text-[color:var(--ink-muted)]">
                  ({relativeFromCrash(focused.ts, crashTs)})
                </span>
              )}
            </dd>
            <Dt>Label</Dt>
            <dd className="font-mono text-[12px] text-[color:var(--ink)]">{focused.label}</dd>
            {focused.breadcrumb && (
              <>
                <Dt>Breadcrumb</Dt>
                <dd>
                  <span className="mr-1.5 inline-flex h-4 items-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-1.5 font-mono text-[9px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase">
                    {focused.breadcrumb.type}
                  </span>
                  <span className="text-[color:var(--ink)]">{focused.breadcrumb.message}</span>
                </dd>
              </>
            )}
            {focused.screenshotRef && (
              <>
                <Dt>Screenshot</Dt>
                <dd>
                  <a
                    className="font-mono text-[11px] tracking-[0.1em] text-[color:var(--accent)] uppercase hover:text-[color:var(--accent-strong)]"
                    href={`/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(focused.screenshotRef)}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    open ↗
                  </a>
                </dd>
              </>
            )}
            {focused.viewTreeRef && (
              <>
                <Dt>View tree</Dt>
                <dd>
                  <a
                    className="font-mono text-[11px] tracking-[0.1em] text-[color:var(--accent)] uppercase hover:text-[color:var(--accent-strong)]"
                    href={`/admin/api/events/${encodeURIComponent(eventId)}/attachments/${encodeURIComponent(focused.viewTreeRef)}`}
                    rel="noreferrer"
                    target="_blank"
                  >
                    open ↗
                  </a>
                </dd>
              </>
            )}
          </dl>
        )}
      </div>
    </div>
  )
}

function Dt({ children }: { children: React.ReactNode }) {
  return (
    <dt className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
      {children}
    </dt>
  )
}

function relativeFromCrash(ts: number, crashTs: number): string {
  const delta = crashTs - ts
  if (delta === 0) return 'at crash'
  if (delta < 1000) return `${delta} ms before`
  if (delta < 60_000) return `${(delta / 1000).toFixed(1)} s before`
  return `${(delta / 60_000).toFixed(1)} min before`
}

import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'

/**
 * Phase 50 sub-B6 — hover tooltip.
 *
 *     <Tooltip content="Copy as Markdown">
 *       <button>📋</button>
 *     </Tooltip>
 *
 * Wraps children in a `<span style="display:contents">` to hold ref
 * + handlers without forwarding through the consumer's tree.
 * Placement defaults to `top`; auto-flips to `bottom` when there
 * isn't enough room above. 80ms delay so quick brushes don't pop.
 *
 * No floating-ui dep — positions absolutely using bounding-rect
 * math. Sufficient for the dashboard's "what does this badge mean"
 * hints.
 */

type Placement = 'bottom' | 'top'

export function Tooltip({
  children,
  content,
  delay = 80,
  placement = 'top',
}: {
  children: ReactNode
  content: ReactNode
  delay?: number
  placement?: Placement
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<CSSProperties>({})
  const timerRef = useRef<number | undefined>(undefined)
  const wrapRef = useRef<HTMLSpanElement | null>(null)

  const recompute = useCallback(() => {
    const el = wrapRef.current?.firstElementChild as HTMLElement | null
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 6
    const wantTop = placement === 'top'
    const flip = wantTop && r.top < 40
    const top = (wantTop && !flip ? r.top - margin : r.bottom + margin) + window.scrollY
    setPos({
      left: r.left + r.width / 2 + window.scrollX,
      top,
      transform: `translate(-50%, ${wantTop && !flip ? '-100%' : '0'})`,
    })
  }, [placement])

  const show = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      recompute()
      setOpen(true)
    }, delay)
  }, [delay, recompute])

  const hide = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    setOpen(false)
  }, [])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  return (
    <>
      <span
        onBlur={hide}
        onFocus={show}
        onMouseEnter={show}
        onMouseLeave={hide}
        ref={wrapRef}
        style={{ display: 'contents' }}
      >
        {children}
      </span>
      {open && (
        <div
          className="border-border bg-bg-tertiary text-fg pointer-events-none fixed z-[70] max-w-xs rounded-md border px-2 py-1 text-[11px] leading-tight shadow-lg"
          role="tooltip"
          style={pos}
        >
          {content}
        </div>
      )}
    </>
  )
}

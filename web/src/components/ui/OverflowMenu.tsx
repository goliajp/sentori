import { type ReactNode, useEffect, useRef, useState } from 'react'

/**
 * Phase 49 sub-B — three-dots overflow menu for header secondary
 * actions. Replaces inline button rows that were cluttering issue
 * detail / list headers (Copy MD, Merge, debug toggles).
 *
 * The trigger button is keyboard-focusable; popover closes on
 * outside-click, Esc, and any inner-item click. Items are rendered
 * via children so callers compose `<button onClick=…>` directly —
 * keeps the API trivial and avoids defining a 1:1 schema mirror.
 */

export function OverflowMenu({
  ariaLabel = 'More actions',
  children,
}: {
  ariaLabel?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={wrapRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        className="text-fg-muted hover:bg-bg-tertiary hover:text-fg rounded-md px-2 py-1 text-[14px] leading-none"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        ⋯
      </button>
      {open && (
        <div
          className="border-border bg-bg-tertiary absolute right-0 z-50 mt-1 w-44 rounded-md border py-1 text-[12px] shadow-lg"
          onClick={() => setOpen(false)}
          role="menu"
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** Item helper — keeps menu rows visually consistent. */
export function OverflowItem({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      className={`block w-full px-3 py-1.5 text-left ${
        disabled
          ? 'text-fg-muted/40 cursor-not-allowed'
          : 'text-fg-muted hover:bg-bg-secondary hover:text-fg'
      }`}
      disabled={disabled}
      onClick={onClick}
      role="menuitem"
      type="button"
    >
      {children}
    </button>
  )
}

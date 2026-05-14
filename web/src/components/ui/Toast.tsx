import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'

/**
 * Phase 50 sub-B5 — toast notification system.
 *
 *     const toast = useToast()
 *     toast.success('Copied as Markdown')
 *     toast.error('Failed to resolve', { detail: err.message })
 *     toast.info('Webhook fired', { duration: 6000 })
 *
 * Toasts stack bottom-right, auto-dismiss after 3 s (override via
 * `duration`), and disappear instantly on click. State lives in a
 * context so any component below `<ToastProvider>` can fire one.
 *
 * Implementation is intentionally tiny — ~80 lines, no portal, no
 * external dep. Linear / Vercel both do similarly: 4-corner overlay
 * with css-keyframe entry animation, a single ring of recent toasts.
 */

type Tone = 'danger' | 'info' | 'success' | 'warning'

type ToastItem = {
  detail?: string
  duration?: number
  id: number
  message: string
  tone: Tone
}

type ToastContextShape = {
  push: (tone: Tone, message: string, opts?: { detail?: string; duration?: number }) => void
}

const ToastContext = createContext<null | ToastContextShape>(null)

let _toastSeq = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const push = useCallback<ToastContextShape['push']>(
    (tone, message, opts) => {
      const id = ++_toastSeq
      const duration = opts?.duration ?? 3000
      setItems((prev) => [...prev, { detail: opts?.detail, duration, id, message, tone }])
      if (duration > 0) {
        window.setTimeout(() => remove(id), duration)
      }
    },
    [remove]
  )

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        aria-atomic="false"
        aria-live="polite"
        className="pointer-events-none fixed right-4 bottom-4 z-[80] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      >
        {items.map((t) => (
          <ToastItemView key={t.id} onClose={() => remove(t.id)} toast={t} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const toneClass: Record<Tone, string> = {
  danger:
    'border-[color:var(--color-danger-border)] bg-[color:var(--color-danger-bg)] text-[color:var(--color-danger)]',
  info: 'border-[color:var(--color-info-border)] bg-[color:var(--color-info-bg)] text-[color:var(--color-info)]',
  success:
    'border-[color:var(--color-success-border)] bg-[color:var(--color-success-bg)] text-[color:var(--color-success)]',
  warning:
    'border-[color:var(--color-warning-border)] bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)]',
}
const toneIcon: Record<Tone, string> = {
  danger: '⊗',
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
}

function ToastItemView({ onClose, toast }: { onClose: () => void; toast: ToastItem }) {
  return (
    <button
      className={`sentori-toast pointer-events-auto flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-left text-[12px] leading-relaxed shadow-lg ${toneClass[toast.tone]}`}
      onClick={onClose}
      type="button"
    >
      <span aria-hidden className="mt-[1px] font-mono text-[13px] leading-none">
        {toneIcon[toast.tone]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-fg block font-medium">{toast.message}</span>
        {toast.detail && (
          <span className="text-fg-secondary mt-0.5 block text-[11px]">{toast.detail}</span>
        )}
      </span>
    </button>
  )
}

/** Hook surface — sugar around the raw `push`. */
export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    // Allow components that may render outside provider (tests) to
    // not crash; calls become silent no-ops.
    return {
      danger: () => {},
      error: () => {},
      info: () => {},
      success: () => {},
      warning: () => {},
    }
  }
  return {
    danger: (m: string, o?: { detail?: string; duration?: number }) => ctx.push('danger', m, o),
    error: (m: string, o?: { detail?: string; duration?: number }) => ctx.push('danger', m, o),
    info: (m: string, o?: { detail?: string; duration?: number }) => ctx.push('info', m, o),
    success: (m: string, o?: { detail?: string; duration?: number }) => ctx.push('success', m, o),
    warning: (m: string, o?: { detail?: string; duration?: number }) => ctx.push('warning', m, o),
  }
}

/** Phase 50 sub-B7 — top progress bar. Renders an indeterminate
 *  2px accent stripe at the top of the viewport whenever `show`
 *  is true. Mount once high in the tree and feed it from react-query's
 *  `isFetching`. */
export function TopProgress({ show }: { show: boolean }) {
  // Brief de-bounce: only show after 200ms so quick fetches don't
  // flash. Hide instantly when done.
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (show) {
      const id = window.setTimeout(() => setVisible(true), 200)
      return () => window.clearTimeout(id)
    }
    const raf = requestAnimationFrame(() => setVisible(false))
    return () => cancelAnimationFrame(raf)
  }, [show])
  if (!visible) return null
  return (
    <div aria-hidden className="sentori-top-progress">
      <div />
    </div>
  )
}

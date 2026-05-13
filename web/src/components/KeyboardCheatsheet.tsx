import { useEffect, useState } from 'react'

/**
 * Phase 28 sub-B: keyboard shortcut cheatsheet.
 *
 * `?` (no modifier) toggles the panel. The list is hand-curated so it
 * stays accurate — none of the dashboard's hotkeys live in a registry
 * we can introspect (they're per-component `useHotkeys` calls), so a
 * single source of truth would mean shoehorning the registry around
 * every hotkey site. We accept the small risk of drift in exchange
 * for keeping this surface flat.
 *
 * Mounted once at the layout. The `?` listener bails when an input,
 * textarea, or contentEditable owns the keyboard — so typing "?" in
 * a search box doesn't pop the panel.
 */

type Shortcut = { keys: string[]; label: string }
type Section = { items: Shortcut[]; title: string }

const SECTIONS: Section[] = [
  {
    items: [
      { keys: ['Cmd', 'K'], label: 'Open command palette (Ctrl+K on Win/Linux)' },
      { keys: ['?'], label: 'Toggle this cheatsheet' },
      { keys: ['Esc'], label: 'Close dialog / drawer / palette' },
    ],
    title: 'Global',
  },
  {
    items: [
      { keys: ['g', 'o'], label: 'Overview' },
      { keys: ['g', 'i'], label: 'Issues' },
      { keys: ['g', 't'], label: 'Traces' },
      { keys: ['g', 'r'], label: 'Releases' },
      { keys: ['g', 'm'], label: 'Teams' },
      { keys: ['g', 'a'], label: 'Alerts (admin only)' },
      { keys: ['g', 'u'], label: 'Audit (admin only)' },
      { keys: ['g', 's'], label: 'Settings' },
    ],
    title: 'Go to (press g, then the letter within 0.8 s)',
  },
  {
    items: [
      { keys: ['j'], label: 'Next issue' },
      { keys: ['k'], label: 'Previous issue' },
      { keys: ['Enter'], label: 'Open highlighted issue' },
      { keys: ['/'], label: 'Focus search input' },
      { keys: ['s'], label: 'Silence highlighted issue' },
      { keys: ['r'], label: 'Resolve highlighted issue (arms regression)' },
    ],
    title: 'Issues list',
  },
  {
    items: [
      { keys: ['['], label: 'Previous event' },
      { keys: [']'], label: 'Next event' },
      { keys: ['Esc'], label: 'Back to issues list' },
    ],
    title: 'Issue detail',
  },
]

export function KeyboardCheatsheet() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const t = e.target as HTMLElement | null
        const tag = t?.tagName
        const editing =
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          (t && (t as HTMLElement).isContentEditable)
        if (editing) return
        e.preventDefault()
        setOpen((v) => !v)
      } else if (e.key === 'Escape' && open) {
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
      role="dialog"
    >
      <div className="border-border bg-bg w-[28rem] max-w-[92vw] rounded-md border p-5 shadow-xl">
        <div className="flex items-baseline justify-between">
          <h2 className="text-fg text-[14px] font-semibold">Keyboard shortcuts</h2>
          <button
            aria-label="Close"
            className="text-fg-muted hover:text-fg text-[12px]"
            onClick={() => setOpen(false)}
            type="button"
          >
            esc
          </button>
        </div>
        <div className="mt-3 space-y-4">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h3 className="text-fg-muted text-[11px] tracking-wider uppercase">{s.title}</h3>
              <ul className="mt-1.5 space-y-1">
                {s.items.map((sc) => (
                  <li className="flex items-center justify-between text-[12px]" key={sc.label}>
                    <span className="text-fg">{sc.label}</span>
                    <span className="flex gap-1">
                      {sc.keys.map((k) => (
                        <kbd
                          className="border-border bg-bg-tertiary text-fg-muted rounded border px-1.5 py-0.5 font-mono text-[10px]"
                          key={k}
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

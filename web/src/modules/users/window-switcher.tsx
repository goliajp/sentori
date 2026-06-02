import { WINDOW_DAYS } from './window'

/**
 * v2.4 — shared time-window switcher for the Users module.
 *
 * Renders three pill links (1d / 7d / 30d). The visual matches the
 * tracking + uppercase tags used by the Audience TabSwitcher, so the
 * two modules feel like one product.
 *
 * Stateless — the parent owns the current value and writes through
 * `useUrlParam` so refresh / share keeps the selected window.
 */
export function WindowSwitcher({
  onChange,
  value,
}: {
  onChange: (next: number) => void
  value: number
}) {
  return (
    <div className="flex items-baseline gap-3 font-mono text-[11px] tracking-[0.18em] uppercase">
      {WINDOW_DAYS.map((w, i) => (
        <span key={w.days} className="flex items-baseline gap-3">
          {i > 0 && <span className="text-[color:var(--rule)]">/</span>}
          <button
            className={
              value === w.days
                ? 'text-[color:var(--accent)]'
                : 'text-[color:var(--ink-muted)] hover:text-[color:var(--ink-soft)]'
            }
            onClick={() => onChange(w.days)}
            type="button"
          >
            {w.label}
          </button>
        </span>
      ))}
    </div>
  )
}

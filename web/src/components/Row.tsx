/**
 * Label-value row — uppercase mono micro-tag label on the left,
 * value flush-right. Pulled out of 2 duplicate definitions (settings
 * + alerts) on 2026-05-23.
 *
 * The 120px column for the label is wide enough for the longest
 * label string in the dashboard ("display name", "trigger", etc.)
 * without burning visual real estate. Definition-list-style spacing:
 * label and value sit on the same baseline, hairline divider strip
 * between rows, first row gets a stronger top border to demarcate
 * the start of the group.
 */
export function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-baseline gap-x-4 border-b border-[color:var(--rule-soft)] py-2 first:border-t first:border-[color:var(--rule)]">
      <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </span>
      <span className="min-w-0 truncate text-[13px] text-[color:var(--ink)]">{children}</span>
    </div>
  )
}

/**
 * Large-number KPI card — uppercase mono tag label + a 28px sans
 * variation-axis-tuned numeric block + optional sub line. Pulled
 * out of 2 duplicate definitions (vitals + traces/detail-view)
 * on 2026-05-23.
 *
 *   ┌─────────────────────┐
 *   │ TAG                 │   ← t-tag, eyebrow
 *   │ 28px-bold value     │   ← optsz 48, wght 550, tabular nums
 *   │ secondary mono line │   ← optional sub
 *   └─────────────────────┘
 *
 * `highlight` repaints the value in `--accent` — used in traces
 * detail to flag the duration that owns the trace (longest span).
 * Default `--ink` is normal-weight foreground.
 *
 * The container uses the `.rule-cell` editorial primitive (defined
 * in index.css) which adds hairline dividers when N of these sit
 * side-by-side in a grid.
 */
export function Stat({
  highlight,
  label,
  sub,
  value,
}: {
  highlight?: boolean
  label: string
  sub?: React.ReactNode
  value: React.ReactNode
}) {
  return (
    <div className="rule-cell">
      <div className="t-tag">{label}</div>
      <div
        className={highlight ? 'mt-3 text-[color:var(--accent)]' : 'mt-3 text-[color:var(--ink)]'}
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: '28px',
          fontVariationSettings: "'wdth' 100, 'opsz' 48, 'wght' 550",
          letterSpacing: '-0.014em',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub != null && (
        <div className="mt-1.5 font-mono text-[11px] text-[color:var(--ink-muted)] tabular-nums">
          {sub}
        </div>
      )}
    </div>
  )
}

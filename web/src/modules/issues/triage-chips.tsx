// v1.2 W4 — priority + label visual primitives.
//
// Priority gradient mirrors ops vocabulary: p0 red, p1 amber, p2 yellow,
// p3 muted-grey (and is hidden in dense list views — operators don't
// need to be reminded that 95% of their backlog is "unranked").

import type { IssuePriority } from '@/api/client'

const PRIORITY_STYLE: Record<IssuePriority, string> = {
  p0: 'bg-danger/15 text-danger',
  p1: 'bg-warning/15 text-warning',
  p2: 'bg-info/15 text-info',
  p3: 'bg-bg-tertiary text-fg-muted',
}

export function PriorityChip({ priority }: { priority: IssuePriority }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider uppercase ${PRIORITY_STYLE[priority]}`}
      title={`Priority ${priority.toUpperCase()}`}
    >
      {priority}
    </span>
  )
}

export function LabelChip({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span className="bg-accent/10 text-accent inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] tracking-wide">
      {label}
      {onRemove && (
        <button
          aria-label={`Remove label ${label}`}
          className="text-accent/70 hover:text-accent"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove()
          }}
          type="button"
        >
          ×
        </button>
      )}
    </span>
  )
}

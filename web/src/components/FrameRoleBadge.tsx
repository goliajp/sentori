import type { FrameRole } from '@/lib/frame-role'

/**
 * Phase 42 sub-A.08 — small colour-coded chip next to a frame's
 * function name, so you can scan a stack and see "this is mine" vs
 * "this is React Native internals" at a glance.
 *
 * Colours:
 *   you        — accent (purple) on accent-tinted background
 *   framework  — sky-blue
 *   lib        — neutral grey on muted background
 *   boundary   — amber (reserved for Phase 42 sub-A4)
 *   unknown    — same as lib visually; kept distinct in code for
 *                future "still classifying" badges
 */

type Props = {
  role: FrameRole
  /** Optional label override — by default the role name is shown. */
  label?: string
}

const STYLE: Record<FrameRole, string> = {
  boundary: 'bg-amber-500/10 text-amber-300',
  framework: 'bg-sky-500/10 text-sky-300',
  lib: 'bg-fg-muted/10 text-fg-muted',
  unknown: 'bg-fg-muted/10 text-fg-muted',
  you: 'bg-accent/10 text-accent',
}

export function FrameRoleBadge({ label, role }: Props) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] tracking-wider uppercase ${STYLE[role]}`}
    >
      {label ?? role}
    </span>
  )
}

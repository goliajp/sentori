import type { FrameRole } from '@/lib/frame-role'

/**
 * Frame-role chip next to a function name. Uses the designed semantic
 * palette triples (bg/text/border) so both light and dark modes have
 * real contrast — alpha-on-accent was washing the FRAMEWORK chip out
 * to invisibility on dark.
 *
 *   you        — accent (the "this is mine" signal)
 *   framework  — info (sky / steel — readable, not screaming)
 *   lib        — paper-2 fill on ink-muted text
 *   boundary   — warning (amber — Phase 42 sub-A4 reservation)
 *   unknown    — same visual as lib; kept distinct for future use
 */

type Props = {
  role: FrameRole
  /** Optional label override — by default the role name is shown. */
  label?: string
}

const STYLE: Record<FrameRole, string> = {
  boundary: 'bg-warning/15 text-warning border-warning/30',
  framework: 'bg-info/15 text-info border-info/30',
  lib: 'bg-bg-secondary text-fg-muted border-border',
  unknown: 'bg-bg-secondary text-fg-muted border-border',
  you: 'bg-accent/10 text-accent border-accent',
}

export function FrameRoleBadge({ label, role }: Props) {
  return (
    <span
      className={`inline-flex shrink-0 items-center border px-1.5 py-0.5 font-mono text-[10px] tracking-[0.14em] uppercase ${STYLE[role]}`}
    >
      {label ?? role}
    </span>
  )
}

// The five-kind color system — one stable hue per kind, used
// everywhere a kind appears (Inbox, detail, Instruments) so the
// palette itself teaches the concept model.

import type { IssueSummary } from '../lib/api';

export const KIND_COLOR: Record<IssueSummary['kind'], string> = {
  error: '#ff5d5d',
  warn: '#ffb340',
  trace: '#7fa7c9',
  assert: '#b18cff',
  probe: '#4cd97b',
};

export function KindBadge({ kind }: { kind: IssueSummary['kind'] }) {
  const c = KIND_COLOR[kind];
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 font-mono text-[11px] font-medium"
      style={{ backgroundColor: `${c}1f`, color: c }}
    >
      {kind}
    </span>
  );
}

export function RegressedBadge() {
  return (
    <span className="inline-block rounded bg-[#ff5d5d] px-1.5 py-0.5 text-[11px] font-semibold text-black">
      REGRESSED
    </span>
  );
}

/** breadth × depth, the objective importance pair, in mono. */
export function ImpactCell({
  users,
  maxPerUser,
  events,
}: {
  users: number;
  maxPerUser: number;
  events: number;
}) {
  return (
    <span className="font-mono text-xs tabular-nums opacity-80">
      {users}u×{maxPerUser} · {events}ev
    </span>
  );
}

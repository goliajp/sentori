import type { OrgRole, TeamRole } from '@/api/client'

const ROLE_STYLES: Record<OrgRole | TeamRole, string> = {
  admin: 'bg-accent/15 text-accent ring-accent/30',
  lead: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  member: 'bg-fg/10 text-fg-muted ring-fg/20',
  owner: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
}

export function RoleBadge({ role }: { role: OrgRole | TeamRole }) {
  const cls = ROLE_STYLES[role]
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase ring-1 ${cls}`}
    >
      {role}
    </span>
  )
}

import type { OrgRole, TeamRole } from '@/api/client'

const ROLE_STYLES: Record<OrgRole | TeamRole, string> = {
  admin: 'bg-accent/15 text-accent ring-accent/30',
  lead: 'bg-[color:var(--color-warning-bg)] text-[color:var(--color-warning)] ring-[color:var(--color-warning-border)]',
  member: 'bg-fg/10 text-fg-muted ring-fg/20',
  owner:
    'bg-[color:var(--color-success-bg)] text-[color:var(--color-success)] ring-[color:var(--color-success-border)]',
  viewer: 'bg-bg-tertiary text-fg-muted ring-border',
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

import { Link, useLocation, useParams } from 'react-router'

import type { ModuleDef } from '@/modules/registry'

import { useOrg } from '@/auth/orgContext'
import { useAuth } from '@/auth/state'
import { GROUPS, MODULES, modulesInGroup, PINNED_MODULE } from '@/modules/registry'
import { VERSION_LABEL } from '@/version'

void MODULES

/**
 * Left navigation rail. tasks.golia.jp / devops.golia.jp pattern:
 *
 *   • Whole rail gets uniform `p-3` so links never crash the edges
 *   • Every link is a rounded pill (px-2 py-1). Active = accent-tinted
 *     bg + accent text. Inactive = full-fg + dimmed icon.
 *   • Sections separated by whitespace (mb-5), not a `border-b`.
 *   • Section title `px-2` to align with link text.
 *   • Overview pinned (sits in a title-less Section at the top).
 *
 * Reads modules from `modules/registry.tsx` so adding a new module only
 * touches the registry + that module's dir, never this file.
 */
export function Sidebar() {
  const { currentOrg } = useOrg()
  const { logout, user } = useAuth()
  const isAdmin = currentOrg.role === 'owner' || currentOrg.role === 'admin'

  return (
    <aside className="border-border bg-bg/60 hidden w-56 shrink-0 flex-col overflow-hidden border-r md:flex">
      <div className="flex-1 overflow-y-auto p-3">
        <Section>
          <SideLink module={PINNED_MODULE} orgSlug={currentOrg.slug} />
        </Section>

        {GROUPS.map((g) => {
          const visible = modulesInGroup(g.id).filter((m) => !m.adminOnly || isAdmin)
          if (visible.length === 0) return null
          return (
            <Section key={g.id} title={g.label}>
              {visible.map((m) => (
                <SideLink key={m.id} module={m} orgSlug={currentOrg.slug} />
              ))}
            </Section>
          )
        })}
      </div>

      <div className="border-border/60 border-t p-3">
        <UserMenu email={user?.email ?? null} onLogout={() => void logout()} />
        <div className="text-fg-muted/60 t-sm mt-1 px-1 font-mono tabular-nums">
          {VERSION_LABEL}
        </div>
      </div>
    </aside>
  )
}

function Section({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="mb-5 last:mb-0">
      {title && (
        <div className="text-fg-muted t-sm mb-1 px-2 font-semibold tracking-wider uppercase">
          {title}
        </div>
      )}
      <div className="space-y-px">{children}</div>
    </div>
  )
}

function SideLink({ module, orgSlug }: { module: ModuleDef; orgSlug: string }) {
  const location = useLocation()
  const target = `/org/${orgSlug}/${module.path}`
  const active = location.pathname === target || location.pathname.startsWith(`${target}/`)
  return (
    <Link
      className={`t-md block truncate rounded px-2 py-1 transition-colors ${
        active ? 'bg-accent/10 text-accent' : 'text-fg hover:bg-bg-tertiary'
      }`}
      to={target}
    >
      <span className={`mr-2 inline-flex align-[-2px] ${active ? '' : 'text-fg-muted'}`}>
        <NavIcon path={module.iconPath} />
      </span>
      {module.label}
    </Link>
  )
}

function NavIcon({ path }: { path: string }) {
  return (
    <svg
      aria-hidden
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 24 24"
    >
      <path d={path} />
    </svg>
  )
}

function UserMenu({ email, onLogout }: { email: null | string; onLogout: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <span className="text-fg t-md truncate">{email ?? 'account'}</span>
      <button
        className="text-fg-muted hover:text-fg t-sm"
        onClick={onLogout}
        title="Sign out"
        type="button"
      >
        ⎋
      </button>
    </div>
  )
}

/**
 * Bridge so legacy imports (`useParams<{ slug }>()`) inside views can
 * still reach the current org slug without re-plumbing.
 */
export function useOrgSlug(): string {
  const { slug } = useParams<{ slug: string }>()
  return slug ?? ''
}

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation } from 'react-router'

import type { OrgRow, ProjectRow, TeamRow } from '@/api/client'
import { useDensity } from '@/lib/density'
import { VERSION_LABEL } from '@/version'

import { OnboardingBadge } from './OnboardingBadge'
import { OrgSwitcher } from './OrgSwitcher'
import { RoleBadge } from './RoleBadge'

/**
 * Left navigation rail — tasks.golia.jp pattern.
 *
 *   • Whole rail gets uniform `p-3` so links never crash into the edges
 *   • Every link is a rounded pill (`px-2 py-1`). Active = accent-tinted
 *     bg + accent text. Inactive = full-foreground text with a dimmed
 *     icon — the eye reads "active link is the blue one" before reading
 *     labels.
 *   • Links inside a section sit at `space-y-px` (1px microgap).
 *   • Between groups: `mb-5` whitespace, NOT a `border-b` hairline. Hard
 *     rules between groups read as enterprise chrome; whitespace reads
 *     as Linear/Vercel-grade.
 *   • Group titles `px-2` so the label aligns with link text (one column,
 *     two weights).
 *   • Overview pins at the top with no group title (`Section without
 *     title`) so it sits separated from Monitor/Organize by whitespace.
 *
 * The brand wordmark moved to the Toolbar. The theme toggle moved to the
 * Toolbar. This rail focuses on navigation + identity + preferences.
 */

type IconKind =
  | 'alerts'
  | 'audit'
  | 'integrations'
  | 'issues'
  | 'overview'
  | 'releases'
  | 'settings'
  | 'teams'
  | 'traces'

type NavItem = { adminOnly?: boolean; icon: IconKind; label: string; path: IconKind }

const PINNED: NavItem = { icon: 'overview', label: 'Overview', path: 'overview' }
const MONITOR: NavItem[] = [
  { icon: 'issues', label: 'Issues', path: 'issues' },
  { icon: 'traces', label: 'Traces', path: 'traces' },
  { icon: 'releases', label: 'Releases', path: 'releases' },
  { adminOnly: true, icon: 'alerts', label: 'Alerts', path: 'alerts' },
]
const ORGANIZE: NavItem[] = [
  { icon: 'teams', label: 'Teams', path: 'teams' },
  { adminOnly: true, icon: 'integrations', label: 'Integrations', path: 'integrations' },
  { adminOnly: true, icon: 'audit', label: 'Audit', path: 'audit' },
  { icon: 'settings', label: 'Settings', path: 'settings' },
]

/** 16px stroke icons (currentColor) — keeps bundle tiny, no icon dep. */
function NavIcon({ kind }: { kind: IconKind }) {
  const p = (() => {
    switch (kind) {
      case 'alerts':
        return 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0'
      case 'audit':
        return 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h8M8 9h2'
      case 'integrations':
        return 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'
      case 'issues':
        return 'M10.3 3.3a2 2 0 0 1 3.4 0l8 14a2 2 0 0 1-1.7 3H3.99a2 2 0 0 1-1.7-3zM12 9v4M12 17h.01'
      case 'overview':
        return 'M3 3h8v8H3zM13 3h8v5h-8zM13 12h8v9h-8zM3 15h8v6H3z'
      case 'releases':
        return 'm12.83 2.18 7 3.12A2 2 0 0 1 21 7.12v9.76a2 2 0 0 1-1.17 1.82l-7 3.12a2 2 0 0 1-1.66 0l-7-3.12A2 2 0 0 1 3 16.88V7.12A2 2 0 0 1 4.17 5.3l7-3.12a2 2 0 0 1 1.66 0M3.3 7l8.7 4 8.7-4M12 22V11'
      case 'settings':
        return 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'
      case 'teams':
        return 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M12 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75'
      case 'traces':
        return 'M3 6h18M3 12h13M3 18h9'
    }
  })()
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
      <path d={p} />
    </svg>
  )
}

type SidebarProps = {
  currentOrg: OrgRow
  currentProject: null | ProjectRow
  currentTeamSlug: null | string
  onLogout: () => void
  orgs: OrgRow[]
  teams: TeamRow[]
  user: { email?: string } | null
}

type ContentProps = SidebarProps & {
  collapsed: boolean
  onToggleCollapsed: () => void
}

function SideLink({
  collapsed,
  item,
  orgSlug,
}: {
  collapsed: boolean
  item: NavItem
  orgSlug: string
}) {
  const location = useLocation()
  const active = location.pathname.startsWith(`/org/${orgSlug}/${item.path}`)

  if (collapsed) {
    return (
      <Link
        className={`flex items-center justify-center rounded-md p-2 transition-colors ${
          active ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
        }`}
        title={item.label}
        to={`/org/${orgSlug}/${item.path}`}
      >
        <NavIcon kind={item.icon} />
      </Link>
    )
  }

  return (
    <Link
      className={`t-md block truncate rounded px-2 py-1 transition-colors ${
        active ? 'bg-accent/10 text-accent' : 'text-fg hover:bg-bg-tertiary'
      }`}
      to={`/org/${orgSlug}/${item.path}`}
    >
      <span
        className={`mr-2 inline-flex align-[-2px] ${active ? '' : 'text-fg-muted'}`}
        // Render the same SVG inline so vertical alignment matches a
        // pure-text adjacent label without flex gymnastics.
      >
        <NavIcon kind={item.icon} />
      </span>
      {item.label}
    </Link>
  )
}

function Section({
  children,
  collapsed,
  title,
}: {
  children: React.ReactNode
  collapsed?: boolean
  title?: string
}) {
  return (
    <div className="mb-5 last:mb-0">
      {title && !collapsed && (
        <div className="text-fg-muted t-sm mb-1 px-2 font-semibold tracking-wider uppercase">
          {title}
        </div>
      )}
      <div className="space-y-px">{children}</div>
    </div>
  )
}

function SidebarContent({
  collapsed,
  currentOrg,
  currentProject,
  currentTeamSlug,
  onLogout,
  onToggleCollapsed,
  orgs,
  teams,
  user,
}: ContentProps) {
  const { density, toggle: toggleDensity } = useDensity()
  const isAdmin = currentOrg.role === 'owner' || currentOrg.role === 'admin'

  return (
    <div className={`flex h-full w-full flex-col ${collapsed ? 'px-1.5 py-3' : 'p-3'}`}>
      {/* Identity — org switcher + onboarding nudge. The brand wordmark
       *  lives in the Toolbar; we don't repeat it here. */}
      {collapsed ? (
        <Link
          className="text-fg hover:bg-bg-tertiary mb-3 flex justify-center rounded-md p-2 text-sm font-semibold"
          title={currentOrg.name}
          to={`/org/${currentOrg.slug}/overview`}
        >
          {currentOrg.slug.slice(0, 2).toUpperCase()}
        </Link>
      ) : (
        <div className="mb-3">
          <div className="mb-1 flex items-center justify-between gap-2 px-1">
            <div className="text-fg-muted t-sm font-semibold tracking-wider uppercase">
              Organization
            </div>
            <OnboardingBadge project={currentProject} />
          </div>
          <OrgSwitcher
            current={currentOrg}
            currentTeamSlug={currentTeamSlug}
            orgs={orgs}
            teams={teams}
          />
        </div>
      )}

      {/* Nav — three sections separated by whitespace, not borders. */}
      <div className="flex-1 overflow-y-auto">
        <Section collapsed={collapsed}>
          <SideLink collapsed={collapsed} item={PINNED} orgSlug={currentOrg.slug} />
        </Section>

        <Section collapsed={collapsed} title="Monitor">
          {MONITOR.filter((i) => !i.adminOnly || isAdmin).map((i) => (
            <SideLink collapsed={collapsed} item={i} key={i.path} orgSlug={currentOrg.slug} />
          ))}
        </Section>

        <Section collapsed={collapsed} title="Organize">
          {ORGANIZE.filter((i) => !i.adminOnly || isAdmin).map((i) => (
            <SideLink collapsed={collapsed} item={i} key={i.path} orgSlug={currentOrg.slug} />
          ))}
        </Section>
      </div>

      {/* Footer — account + preferences. Theme toggle moved to Toolbar. */}
      <div className="border-border/60 mt-3 border-t pt-3">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <button
              aria-label="Expand sidebar"
              className="text-fg-muted hover:bg-bg-tertiary hover:text-fg rounded-md px-2 py-1 text-xs"
              onClick={onToggleCollapsed}
              title="Expand sidebar"
              type="button"
            >
              »
            </button>
            <UserMenuButton collapsed onLogout={onLogout} role={currentOrg.role} user={user} />
          </div>
        ) : (
          <>
            <UserMenuButton onLogout={onLogout} role={currentOrg.role} user={user} />
            <div className="mt-1 flex items-center gap-1 px-1">
              <button
                aria-label={`Density: ${density}. Click to toggle.`}
                className="text-fg-muted hover:bg-bg-tertiary hover:text-fg rounded-md px-2 py-1 text-xs"
                onClick={toggleDensity}
                title={`Density: ${density} — click to toggle`}
                type="button"
              >
                {density === 'ultra' ? '☷' : density === 'compact' ? '☰' : '≡'}
              </button>
              <button
                aria-label="Collapse sidebar"
                className="text-fg-muted hover:bg-bg-tertiary hover:text-fg ml-auto rounded-md px-2 py-1 text-xs"
                onClick={onToggleCollapsed}
                title="Collapse sidebar"
                type="button"
              >
                «
              </button>
            </div>
            <div
              className="text-fg-muted/50 t-sm mt-1 px-2 font-mono tracking-tight"
              title="Build version + git sha"
            >
              {VERSION_LABEL}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Popover account menu — closed state shows email + role, open state
 *  surfaces "My activity" + "Sign out". Outside-click + Esc close it. */
function UserMenuButton({
  collapsed,
  onLogout,
  role,
  user,
}: {
  collapsed?: boolean
  onLogout: () => void
  role: OrgRow['role']
  user: { email?: string } | null
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={wrapRef}>
      <button
        aria-expanded={open}
        aria-label={`Account menu (${user?.email ?? 'account'})`}
        className={
          collapsed
            ? 'text-fg-muted hover:bg-bg-tertiary hover:text-fg rounded-md px-2 py-1 text-xs'
            : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg t-md flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5'
        }
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        {collapsed ? (
          '⎋'
        ) : (
          <>
            <span className="truncate">{user?.email ?? 'account'}</span>
            <RoleBadge role={role} />
          </>
        )}
      </button>
      {open && (
        <div
          className="border-border bg-bg-tertiary t-md absolute right-0 bottom-full z-50 mb-1 w-44 rounded-md border py-1 shadow-lg"
          role="menu"
        >
          <Link
            className="text-fg-muted hover:bg-bg-secondary hover:text-fg block px-3 py-1.5"
            onClick={() => setOpen(false)}
            role="menuitem"
            to="/me/activity"
          >
            My activity
          </Link>
          <div className="border-border/60 my-1 border-t" />
          <button
            className="text-fg-muted hover:bg-bg-secondary hover:text-fg block w-full px-3 py-1.5 text-left"
            onClick={onLogout}
            role="menuitem"
            type="button"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

const COLLAPSED_KEY = 'sentori:ui:sidebar-collapsed:v1'
function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}
function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0')
  } catch {
    // best-effort
  }
}

export function Sidebar(props: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(() => readCollapsed())
  const { pathname } = useLocation()
  useEffect(() => {
    // Close the drawer whenever the route changes — a deliberate
    // react-to-external-change, not a render-derived value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMobileOpen(false)
  }, [pathname])
  const toggle = () => {
    setCollapsed((v) => {
      writeCollapsed(!v)
      return !v
    })
  }
  return (
    <>
      <aside
        className={`border-border bg-bg/60 hidden shrink-0 border-r md:flex ${
          collapsed ? 'w-14' : 'w-56'
        }`}
      >
        <SidebarContent {...props} collapsed={collapsed} onToggleCollapsed={toggle} />
      </aside>

      <button
        aria-label="Open navigation"
        className="border-border bg-bg/80 text-fg-muted hover:text-fg fixed top-2 left-2 z-30 rounded-md border px-2 py-1 text-sm backdrop-blur-xl md:hidden"
        onClick={() => setMobileOpen(true)}
        type="button"
      >
        ☰
      </button>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <aside className="border-border bg-bg relative w-64 border-r shadow-xl">
            <button
              aria-label="Close navigation"
              className="text-fg-muted hover:text-fg absolute top-2 right-2 z-10 rounded-md px-2 py-1 text-sm"
              onClick={() => setMobileOpen(false)}
              type="button"
            >
              ✕
            </button>
            <SidebarContent {...props} collapsed={false} onToggleCollapsed={toggle} />
          </aside>
          <div className="bg-black/30" onClick={() => setMobileOpen(false)} style={{ flex: 1 }} />
        </div>
      )}
    </>
  )
}

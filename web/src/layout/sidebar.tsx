import { Link, useLocation } from 'react-router'

import type { ModuleDef } from '@/modules/registry'

import { useOrg } from '@/auth/orgContext'
import { useAuth } from '@/auth/state'
import { GROUPS, modulesInGroup, PINNED_MODULE } from '@/modules/registry'

/**
 * Editorial nav rail — paper background, mono-numbered group titles,
 * hairline section dividers (no rounded pills, no accent-tinted bg
 * blobs). Active module marked by a left tora accent strip + ink-on-
 * paper-2 fill.
 *
 *   01 / overview
 *
 *   ── monitor ────
 *   issues
 *   traces
 *   ▎ metrics       ← active: 2px accent strip + paper-2 bg
 *   vitals
 *   …
 *
 *   ── organize ──
 *   teams
 *   integrations
 *   …
 */
export function Sidebar() {
  const { currentOrg } = useOrg()
  const { logout, user } = useAuth()
  const isAdmin = currentOrg.role === 'owner' || currentOrg.role === 'admin'

  return (
    <aside className="hidden w-56 shrink-0 flex-col overflow-hidden border-r border-[color:var(--rule)] bg-[color:var(--paper)] md:flex">
      <div className="flex-1 overflow-y-auto py-2">
        <Section>
          <SideLink module={PINNED_MODULE} orgSlug={currentOrg.slug} />
        </Section>

        {GROUPS.map((g, gIdx) => {
          const visible = modulesInGroup(g.id).filter((m) => !m.adminOnly || isAdmin)
          if (visible.length === 0) return null
          return (
            <Section key={g.id} num={String(gIdx + 1).padStart(2, '0')} title={g.label}>
              {visible.map((m) => (
                <SideLink key={m.id} module={m} orgSlug={currentOrg.slug} />
              ))}
            </Section>
          )
        })}
      </div>

      <div className="border-t border-[color:var(--rule)] bg-[color:var(--paper-2)] px-4 py-3">
        <UserMenu email={user?.email ?? null} onLogout={() => void logout()} />
      </div>
    </aside>
  )
}

function Section({
  children,
  num,
  title,
}: {
  children: React.ReactNode
  num?: string
  title?: string
}) {
  return (
    <div className="mb-1 last:mb-0">
      {title && (
        <div className="flex items-baseline gap-2 border-t border-[color:var(--rule-soft)] px-4 pt-4 pb-2">
          {num && (
            <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)]">
              {num}
            </span>
          )}
          <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
            {title}
          </span>
        </div>
      )}
      <div>{children}</div>
    </div>
  )
}

function SideLink({ module, orgSlug }: { module: ModuleDef; orgSlug: string }) {
  const location = useLocation()
  const target = `/org/${orgSlug}/${module.path}`
  const active = location.pathname === target || location.pathname.startsWith(`${target}/`)
  return (
    <Link
      className={`group relative block py-1.5 pr-3 pl-4 transition-colors ${
        active
          ? 'bg-[color:var(--paper-2)] text-[color:var(--ink)]'
          : 'text-[color:var(--ink-soft)] hover:bg-[color:var(--paper-2)]/60 hover:text-[color:var(--ink)]'
      }`}
      to={target}
    >
      {/* Left accent strip when active. */}
      <span
        aria-hidden
        className={`absolute top-0 bottom-0 left-0 w-[2px] ${
          active ? 'bg-[color:var(--accent)]' : 'bg-transparent'
        }`}
      />
      <span className="flex items-center gap-2.5 text-[13px]">
        <NavIcon path={module.iconPath} active={active} />
        <span className="truncate">{module.label}</span>
      </span>
    </Link>
  )
}

function NavIcon({ active, path }: { active: boolean; path: string }) {
  return (
    <svg
      aria-hidden
      className={`h-3.5 w-3.5 shrink-0 ${
        active ? 'text-[color:var(--accent)]' : 'text-[color:var(--ink-muted)]'
      }`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      <path d={path} />
    </svg>
  )
}

function UserMenu({ email, onLogout }: { email: null | string; onLogout: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="truncate font-mono text-[11px] text-[color:var(--ink-soft)]">
        {email ?? 'account'}
      </span>
      <button
        className="font-mono text-[11px] text-[color:var(--ink-muted)] transition-colors hover:text-[color:var(--accent)]"
        onClick={onLogout}
        title="Sign out"
        type="button"
      >
        ⎋ sign out
      </button>
    </div>
  )
}

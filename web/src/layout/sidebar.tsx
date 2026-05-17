import { Link, useLocation, useNavigate } from 'react-router'

import type { OrgRow, ProjectRow } from '@/api/client'
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
  const { currentOrg, currentProject, orgs, projects } = useOrg()
  const { logout, user } = useAuth()
  const isAdmin = currentOrg.role === 'owner' || currentOrg.role === 'admin'

  return (
    <aside className="hidden w-56 shrink-0 flex-col overflow-hidden border-r border-[color:var(--rule)] bg-[color:var(--paper)] md:flex">
      <ContextBlock
        currentOrg={currentOrg}
        currentProject={currentProject}
        orgs={orgs}
        projects={projects}
      />

      <div className="flex-1 overflow-y-auto py-2">
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

      <div className="border-t border-[color:var(--rule)] bg-[color:var(--paper-2)] px-4 py-3">
        <UserMenu email={user?.email ?? null} onLogout={() => void logout()} />
      </div>
    </aside>
  )
}

/**
 * Top-of-sidebar context — answers "what am I looking at?" before the
 * user even reads a module label. Two rows:
 *
 *   ORG     ▾  qualcomm  (role: owner)
 *   PROJECT ▾  focus-ai-app
 *
 * Each row is a native <select> if the user has ≥ 2 of that thing,
 * else a static label. We keep the switcher inline (not a popover)
 * so it never blocks pointer events on the rest of the rail.
 */
function ContextBlock({
  currentOrg,
  currentProject,
  orgs,
  projects,
}: {
  currentOrg: OrgRow
  currentProject: null | ProjectRow
  orgs: OrgRow[]
  projects: ProjectRow[]
}) {
  const navigate = useNavigate()
  const orgsForCurrent = orgs.length > 0 ? orgs : [currentOrg]

  return (
    <div className="border-b border-[color:var(--rule)] bg-[color:var(--paper-2)] px-4 pt-3.5 pb-3">
      <ContextRow label="org">
        {orgsForCurrent.length > 1 ? (
          <select
            aria-label="Switch organization"
            className="w-full appearance-none bg-transparent pr-4 text-[13px] text-[color:var(--ink)] focus:outline-none"
            onChange={(e) => navigate(`/org/${e.target.value}/overview`)}
            value={currentOrg.slug}
          >
            {orgsForCurrent.map((o) => (
              <option key={o.slug} value={o.slug}>
                {o.name || o.slug}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-[13px] text-[color:var(--ink)]">
            {currentOrg.name || currentOrg.slug}
          </span>
        )}
        <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
          {currentOrg.role}
        </span>
      </ContextRow>

      <ContextRow label="project">
        {projects.length === 0 ? (
          <span className="text-[12px] text-[color:var(--ink-muted)] italic">none yet</span>
        ) : projects.length > 1 ? (
          <select
            aria-label="Switch project"
            className="w-full appearance-none bg-transparent pr-4 text-[13px] text-[color:var(--ink)] focus:outline-none"
            onChange={(e) => navigate(`/org/${currentOrg.slug}/overview?project=${e.target.value}`)}
            value={currentProject?.id ?? ''}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="truncate text-[13px] text-[color:var(--ink)]">
            {currentProject?.name ?? '—'}
          </span>
        )}
      </ContextRow>
    </div>
  )
}

function ContextRow({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex items-baseline gap-2 py-1">
      <span className="w-14 shrink-0 font-mono text-[9px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-baseline gap-2 truncate">{children}</div>
    </div>
  )
}

function Section({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="mb-1 last:mb-0">
      {title && (
        <div className="border-t border-[color:var(--rule-soft)] px-4 pt-5 pb-2">
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
      <span className="min-w-0 truncate font-mono text-[11px] text-[color:var(--ink-soft)]">
        {email ?? 'account'}
      </span>
      <button
        className="shrink-0 font-mono text-[11px] whitespace-nowrap text-[color:var(--ink-muted)] transition-colors hover:text-[color:var(--accent)]"
        onClick={onLogout}
        title="Sign out"
        type="button"
      >
        ⎋ sign&nbsp;out
      </button>
    </div>
  )
}

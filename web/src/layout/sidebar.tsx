import { Link, useLocation, useNavigate, useSearchParams } from 'react-router'

import type { OrgRow, ProjectRow } from '@/api/client'
import type { ModuleDef } from '@/modules/registry'

import { useOrg } from '@/auth/orgContext'
import { useAuth } from '@/auth/state'
import { GROUPS, modulesInGroup, PINNED_MODULE } from '@/modules/registry'

/**
 * Lens-grouped nav rail. Five lenses answer five operator questions:
 * "what broke?" / "what's slow?" / "who's affected?" / "is the platform
 * safe?" / "setup & admin". Overview is pinned above the lens groups
 * so the most common entry point is one click from the top.
 *
 * Visuals follow GDS semantic tokens (bg-bg-secondary rail, border-
 * border hairlines, accent strip on active row). Density is controlled
 * by the 5-axis theme — Sentori boots `compact` so the rail reads
 * Bloomberg-style tight without per-class overrides.
 */
export function Sidebar() {
  const { currentOrg, currentProject, orgs, projects } = useOrg()
  const { user } = useAuth()
  const isAdmin = currentOrg.role === 'owner' || currentOrg.role === 'admin'

  return (
    <aside className="bg-bg-secondary border-border hidden w-60 shrink-0 flex-col overflow-hidden border-r md:flex">
      <ContextBlock
        canCreateProject={isAdmin}
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

        {/* Instance-wide superadmin link — only for users with
         *  `is_superadmin = TRUE` on their row. Rendered with the
         *  accent color so it reads as "out-of-band power" rather
         *  than just another module. */}
        {user?.isSuperadmin && (
          <Section title="Operator">
            <Link
              className="text-accent hover:bg-bg-tertiary group relative block py-1.5 pr-3 pl-4 transition-colors"
              to="/main/superadmin"
            >
              <span aria-hidden className="absolute top-0 bottom-0 left-0 w-[2px] bg-transparent" />
              <span className="flex items-center gap-2.5 text-[13px]">
                <svg
                  aria-hidden
                  className="h-3.5 w-3.5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2 4 6v6c0 5 3.5 9.5 8 10 4.5-.5 8-5 8-10V6Z" />
                </svg>
                <span className="truncate">Superadmin</span>
              </span>
            </Link>
          </Section>
        )}
      </div>

      <FooterStrip />
    </aside>
  )
}

function FooterStrip() {
  return (
    <div className="border-border bg-bg-tertiary border-t px-4 py-2.5">
      <div className="flex items-center justify-between font-mono text-[10px] tracking-[0.18em] uppercase">
        <a
          className="text-fg-muted hover:text-accent transition-colors"
          href="/docs"
          rel="noreferrer"
          target="_blank"
        >
          docs ↗
        </a>
        <a
          className="text-fg-muted hover:text-accent transition-colors"
          href="https://github.com/goliajp/sentori/issues/new"
          rel="noreferrer"
          target="_blank"
        >
          feedback ↗
        </a>
      </div>
    </div>
  )
}

/**
 * Top-of-sidebar context — answers "what am I looking at?" before the
 * user even reads a module label. Two rows (org / project), each a
 * native <select> when there are ≥ 2 entries, otherwise a static
 * label. The trailing `+` button creates a new org / project.
 */
function ContextBlock({
  canCreateProject,
  currentOrg,
  currentProject,
  orgs,
  projects,
}: {
  canCreateProject: boolean
  currentOrg: OrgRow
  currentProject: null | ProjectRow
  orgs: OrgRow[]
  projects: ProjectRow[]
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const orgsForCurrent = orgs.length > 0 ? orgs : [currentOrg]

  const switchOrg = (slug: string) => {
    navigate(`/main/org/${slug}/overview`)
  }

  // Switch project by mutating ?project= only — keeps the current page
  // (Issues / Vitals / …) so users don't get yanked back to Overview.
  const switchProject = (projectId: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('project', projectId)
    setSearchParams(next, { replace: false })
  }

  const selectedProjectValue =
    currentProject && projects.some((p) => p.id === currentProject.id) ? currentProject.id : ''

  void location

  return (
    <div className="border-border bg-bg-tertiary border-b px-4 pt-3.5 pb-3">
      <ContextRow
        label="org"
        meta={
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            {currentOrg.role}
          </span>
        }
        plus={<PlusButton onClick={() => navigate('/main/onboarding')} title="New organization" />}
      >
        <select
          aria-label="Switch organization"
          className="text-fg min-w-0 flex-1 appearance-none truncate bg-transparent pr-1 text-[13px] focus:outline-none"
          onChange={(e) => switchOrg(e.target.value)}
          value={currentOrg.slug}
        >
          {orgsForCurrent.map((o) => (
            <option key={o.slug} value={o.slug}>
              {o.name || o.slug}
            </option>
          ))}
        </select>
      </ContextRow>

      <ContextRow
        label="project"
        plus={
          canCreateProject ? (
            <PlusButton
              onClick={() => navigate(`/main/org/${currentOrg.slug}/settings#new-project`)}
              title="New project"
            />
          ) : null
        }
      >
        {projects.length === 0 ? (
          <span className="text-fg-muted flex-1 text-[12px] italic">none yet</span>
        ) : (
          <select
            aria-label="Switch project"
            className="text-fg min-w-0 flex-1 appearance-none truncate bg-transparent pr-1 text-[13px] focus:outline-none"
            onChange={(e) => switchProject(e.target.value)}
            value={selectedProjectValue}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </ContextRow>
    </div>
  )
}

function PlusButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      aria-label={title}
      className="text-fg-muted hover:bg-bg hover:text-accent flex h-5 w-5 shrink-0 items-center justify-center transition-colors"
      onClick={onClick}
      title={title}
      type="button"
    >
      <svg
        aria-hidden
        className="h-3 w-3"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
        viewBox="0 0 24 24"
      >
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  )
}

function ContextRow({
  children,
  label,
  meta,
  plus,
}: {
  children: React.ReactNode
  label: string
  meta?: React.ReactNode
  plus?: React.ReactNode
}) {
  return (
    <div className="py-1.5 first:pt-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-fg-muted font-mono text-[9px] tracking-[0.22em] uppercase">
          {label}
        </span>
        {meta}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <div className="flex min-w-0 flex-1 items-center truncate">{children}</div>
        {plus}
      </div>
    </div>
  )
}

function Section({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <div className="mb-1 last:mb-0">
      {title && (
        <div className="border-border-muted border-t px-4 pt-5 pb-2">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.22em] uppercase">
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
  const target = `/main/org/${orgSlug}/${module.path}`
  const active = location.pathname === target || location.pathname.startsWith(`${target}/`)
  return (
    <Link
      className={`group relative block py-1.5 pr-3 pl-4 transition-colors ${
        active ? 'bg-bg-tertiary text-fg' : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
      }`}
      to={target}
    >
      <span
        aria-hidden
        className={`absolute top-0 bottom-0 left-0 w-[2px] ${active ? 'bg-accent' : 'bg-transparent'}`}
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
      className={`h-3.5 w-3.5 shrink-0 ${active ? 'text-accent' : 'text-fg-muted'}`}
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

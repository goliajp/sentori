import { useQuery } from '@tanstack/react-query'
import { Link, Navigate, Outlet, useLocation, useParams } from 'react-router'

import { adminApi, orgsApi } from '@/api/client'
import { OrgCtx } from '@/auth/orgContext'
import { useAuth } from '@/auth/state'
import { OrgSwitcher } from '@/components/OrgSwitcher'
import { ThemeToggle } from '@/components/theme-toggle'
import { useThemeEffect } from '@/components/theme'

const NAV = [{ label: 'Issues', path: 'issues' }]

export function OrgLayout() {
  useThemeEffect()
  const { slug } = useParams()
  const location = useLocation()
  const { logout, user } = useAuth()

  const { data: orgs, isLoading: loadingOrgs } = useQuery({
    queryFn: orgsApi.listMine,
    queryKey: ['orgs'],
  })
  const { data: projects, isLoading: loadingProjects } = useQuery({
    queryFn: adminApi.listProjects,
    queryKey: ['projects'],
  })

  if (loadingOrgs || loadingProjects) {
    return (
      <div className="text-fg-muted flex h-full items-center justify-center text-sm">Loading…</div>
    )
  }
  const currentOrg = orgs?.find((o) => o.slug === slug) ?? null
  if (!currentOrg) {
    // Either the slug doesn't exist or the user isn't a member.
    return <Navigate replace to="/" />
  }
  const orgProjects = projects?.filter((p) => p.orgSlug === slug) ?? []
  const currentProject = orgProjects[0] ?? null

  const isActive = (path: string) => location.pathname.startsWith(`/org/${currentOrg.slug}/${path}`)

  return (
    <OrgCtx.Provider
      value={{
        currentOrg,
        currentProject,
        orgs: orgs ?? [],
        projects: orgProjects,
      }}
    >
      <div className="flex h-full flex-col">
        <header className="border-border bg-bg/80 flex h-12 shrink-0 items-center justify-between border-b px-6 backdrop-blur-xl">
          <div className="flex items-center gap-4">
            <Link className="text-fg text-sm font-semibold" to="/">
              Sentori
            </Link>
            <OrgSwitcher current={currentOrg} orgs={orgs ?? []} />
            <nav className="flex items-center gap-1">
              {NAV.map((item) => (
                <Link
                  className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                    isActive(item.path)
                      ? 'bg-accent/10 text-accent'
                      : 'text-fg-muted hover:bg-bg-tertiary hover:text-fg'
                  }`}
                  key={item.path}
                  to={`/org/${currentOrg.slug}/${item.path}`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-fg-muted hidden text-xs sm:inline">{user?.email}</span>
            <ThemeToggle />
            <button
              className="text-fg-muted hover:bg-bg-tertiary hover:text-fg rounded-md px-3 py-1.5 text-sm transition-colors"
              onClick={() => void logout()}
              type="button"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </OrgCtx.Provider>
  )
}

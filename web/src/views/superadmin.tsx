import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, Navigate, Outlet } from 'react-router'

import { type SuperadminUserRow, superadminApi } from '@/api/client'
import { useAuth } from '@/auth/state'
import { Hint } from '@/components/Hint'
import { PageHeader } from '@/layout/page-header'
import { qk } from '@/api/query-keys'

/**
 * /superadmin/* layout — guarded by `user.isSuperadmin`. Non-superadmins
 * get a Navigate to /. Renders three tabs (Users / Orgs / Projects)
 * above the <Outlet />.
 */
export function SuperadminLayout() {
  const { user } = useAuth()
  if (!user) return <Navigate replace to="/login" />
  if (!user.isSuperadmin) return <Navigate replace to="/main" />

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        className="text-fg-muted hover:text-accent inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.08em] uppercase"
        to="/main"
      >
        ← back to dashboard
      </Link>
      <PageHeader subtitle="instance-wide" title="Superadmin" />

      <nav
        aria-label="Superadmin sections"
        className="border-border mt-2 flex items-baseline gap-5 border-b pb-px"
      >
        <Tab to="/main/superadmin/users">Users</Tab>
        <Tab to="/main/superadmin/orgs">Orgs</Tab>
        <Tab to="/main/superadmin/projects">Projects</Tab>
      </nav>

      <div className="mt-5">
        <Outlet />
      </div>
    </div>
  )
}

function Tab({ children, to }: { children: React.ReactNode; to: string }) {
  return (
    <NavLink
      className={({ isActive }) =>
        `relative pb-2 font-mono text-[11px] tracking-[0.1em] uppercase transition-colors ${
          isActive ? 'text-fg' : 'text-fg-muted hover:text-fg'
        }`
      }
      end
      to={to}
    >
      {({ isActive }) => (
        <>
          {children}
          {isActive && (
            <span aria-hidden className="bg-accent absolute right-0 -bottom-px left-0 h-[2px]" />
          )}
        </>
      )}
    </NavLink>
  )
}

/* ─── Users tab ─────────────────────────────────────────────── */

export function SuperadminUsersView() {
  const qc = useQueryClient()
  const { user: me } = useAuth()
  const q = useQuery({ queryFn: superadminApi.listUsers, queryKey: qk.superadmin.users() })

  const setM = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => superadminApi.setSuperadmin(id, on),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.superadmin.users() }),
  })

  const rows = q.data ?? []

  return (
    <div>
      <header className="sec-head">
        <span className="sec-head-title">All users</span>
        <span className="sec-head-sub">{q.isLoading ? 'loading…' : `${rows.length} total`}</span>
      </header>
      {q.isLoading && <Hint>Loading…</Hint>}
      {q.error && <Hint>Failed to load users.</Hint>}
      {!q.isLoading && rows.length > 0 && (
        <table className="bench mt-3">
          <thead>
            <tr>
              <th>email</th>
              <th>display name</th>
              <th>verified</th>
              <th>oauth</th>
              <th className="num">orgs</th>
              <th>joined</th>
              <th className="w-32">superadmin</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <UserRow
                disabled={setM.isPending}
                isSelf={!!me && me.id === r.id}
                key={r.id}
                onToggle={(on) => setM.mutate({ id: r.id, on })}
                row={r}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function UserRow({
  disabled,
  isSelf,
  onToggle,
  row,
}: {
  disabled: boolean
  isSelf: boolean
  onToggle: (on: boolean) => void
  row: SuperadminUserRow
}) {
  return (
    <tr>
      <td className="lead">{row.email}</td>
      <td className="text-fg-secondary">{row.displayName ?? '—'}</td>
      <td>
        {row.emailVerified ? (
          <span className="text-success font-mono text-[10px]">verified</span>
        ) : (
          <span className="text-warning font-mono text-[10px]">unverified</span>
        )}
      </td>
      <td className="text-fg-secondary font-mono">{row.oauthProvider ?? '—'}</td>
      <td className="num">{row.orgCount}</td>
      <td className="text-fg-secondary font-mono text-[11px]">
        {new Date(row.createdAt).toLocaleDateString()}
      </td>
      <td>
        <button
          aria-pressed={row.isSuperadmin}
          className={`inline-flex h-6 items-center border px-2 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors disabled:opacity-40 ${
            row.isSuperadmin
              ? 'border-accent bg-accent/10 text-accent hover:border-danger hover:text-danger'
              : 'border-border text-fg-muted hover:border-accent hover:text-accent'
          }`}
          disabled={disabled || isSelf}
          onClick={() => onToggle(!row.isSuperadmin)}
          title={isSelf ? 'cannot demote your own session' : undefined}
          type="button"
        >
          {row.isSuperadmin ? '◉ super · revoke' : '○ grant'}
        </button>
      </td>
    </tr>
  )
}

/* ─── Orgs tab ──────────────────────────────────────────────── */

export function SuperadminOrgsView() {
  const q = useQuery({ queryFn: superadminApi.listOrgs, queryKey: qk.superadmin.orgs() })
  const rows = q.data ?? []

  return (
    <div>
      <header className="sec-head">
        <span className="sec-head-title">All orgs</span>
        <span className="sec-head-sub">{q.isLoading ? 'loading…' : `${rows.length} total`}</span>
      </header>
      {q.isLoading && <Hint>Loading…</Hint>}
      {q.error && <Hint>Failed to load orgs.</Hint>}
      {!q.isLoading && rows.length > 0 && (
        <table className="bench mt-3">
          <thead>
            <tr>
              <th>name</th>
              <th>slug</th>
              <th>owner</th>
              <th className="num">members</th>
              <th className="num">projects</th>
              <th>created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="lead">
                  <Link className="text-fg hover:text-accent" to={`/main/org/${r.slug}/overview`}>
                    {r.name}
                  </Link>
                </td>
                <td className="text-fg-secondary font-mono">{r.slug}</td>
                <td className="text-fg-secondary font-mono">
                  {r.ownerEmail ?? r.ownerId.slice(0, 8)}
                </td>
                <td className="num">{r.memberCount}</td>
                <td className="num">{r.projectCount}</td>
                <td className="text-fg-secondary font-mono text-[11px]">
                  {new Date(r.createdAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/* ─── Projects tab ──────────────────────────────────────────── */

export function SuperadminProjectsView() {
  const q = useQuery({
    queryFn: superadminApi.listProjects,
    queryKey: qk.superadmin.projects(),
  })
  const rows = q.data ?? []

  return (
    <div>
      <header className="sec-head">
        <span className="sec-head-title">All projects</span>
        <span className="sec-head-sub">{q.isLoading ? 'loading…' : `${rows.length} total`}</span>
      </header>
      {q.isLoading && <Hint>Loading…</Hint>}
      {q.error && <Hint>Failed to load projects.</Hint>}
      {!q.isLoading && rows.length > 0 && (
        <table className="bench mt-3">
          <thead>
            <tr>
              <th>name</th>
              <th>org</th>
              <th>id</th>
              <th>repo</th>
              <th className="num">events 30d</th>
              <th className="w-20"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="lead">{r.name}</td>
                <td>
                  <Link
                    className="text-fg hover:text-accent font-mono"
                    to={`/main/org/${r.orgSlug}/overview`}
                  >
                    {r.orgSlug}
                  </Link>
                </td>
                <td className="text-fg-secondary font-mono text-[11px]">{r.id}</td>
                <td className="text-fg-secondary font-mono text-[11px]">
                  {r.sourceRepoUrl ? (
                    <a
                      className="hover:text-accent"
                      href={r.sourceRepoUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      ↗ {hostOf(r.sourceRepoUrl) ?? r.sourceRepoUrl}
                    </a>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="num">{r.eventCount30d.toLocaleString()}</td>
                <td>
                  <Link
                    className="text-fg-muted hover:text-accent font-mono text-[10px] tracking-[0.1em] uppercase"
                    to={`/main/org/${r.orgSlug}/issues?project=${r.id}`}
                  >
                    open →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function hostOf(url: string): null | string {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

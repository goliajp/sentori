import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, NavLink, Navigate, Outlet } from 'react-router'

import { type SuperadminUserRow, superadminApi } from '@/api/client'
import { useAuth } from '@/auth/state'
import { PageHeader } from '@/layout/page-header'

/**
 * /superadmin/* layout — guarded by `user.isSuperadmin`. Non-superadmins
 * get a Navigate to /. Renders three tabs (Users / Orgs / Projects)
 * above the <Outlet />.
 */
export function SuperadminLayout() {
  const { user } = useAuth()
  if (!user) return <Navigate replace to="/login" />
  if (!user.isSuperadmin) return <Navigate replace to="/" />

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        className="inline-flex items-center gap-1 font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--accent)]"
        to="/"
      >
        ← back to dashboard
      </Link>
      <PageHeader subtitle="instance-wide" title="Superadmin" />

      <nav
        aria-label="Superadmin sections"
        className="mt-2 flex items-baseline gap-5 border-b border-[color:var(--rule)] pb-px"
      >
        <Tab to="/superadmin/users">Users</Tab>
        <Tab to="/superadmin/orgs">Orgs</Tab>
        <Tab to="/superadmin/projects">Projects</Tab>
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
          isActive
            ? 'text-[color:var(--ink)]'
            : 'text-[color:var(--ink-muted)] hover:text-[color:var(--ink)]'
        }`
      }
      end
      to={to}
    >
      {({ isActive }) => (
        <>
          {children}
          {isActive && (
            <span
              aria-hidden
              className="absolute right-0 -bottom-px left-0 h-[2px] bg-[color:var(--accent)]"
            />
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
  const q = useQuery({ queryFn: superadminApi.listUsers, queryKey: ['superadmin', 'users'] })

  const setM = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => superadminApi.setSuperadmin(id, on),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['superadmin', 'users'] }),
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
      <td className="text-[color:var(--ink-soft)]">{row.displayName ?? '—'}</td>
      <td>
        {row.emailVerified ? (
          <span className="font-mono text-[10px] text-[color:var(--success)]">verified</span>
        ) : (
          <span className="font-mono text-[10px] text-[color:var(--warning)]">unverified</span>
        )}
      </td>
      <td className="font-mono text-[color:var(--ink-soft)]">{row.oauthProvider ?? '—'}</td>
      <td className="num">{row.orgCount}</td>
      <td className="font-mono text-[11px] text-[color:var(--ink-soft)]">
        {new Date(row.createdAt).toLocaleDateString()}
      </td>
      <td>
        <button
          aria-pressed={row.isSuperadmin}
          className={`inline-flex h-6 items-center border px-2 font-mono text-[10px] tracking-[0.1em] uppercase transition-colors disabled:opacity-40 ${
            row.isSuperadmin
              ? 'border-[color:var(--accent)] bg-[color:var(--accent-soft)] text-[color:var(--accent)] hover:border-[color:var(--danger)] hover:text-[color:var(--danger)]'
              : 'border-[color:var(--rule)] text-[color:var(--ink-muted)] hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]'
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
  const q = useQuery({ queryFn: superadminApi.listOrgs, queryKey: ['superadmin', 'orgs'] })
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
                  <Link
                    className="text-[color:var(--ink)] hover:text-[color:var(--accent)]"
                    to={`/org/${r.slug}/overview`}
                  >
                    {r.name}
                  </Link>
                </td>
                <td className="font-mono text-[color:var(--ink-soft)]">{r.slug}</td>
                <td className="font-mono text-[color:var(--ink-soft)]">
                  {r.ownerEmail ?? r.ownerId.slice(0, 8)}
                </td>
                <td className="num">{r.memberCount}</td>
                <td className="num">{r.projectCount}</td>
                <td className="font-mono text-[11px] text-[color:var(--ink-soft)]">
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
    queryKey: ['superadmin', 'projects'],
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
                    className="font-mono text-[color:var(--ink)] hover:text-[color:var(--accent)]"
                    to={`/org/${r.orgSlug}/overview`}
                  >
                    {r.orgSlug}
                  </Link>
                </td>
                <td className="font-mono text-[11px] text-[color:var(--ink-soft)]">{r.id}</td>
                <td className="font-mono text-[11px] text-[color:var(--ink-soft)]">
                  {r.sourceRepoUrl ? (
                    <a
                      className="hover:text-[color:var(--accent)]"
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
                    className="font-mono text-[10px] tracking-[0.1em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--accent)]"
                    to={`/org/${r.orgSlug}/issues?project=${r.id}`}
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

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-y border-[color:var(--rule)] py-4 text-[13px] text-[color:var(--ink-soft)]">
      {children}
    </p>
  )
}

function hostOf(url: string): null | string {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { adminApi, type OrgRole, orgsApi, teamsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'

/**
 * Settings — org-wide config that doesn't belong on a single module.
 *
 * Sections (top → bottom):
 *   1. Organization (slug / name / role)
 *   2. Members — list + invite form
 *   3. Teams — list + create-team form
 *   4. Projects — list + create-project form
 *
 * All four section forms collapse by default; tap the section's
 * "+ create"-style action to expand. Submissions optimistically
 * invalidate the relevant react-query cache so the row appears
 * inline without a page reload.
 *
 * Admin gating happens in the sidebar (link only renders for
 * owner/admin), not here — but server endpoints fail-closed on
 * role too.
 */
export function SettingsView() {
  const { currentOrg } = useOrg()
  const qc = useQueryClient()
  const location = useLocation()
  // Sidebar's "+ new project" button deep-links here as
  // `/org/{slug}/settings#new-project`. We honor that hash by both
  // pre-opening the Projects → create form AND scrolling it into view
  // once the section is rendered.
  const hashFocus = location.hash.replace(/^#/, '')
  useEffect(() => {
    if (!hashFocus) return
    const el = document.getElementById(hashFocus)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [hashFocus])

  const membersQ = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => orgsApi.listMembers(currentOrg.slug),
    queryKey: ['members', currentOrg.slug],
  })
  const teamsQ = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => teamsApi.list(currentOrg.slug),
    queryKey: ['teams', currentOrg.slug],
  })
  const projectsQ = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: adminApi.listProjects,
    queryKey: ['projects'],
  })

  const members = membersQ.data ?? []
  const teams = teamsQ.data ?? []
  const projects = (projectsQ.data ?? []).filter((p) => p.orgSlug === currentOrg.slug)

  const inviteM = useMutation({
    mutationFn: (body: { email: string; role: OrgRole; teamSlug?: null | string }) =>
      orgsApi.createInvite(currentOrg.slug, body.email, body.role, body.teamSlug),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['members', currentOrg.slug] }),
  })
  const createTeamM = useMutation({
    mutationFn: (body: { description?: string; name: string; slug: string }) =>
      teamsApi.create(currentOrg.slug, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['teams', currentOrg.slug] }),
  })
  const createProjectM = useMutation({
    mutationFn: (name: string) => adminApi.createProject(currentOrg.slug, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })

  return (
    <div className="sentori-page-in">
      <PageHeader subtitle="org configuration" title="Settings" />

      <SubSection title="Organization">
        <Row label="slug">
          <span className="font-mono">{currentOrg.slug}</span>
        </Row>
        <Row label="name">{currentOrg.name}</Row>
        <Row label="your role">
          <span className="font-mono text-[color:var(--accent)]">{currentOrg.role}</span>
        </Row>
      </SubSection>

      <SubSection sub={`${members.length} total`} title="Members">
        <CollapsibleForm
          disabled={inviteM.isPending}
          error={errOf(inviteM.error)}
          label="invite member"
          onSubmit={(values) =>
            inviteM.mutate({
              email: values.email,
              role: (values.role || 'member') as OrgRole,
              teamSlug: values.team || null,
            })
          }
          fields={[
            { name: 'email', placeholder: 'email@example.com', required: true, type: 'email' },
            {
              name: 'role',
              options: [
                { label: 'member', value: 'member' },
                { label: 'admin', value: 'admin' },
                { label: 'owner', value: 'owner' },
              ],
              type: 'select',
            },
            {
              name: 'team',
              options: [
                { label: '(no team)', value: '' },
                ...teams.map((t) => ({ label: t.name, value: t.slug })),
              ],
              type: 'select',
            },
          ]}
        />

        {membersQ.isLoading && <Hint>Loading…</Hint>}
        {!membersQ.isLoading && members.length === 0 && <Hint>No members yet.</Hint>}
        {members.length > 0 && (
          <ul>
            {members.map((m, i) => (
              <li
                className={`flex items-baseline justify-between gap-3 border-b border-[color:var(--rule-soft)] py-2 ${
                  i === 0 ? 'border-t border-[color:var(--rule)]' : ''
                }`}
                key={m.userId}
              >
                <span className="text-[13px] text-[color:var(--ink)]">{m.email}</span>
                <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SubSection>

      <SubSection sub={`${teams.length} total`} title="Teams">
        <CollapsibleForm
          disabled={createTeamM.isPending}
          error={errOf(createTeamM.error)}
          label="create team"
          onSubmit={(values) =>
            createTeamM.mutate({
              description: values.description || undefined,
              name: values.name,
              slug: values.slug,
            })
          }
          fields={[
            { name: 'name', placeholder: 'Frontend', required: true, type: 'text' },
            { name: 'slug', placeholder: 'frontend', required: true, type: 'text' },
            { name: 'description', placeholder: 'optional', type: 'text' },
          ]}
        />

        {teamsQ.isLoading && <Hint>Loading…</Hint>}
        {!teamsQ.isLoading && teams.length === 0 && <Hint>No teams yet.</Hint>}
        {teams.length > 0 && (
          <table className="bench">
            <thead>
              <tr>
                <th>name</th>
                <th>slug</th>
                <th>description</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td className="lead">
                    <Link
                      className="text-[color:var(--ink)] hover:text-[color:var(--accent)]"
                      to={`/org/${currentOrg.slug}/teams/${t.slug}`}
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="font-mono text-[color:var(--ink-soft)]">{t.slug}</td>
                  <td className="text-[color:var(--ink-soft)]">{t.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SubSection>

      <SubSection id="new-project" sub={`${projects.length} total`} title="Projects">
        <CollapsibleForm
          defaultOpen={hashFocus === 'new-project'}
          disabled={createProjectM.isPending}
          error={errOf(createProjectM.error)}
          label="create project"
          onSubmit={(values) => createProjectM.mutate(values.name)}
          fields={[{ name: 'name', placeholder: 'my-app', required: true, type: 'text' }]}
        />

        {projectsQ.isLoading && <Hint>Loading…</Hint>}
        {!projectsQ.isLoading && projects.length === 0 && (
          <Hint>No projects in this org yet — create your first one above.</Hint>
        )}
        {projects.length > 0 && (
          <table className="bench">
            <thead>
              <tr>
                <th>name</th>
                <th>id</th>
                <th>repo</th>
                <th className="w-44"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td className="lead">{p.name}</td>
                  <td className="font-mono text-[11px] text-[color:var(--ink-soft)]">{p.id}</td>
                  <td className="font-mono text-[11px] text-[color:var(--ink-soft)]">
                    {p.sourceRepoUrl ? (
                      <a
                        className="hover:text-[color:var(--accent)]"
                        href={p.sourceRepoUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        ↗ {hostOf(p.sourceRepoUrl) ?? p.sourceRepoUrl}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <div className="flex items-center justify-end gap-3 font-mono text-[10px] tracking-[0.1em] uppercase">
                      <Link
                        className="text-[color:var(--ink-muted)] hover:text-[color:var(--accent)]"
                        to={`/org/${currentOrg.slug}/projects/${p.id}/integration`}
                      >
                        integrate →
                      </Link>
                      <Link
                        className="text-[color:var(--ink-muted)] hover:text-[color:var(--accent)]"
                        to={`/org/${currentOrg.slug}/issues?project=${p.id}`}
                      >
                        open →
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SubSection>
    </div>
  )
}

/**
 * Editorial inline-create form. Tap label → form expands. Submit
 * runs `onSubmit(values)`; on success the parent's mutation onSuccess
 * invalidates the relevant query. On error the parent passes the
 * message in via `error` prop.
 */
type FormField =
  | { name: string; options: { label: string; value: string }[]; type: 'select' }
  | { name: string; placeholder?: string; required?: boolean; type: 'email' | 'text' }

function CollapsibleForm({
  defaultOpen,
  disabled,
  error,
  fields,
  label,
  onSubmit,
}: {
  defaultOpen?: boolean
  disabled: boolean
  error: null | string
  fields: FormField[]
  label: string
  onSubmit: (values: Record<string, string>) => void
}) {
  const [open, setOpen] = useState(defaultOpen ?? false)
  const [values, setValues] = useState<Record<string, string>>({})

  if (!open) {
    return (
      <div className="flex justify-end pt-2 pb-2">
        <button
          className="inline-flex h-7 items-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-3 font-mono text-[11px] tracking-[0.08em] text-[color:var(--ink)] uppercase transition-colors hover:border-[color:var(--accent)] hover:text-[color:var(--accent)]"
          onClick={() => setOpen(true)}
          type="button"
        >
          + {label}
        </button>
      </div>
    )
  }

  return (
    <form
      className="flex flex-wrap items-end gap-2 border-b border-[color:var(--rule)] py-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(values)
      }}
    >
      {fields.map((f) => (
        <label className="flex flex-col gap-1" key={f.name}>
          <span className="font-mono text-[9px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
            {f.name}
          </span>
          {f.type === 'select' ? (
            <select
              className="h-7 border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[12px] text-[color:var(--ink)] focus:border-[color:var(--accent)] focus:outline-none"
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              value={values[f.name] ?? f.options[0]?.value ?? ''}
            >
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="h-7 border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[12px] text-[color:var(--ink)] placeholder:text-[color:var(--ink-muted)] focus:border-[color:var(--accent)] focus:outline-none"
              onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
              placeholder={f.placeholder}
              required={f.required}
              type={f.type}
              value={values[f.name] ?? ''}
            />
          )}
        </label>
      ))}
      <button
        className="inline-flex h-7 items-center bg-[color:var(--accent)] px-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--paper)] uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        type="submit"
      >
        {disabled ? 'creating…' : 'create'}
      </button>
      <button
        className="inline-flex h-7 items-center px-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--ink)]"
        onClick={() => setOpen(false)}
        type="button"
      >
        cancel
      </button>
      {error && (
        <span className="basis-full pt-1 font-mono text-[11px] text-[color:var(--danger)]">
          {error}
        </span>
      )}
    </form>
  )
}

function errOf(e: unknown): null | string {
  if (!e) return null
  const body = (e as { body?: { error?: string } } | undefined)?.body
  if (body?.error) return body.error
  if (e instanceof Error) return e.message
  return 'request failed'
}

function hostOf(url: string): null | string {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-y border-[color:var(--rule)] py-4 text-[13px] text-[color:var(--ink-soft)]">
      {children}
    </p>
  )
}

function SubSection({
  children,
  id,
  sub,
  title,
}: {
  children: React.ReactNode
  id?: string
  sub?: string
  title: string
}) {
  return (
    <section id={id}>
      <header className="sec-head">
        <span className="sec-head-title">{title}</span>
        {sub && <span className="sec-head-sub">{sub}</span>}
      </header>
      <div>{children}</div>
    </section>
  )
}

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--rule-soft)] py-2 first:border-t first:border-[color:var(--rule)]">
      <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-[13px] text-[color:var(--ink)]">
        {children}
      </span>
    </div>
  )
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { adminApi, type OrgRole, orgsApi, teamsApi } from '@/api/client'
import { Row } from '@/components/Row'
import { SubSection } from '@/components/SubSection'
import { useOrg } from '@/auth/orgContext'
import { Hint } from '@/components/Hint'
import { PageHeader } from '@/layout/page-header'
import { qk } from '@/api/query-keys'

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
    queryKey: qk.orgs.members(currentOrg.slug),
  })
  const teamsQ = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => teamsApi.list(currentOrg.slug),
    queryKey: qk.orgs.teams(currentOrg.slug),
  })
  const projectsQ = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: adminApi.listProjects,
    queryKey: qk.projects(),
  })

  const members = membersQ.data ?? []
  const teams = teamsQ.data ?? []
  const projects = (projectsQ.data ?? []).filter((p) => p.orgSlug === currentOrg.slug)

  const inviteM = useMutation({
    mutationFn: (body: { email: string; role: OrgRole; teamSlug?: null | string }) =>
      orgsApi.createInvite(currentOrg.slug, body.email, body.role, body.teamSlug),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.orgs.members(currentOrg.slug) }),
  })
  const createTeamM = useMutation({
    mutationFn: (body: { description?: string; name: string; slug: string }) =>
      teamsApi.create(currentOrg.slug, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.orgs.teams(currentOrg.slug) }),
  })
  const createProjectM = useMutation({
    mutationFn: (name: string) => adminApi.createProject(currentOrg.slug, { name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects() }),
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
          <span className="text-accent font-mono">{currentOrg.role}</span>
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
        {membersQ.isError && <Hint danger>Failed to load members. Refresh to retry.</Hint>}
        {!membersQ.isLoading && !membersQ.isError && members.length === 0 && (
          <Hint>No members yet.</Hint>
        )}
        {members.length > 0 && (
          <ul>
            {members.map((m, i) => (
              <li
                className={`border-border-muted flex items-baseline justify-between gap-3 border-b py-2 ${
                  i === 0 ? 'border-border border-t' : ''
                }`}
                key={m.userId}
              >
                <span className="text-fg text-[13px]">{m.email}</span>
                <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
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
        {teamsQ.isError && <Hint danger>Failed to load teams. Refresh to retry.</Hint>}
        {!teamsQ.isLoading && !teamsQ.isError && teams.length === 0 && <Hint>No teams yet.</Hint>}
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
                      className="text-fg hover:text-accent"
                      to={`/main/org/${currentOrg.slug}/teams/${t.slug}`}
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="text-fg-secondary font-mono">{t.slug}</td>
                  <td className="text-fg-secondary">{t.description ?? '—'}</td>
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
        {projectsQ.isError && <Hint danger>Failed to load projects. Refresh to retry.</Hint>}
        {!projectsQ.isLoading && !projectsQ.isError && projects.length === 0 && (
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
                  <td className="text-fg-secondary font-mono text-[11px]">{p.id}</td>
                  <td className="text-fg-secondary font-mono text-[11px]">
                    {p.sourceRepoUrl ? (
                      <a
                        className="hover:text-accent"
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
                        className="text-fg-muted hover:text-accent"
                        to={`/main/org/${currentOrg.slug}/integrate?project=${p.id}`}
                      >
                        integrate →
                      </Link>
                      <Link
                        className="text-fg-muted hover:text-accent"
                        to={`/main/org/${currentOrg.slug}/issues?project=${p.id}`}
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

      {/* v1.4 W24 — per-org label catalog (used by issue chips). */}
      <LabelsSubSection orgSlug={currentOrg.slug} />
    </div>
  )
}

function LabelsSubSection({ orgSlug }: { orgSlug: string }) {
  const qc = useQueryClient()
  const labelsQ = useQuery({
    queryFn: () => adminApi.listOrgLabels(orgSlug),
    queryKey: qk.orgs.labels(orgSlug),
  })
  const createM = useMutation({
    mutationFn: (body: { name: string; color?: string; slaPriorityHours?: number }) =>
      adminApi.createOrgLabel(orgSlug, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.orgs.labels(orgSlug) }),
  })
  const deleteM = useMutation({
    mutationFn: (id: string) => adminApi.deleteOrgLabel(orgSlug, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.orgs.labels(orgSlug) }),
  })

  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState('#ffa040')
  const [draftSla, setDraftSla] = useState('')

  const labels = labelsQ.data ?? []
  const onCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draftName.trim()) return
    createM.mutate({
      name: draftName.trim(),
      color: draftColor.trim() || undefined,
      slaPriorityHours: draftSla.trim() ? Number.parseInt(draftSla.trim(), 10) : undefined,
    })
    setDraftName('')
    setDraftSla('')
  }

  return (
    <SubSection sub={`${labels.length} total`} title="Labels">
      <p className="text-fg-secondary mt-1 text-[12px]">
        Catalog of named labels operators apply to issues. Each label can carry a hex color
        (rendered on issue chips) and an optional p0/p1 SLA in hours (used for the overdue badge on
        the issue list).
      </p>

      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={onCreate}>
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            name
          </span>
          <input
            className="border-border bg-bg-secondary text-fg focus:border-accent h-7 border px-2 text-[13px] focus:outline-none"
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="frontend"
            value={draftName}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            color
          </span>
          <input
            className="border-border bg-bg-secondary text-fg focus:border-accent h-7 w-20 border px-2 font-mono text-[11px] focus:outline-none"
            onChange={(e) => setDraftColor(e.target.value)}
            placeholder="#ff8800"
            value={draftColor}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            sla hours
          </span>
          <input
            className="border-border bg-bg-secondary text-fg focus:border-accent h-7 w-20 border px-2 font-mono text-[11px] focus:outline-none"
            inputMode="numeric"
            onChange={(e) => setDraftSla(e.target.value)}
            placeholder="4"
            value={draftSla}
          />
        </label>
        <button
          className="bg-accent text-bg h-7 px-3 font-mono text-[11px] tracking-[0.05em] uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
          disabled={createM.isPending || !draftName.trim()}
          type="submit"
        >
          {createM.isPending ? '…' : '+ add'}
        </button>
      </form>
      {createM.error && (
        <p className="text-danger mt-2 font-mono text-[11px]">
          {errOf(createM.error) ?? 'create failed'}
        </p>
      )}

      {labels.length > 0 && (
        <ul className="divide-border-muted border-border mt-3 divide-y border-y">
          {labels.map((l) => (
            <li className="flex items-center gap-3 py-2" key={l.id}>
              <span
                aria-hidden
                className="border-border inline-block h-3 w-3 rounded-full border"
                style={{ backgroundColor: l.color ?? 'var(--color-bg-secondary)' }}
              />
              <span className="t-md text-fg font-mono">{l.name}</span>
              {l.color && <span className="text-fg-muted font-mono text-[10px]">{l.color}</span>}
              {l.slaPriorityHours !== null && (
                <span className="text-fg-muted font-mono text-[10px] tracking-[0.05em] uppercase">
                  SLA {l.slaPriorityHours}h
                </span>
              )}
              <button
                className="t-sm text-fg-muted hover:text-danger ml-auto"
                onClick={() => deleteM.mutate(l.id)}
                type="button"
              >
                delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </SubSection>
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
          className="border-border bg-bg-secondary text-fg hover:border-accent hover:text-accent inline-flex h-7 items-center border px-3 font-mono text-[11px] tracking-[0.08em] uppercase transition-colors"
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
      className="border-border flex flex-wrap items-end gap-2 border-b py-3"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(values)
      }}
    >
      {fields.map((f) => (
        <label className="flex flex-col gap-1" key={f.name}>
          <span className="text-fg-muted font-mono text-[9px] tracking-[0.18em] uppercase">
            {f.name}
          </span>
          {f.type === 'select' ? (
            <select
              className="border-border bg-bg-secondary text-fg focus:border-accent h-7 border px-2 font-mono text-[12px] focus:outline-none"
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
              className="border-border bg-bg-secondary text-fg placeholder:text-fg-muted focus:border-accent h-7 border px-2 font-mono text-[12px] focus:outline-none"
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
        className="bg-accent text-bg inline-flex h-7 items-center px-3 font-mono text-[11px] tracking-[0.05em] uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled}
        type="submit"
      >
        {disabled ? 'creating…' : 'create'}
      </button>
      <button
        className="text-fg-muted hover:text-fg inline-flex h-7 items-center px-3 font-mono text-[11px] tracking-[0.05em] uppercase"
        onClick={() => setOpen(false)}
        type="button"
      >
        cancel
      </button>
      {error && <span className="text-danger basis-full pt-1 font-mono text-[11px]">{error}</span>}
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

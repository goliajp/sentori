import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router'

import { adminApi, orgsApi, teamsApi, type TeamRole } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { useHasPermission } from '@/auth/useHasPermission'
import { RoleBadge } from '@/components/RoleBadge'
import { densityClasses, useDensity } from '@/lib/density'

const ROLES: readonly TeamRole[] = ['lead', 'member']

export function TeamDetailView() {
  const { slug, teamSlug } = useParams<{ slug: string; teamSlug: string }>()
  const { currentOrg } = useOrg()
  const orgSlug = currentOrg.slug
  const dCls = densityClasses(useDensity().density)
  const canManage = useHasPermission('team.member.manage')
  const queryClient = useQueryClient()

  if (!teamSlug) return <Navigate replace to={`/org/${slug}/teams`} />

  const teamQuery = useQuery({
    queryFn: () => teamsApi.detail(orgSlug, teamSlug),
    queryKey: ['team', orgSlug, teamSlug],
  })
  const membersQuery = useQuery({
    queryFn: () => teamsApi.listMembers(orgSlug, teamSlug),
    queryKey: ['team-members', orgSlug, teamSlug],
  })
  const projectsQuery = useQuery({
    queryFn: () => teamsApi.listProjects(orgSlug, teamSlug),
    queryKey: ['team-projects', orgSlug, teamSlug],
  })
  const orgMembersQuery = useQuery({
    enabled: canManage,
    queryFn: () => orgsApi.listMembers(orgSlug),
    queryKey: ['members', orgSlug],
  })
  const allProjectsQuery = useQuery({
    enabled: canManage,
    queryFn: adminApi.listProjects,
    queryKey: ['projects'],
  })

  const [addUserId, setAddUserId] = useState('')
  const [addRole, setAddRole] = useState<TeamRole>('member')
  const [addMsg, setAddMsg] = useState<null | string>(null)

  const addMember = useMutation({
    mutationFn: () => teamsApi.addMember(orgSlug, teamSlug, addUserId, addRole),
    onError: (err: { body?: { error?: string } }) => {
      setAddMsg(err.body?.error ?? 'Add failed')
    },
    onSuccess: () => {
      setAddUserId('')
      setAddRole('member')
      setAddMsg('Member added')
      void queryClient.invalidateQueries({ queryKey: ['team-members', orgSlug, teamSlug] })
    },
  })

  const onAddMember = (e: FormEvent) => {
    e.preventDefault()
    setAddMsg(null)
    addMember.mutate()
  }

  const removeMember = useMutation({
    mutationFn: (userId: string) => teamsApi.removeMember(orgSlug, teamSlug, userId),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['team-members', orgSlug, teamSlug] }),
  })

  const patchMemberRole = useMutation({
    mutationFn: (args: { role: TeamRole; userId: string }) =>
      teamsApi.patchMember(orgSlug, teamSlug, args.userId, args.role),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['team-members', orgSlug, teamSlug] }),
  })

  const [bindProjectId, setBindProjectId] = useState('')
  const [bindMsg, setBindMsg] = useState<null | string>(null)
  const bindProject = useMutation({
    mutationFn: () => teamsApi.bindProject(bindProjectId, teamSlug),
    onError: (err: { body?: { error?: string } }) => {
      setBindMsg(err.body?.error ?? 'Bind failed')
    },
    onSuccess: () => {
      setBindProjectId('')
      setBindMsg('Project bound')
      void queryClient.invalidateQueries({ queryKey: ['team-projects', orgSlug, teamSlug] })
    },
  })

  const unbindProject = useMutation({
    mutationFn: (projectId: string) => teamsApi.unbindProject(projectId, teamSlug),
    onSuccess: () =>
      void queryClient.invalidateQueries({ queryKey: ['team-projects', orgSlug, teamSlug] }),
  })

  const team = teamQuery.data
  const members = membersQuery.data ?? []
  const projects = projectsQuery.data ?? []
  const orgMembers = orgMembersQuery.data ?? []
  const orgProjects = (allProjectsQuery.data ?? []).filter((p) => p.orgSlug === orgSlug)

  const memberIds = new Set(members.map((m) => m.userId))
  const projectIds = new Set(projects.map((p) => p.id))
  const addableMembers = orgMembers.filter((m) => !memberIds.has(m.userId))
  const bindableProjects = orgProjects.filter((p) => !projectIds.has(p.id))

  if (teamQuery.isLoading) {
    return <div className="text-fg-muted p-6 text-sm">Loading…</div>
  }
  if (!team) {
    return (
      <div className="p-6">
        <p className="text-fg-muted text-sm">Team not found.</p>
        <Link className="text-accent text-sm hover:underline" to={`/org/${orgSlug}/teams`}>
          Back to teams
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-6">
      <header>
        <Link className="text-fg-muted hover:text-fg text-[12px]" to={`/org/${orgSlug}/teams`}>
          ← Back to teams
        </Link>
        <h1 className="text-fg mt-2 text-2xl font-semibold">{team.name}</h1>
        <p className="text-fg-muted mt-1 font-mono text-[12px]">{team.slug}</p>
        {team.description && <p className="text-fg-muted mt-2 text-sm">{team.description}</p>}
      </header>

      <section>
        <h2 className="text-fg text-sm font-semibold">Members</h2>
        {canManage && addableMembers.length > 0 && (
          <form className="mt-3 flex flex-wrap items-center gap-2" onSubmit={onAddMember}>
            <select
              className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1.5 text-[13px]"
              onChange={(e) => setAddUserId(e.target.value)}
              required
              value={addUserId}
            >
              <option value="">Pick an org member…</option>
              {addableMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.email}
                </option>
              ))}
            </select>
            <select
              className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1.5 text-[13px]"
              onChange={(e) => setAddRole(e.target.value as TeamRole)}
              value={addRole}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              className="bg-accent text-bg rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
              disabled={addMember.isPending || !addUserId}
              type="submit"
            >
              {addMember.isPending ? 'Adding…' : 'Add'}
            </button>
            {addMsg && <span className="text-fg-muted text-[12px]">{addMsg}</span>}
          </form>
        )}
        {members.length === 0 ? (
          <p className="text-fg-muted mt-3 text-sm">No members yet.</p>
        ) : (
          <table className="mt-3 w-full border-collapse">
            <thead>
              <tr className="text-fg-muted border-border border-b text-left text-[12px] uppercase">
                <th className="px-2 py-2 font-medium">Email</th>
                <th className="px-2 py-2 font-medium">Role</th>
                <th className="px-2 py-2 font-medium">Joined</th>
                {canManage && <th className="px-2 py-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr className={`border-border border-b ${dCls.rowClass}`} key={m.userId}>
                  <td className="text-fg px-2 py-2 text-[13px]">{m.email}</td>
                  <td className="px-2 py-2">
                    {canManage ? (
                      <select
                        className="border-border bg-bg-tertiary text-fg rounded border px-1.5 py-0.5 text-[12px]"
                        onChange={(e) =>
                          patchMemberRole.mutate({
                            role: e.target.value as TeamRole,
                            userId: m.userId,
                          })
                        }
                        value={m.role}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <RoleBadge role={m.role} />
                    )}
                  </td>
                  <td className="text-fg-muted px-2 py-2 text-[12px] tabular-nums">
                    {new Date(m.createdAt).toLocaleDateString()}
                  </td>
                  {canManage && (
                    <td className="px-2 py-2 text-right">
                      <button
                        className="text-fg-muted hover:text-danger text-[12px]"
                        onClick={() => removeMember.mutate(m.userId)}
                        type="button"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-fg text-sm font-semibold">Projects</h2>
        <p className="text-fg-muted mt-1 text-[12px]">
          Bind projects to this team to scope access. Projects with no team binding stay open to
          every org member.
        </p>
        {canManage && bindableProjects.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1.5 text-[13px]"
              onChange={(e) => setBindProjectId(e.target.value)}
              value={bindProjectId}
            >
              <option value="">Pick a project…</option>
              {bindableProjects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button
              className="bg-accent text-bg rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
              disabled={bindProject.isPending || !bindProjectId}
              onClick={() => bindProject.mutate()}
              type="button"
            >
              {bindProject.isPending ? 'Binding…' : 'Bind project'}
            </button>
            {bindMsg && <span className="text-fg-muted text-[12px]">{bindMsg}</span>}
          </div>
        )}
        {projects.length === 0 ? (
          <p className="text-fg-muted mt-3 text-sm">No projects bound.</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {projects.map((p) => (
              <li
                className="border-border flex items-center justify-between rounded-md border px-3 py-2"
                key={p.id}
              >
                <span className="text-fg text-[13px]">{p.name}</span>
                {canManage && (
                  <button
                    className="text-fg-muted hover:text-danger text-[12px]"
                    onClick={() => unbindProject.mutate(p.id)}
                    type="button"
                  >
                    Unbind
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

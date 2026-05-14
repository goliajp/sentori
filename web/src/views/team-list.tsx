import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link } from 'react-router'

import { teamsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { useHasPermission } from '@/auth/useHasPermission'
import { densityClasses, useDensity } from '@/lib/density'

export function TeamListView() {
  const { currentOrg } = useOrg()
  const slug = currentOrg.slug
  const canManage = useHasPermission('team.manage')
  const dCls = densityClasses(useDensity().density)
  const queryClient = useQueryClient()

  const teamsQuery = useQuery({
    queryFn: () => teamsApi.list(slug),
    queryKey: ['teams', slug],
  })

  const [newSlug, setNewSlug] = useState('')
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [createMsg, setCreateMsg] = useState<null | string>(null)

  const createTeam = useMutation({
    mutationFn: () =>
      teamsApi.create(slug, {
        description: newDesc.trim() || undefined,
        name: newName.trim(),
        slug: newSlug.trim(),
      }),
    onError: (err: { body?: { error?: string } }) => {
      setCreateMsg(err.body?.error ?? 'Create failed')
    },
    onSuccess: () => {
      setNewSlug('')
      setNewName('')
      setNewDesc('')
      setCreateMsg('Team created')
      void queryClient.invalidateQueries({ queryKey: ['teams', slug] })
    },
  })

  const onCreate = (e: FormEvent) => {
    e.preventDefault()
    setCreateMsg(null)
    createTeam.mutate()
  }

  const deleteTeam = useMutation({
    mutationFn: (teamSlug: string) => teamsApi.delete(slug, teamSlug),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['teams', slug] }),
  })

  const teams = teamsQuery.data ?? []

  return (
    <div className="space-y-8 p-6">
      <header>
        <h1 className="text-fg text-2xl font-semibold">Teams</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Group members into teams; bind projects to a team to scope access. Org admins and owners
          can manage everything; team leads can manage their own members.
        </p>
      </header>

      {canManage && (
        <section className="border-border rounded-lg border p-4">
          <h2 className="text-fg text-sm font-semibold">Create team</h2>
          <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={onCreate}>
            <input
              className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1.5 t-md"
              maxLength={32}
              minLength={3}
              onChange={(e) => setNewSlug(e.target.value)}
              pattern="[a-z0-9-]+"
              placeholder="slug (a-z 0-9 -)"
              required
              value={newSlug}
            />
            <input
              className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1.5 t-md"
              maxLength={64}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Display name"
              required
              value={newName}
            />
            <input
              className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1.5 t-md sm:col-span-2"
              maxLength={280}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              value={newDesc}
            />
            <div className="flex items-center gap-3 sm:col-span-2">
              <button
                className="bg-accent text-bg rounded-md px-3 py-1.5 t-md font-medium disabled:opacity-50"
                disabled={createTeam.isPending}
                type="submit"
              >
                {createTeam.isPending ? 'Creating…' : 'Create'}
              </button>
              {createMsg && <span className="text-fg-muted t-md">{createMsg}</span>}
            </div>
          </form>
        </section>
      )}

      <section>
        {teamsQuery.isLoading ? (
          <p className="text-fg-muted text-sm">Loading…</p>
        ) : teams.length === 0 ? (
          <p className="text-fg-muted text-sm">
            No teams yet. {canManage ? 'Create one above to get started.' : ''}
          </p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-fg-muted border-border border-b text-left t-md uppercase">
                <th className="px-2 py-2 font-medium">Slug</th>
                <th className="px-2 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Description</th>
                <th className="px-2 py-2 font-medium">Created</th>
                {canManage && <th className="px-2 py-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr
                  className={`border-border hover:bg-bg-tertiary border-b ${dCls.rowClass}`}
                  key={t.id}
                >
                  <td className="px-2 py-2">
                    <Link
                      className="text-accent font-mono t-md hover:underline"
                      to={`/org/${slug}/teams/${t.slug}`}
                    >
                      {t.slug}
                    </Link>
                  </td>
                  <td className="text-fg px-2 py-2 t-md">{t.name}</td>
                  <td className="text-fg-muted px-2 py-2 t-md">{t.description ?? '—'}</td>
                  <td className="text-fg-muted px-2 py-2 t-md tabular-nums">
                    {new Date(t.createdAt).toLocaleDateString()}
                  </td>
                  {canManage && (
                    <td className="px-2 py-2 text-right">
                      <button
                        className="text-fg-muted hover:text-danger t-md"
                        onClick={() => {
                          if (
                            confirm(
                              `Delete team "${t.name}"? Projects bound to it will become accessible to all org members again.`
                            )
                          ) {
                            deleteTeam.mutate(t.slug)
                          }
                        }}
                        type="button"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

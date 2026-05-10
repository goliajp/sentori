import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, useParams } from 'react-router'

import { recipientsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'

export function RecipientSettingsView() {
  const { projectId } = useParams<{ projectId: string }>()
  const { currentOrg, projects } = useOrg()
  const project = projects.find((p) => p.id === projectId)
  const queryClient = useQueryClient()

  const recipientsQuery = useQuery({
    enabled: !!projectId,
    queryFn: () => recipientsApi.list(projectId!),
    queryKey: ['recipients', projectId],
  })

  const [email, setEmail] = useState('')
  const [onNewIssue, setOnNewIssue] = useState(true)
  const [onRegression, setOnRegression] = useState(false)
  const [msg, setMsg] = useState<null | string>(null)

  const addMutation = useMutation({
    mutationFn: () =>
      recipientsApi.create(projectId!, {
        email: email.trim(),
        onNewIssue,
        onRegression,
      }),
    onError: (err: { body?: { error?: string } }) => {
      setMsg(err.body?.error ?? 'Add failed')
    },
    onSuccess: () => {
      setEmail('')
      setMsg(null)
      void queryClient.invalidateQueries({ queryKey: ['recipients', projectId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => recipientsApi.delete(projectId!, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recipients', projectId] }),
  })

  const patchMutation = useMutation({
    mutationFn: (vars: { id: string; onNewIssue?: boolean; onRegression?: boolean }) =>
      recipientsApi.patch(projectId!, vars.id, {
        onNewIssue: vars.onNewIssue,
        onRegression: vars.onRegression,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recipients', projectId] }),
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    addMutation.mutate()
  }

  if (!projectId || !project) {
    return (
      <div className="text-fg-muted px-6 py-8 text-sm">
        Project not found in {currentOrg.name}.{' '}
        <Link className="text-accent hover:underline" to={`/org/${currentOrg.slug}/issues`}>
          Back to issues
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-6 py-8 text-[13px]">
      <header>
        <h1 className="text-fg text-lg font-semibold">Notification recipients — {project.name}</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Emails listed here receive new-issue / regression alerts for this project.
        </p>
        <div className="text-fg-muted mt-2 flex gap-3 text-xs">
          <Link
            className="hover:text-fg"
            to={`/org/${currentOrg.slug}/projects/${projectId}/settings/tokens`}
          >
            Tokens →
          </Link>
          <Link
            className="hover:text-fg"
            to={`/org/${currentOrg.slug}/projects/${projectId}/settings/teams`}
          >
            Team access →
          </Link>
        </div>
      </header>

      <section className="space-y-3">
        <form className="flex flex-wrap items-center gap-3" onSubmit={onSubmit}>
          <input
            className="border-border bg-bg-tertiary text-fg focus:ring-accent flex-1 rounded-md border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@example.com"
            required
            type="email"
            value={email}
          />
          <label className="text-fg-muted flex items-center gap-1.5 text-xs">
            <input
              checked={onNewIssue}
              onChange={(e) => setOnNewIssue(e.target.checked)}
              type="checkbox"
            />
            New issues
          </label>
          <label className="text-fg-muted flex items-center gap-1.5 text-xs">
            <input
              checked={onRegression}
              onChange={(e) => setOnRegression(e.target.checked)}
              type="checkbox"
            />
            Regressions
          </label>
          <button
            className="bg-accent text-bg rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={addMutation.isPending || !email.trim()}
            type="submit"
          >
            {addMutation.isPending ? 'Adding…' : 'Add'}
          </button>
        </form>
        {msg && <p className="text-fg-muted text-xs">{msg}</p>}
      </section>

      <section>
        {recipientsQuery.isLoading && <p className="text-fg-muted">Loading…</p>}
        {recipientsQuery.data && recipientsQuery.data.length === 0 && (
          <p className="text-fg-muted text-sm">No recipients yet.</p>
        )}
        {recipientsQuery.data && recipientsQuery.data.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-fg-muted border-border h-7 border-b text-left text-[11px] tracking-wider uppercase">
                <th className="px-2 font-medium">Email</th>
                <th className="w-28 px-2 text-center font-medium">New issues</th>
                <th className="w-28 px-2 text-center font-medium">Regressions</th>
                <th className="w-20 px-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {recipientsQuery.data.map((r) => (
                <tr className="border-border/40 h-9 border-b" key={r.id}>
                  <td className="text-fg px-2 font-mono">{r.email}</td>
                  <td className="px-2 text-center">
                    <input
                      checked={r.onNewIssue}
                      onChange={(e) =>
                        patchMutation.mutate({ id: r.id, onNewIssue: e.target.checked })
                      }
                      type="checkbox"
                    />
                  </td>
                  <td className="px-2 text-center">
                    <input
                      checked={r.onRegression}
                      onChange={(e) =>
                        patchMutation.mutate({ id: r.id, onRegression: e.target.checked })
                      }
                      type="checkbox"
                    />
                  </td>
                  <td className="px-2 text-right">
                    <button
                      className="text-fg-muted hover:text-fg text-xs"
                      onClick={() => {
                        if (confirm(`Remove ${r.email}?`)) deleteMutation.mutate(r.id)
                      }}
                      type="button"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <Link
        className="text-fg-muted hover:text-fg block text-sm"
        to={`/org/${currentOrg.slug}/issues`}
      >
        ← Back to issues
      </Link>
    </div>
  )
}

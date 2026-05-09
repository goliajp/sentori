import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { Link, useParams } from 'react-router'

import { type TokenCreated, tokensApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'

export function TokenSettingsView() {
  const { projectId } = useParams<{ projectId: string }>()
  const { currentOrg, projects } = useOrg()
  const project = projects.find((p) => p.id === projectId)
  const queryClient = useQueryClient()

  const tokensQuery = useQuery({
    enabled: !!projectId,
    queryFn: () => tokensApi.list(projectId!),
    queryKey: ['tokens', projectId],
  })

  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'admin' | 'public'>('public')
  const [error, setError] = useState<null | string>(null)
  const [reveal, setReveal] = useState<null | TokenCreated>(null)

  const createMutation = useMutation({
    mutationFn: () =>
      tokensApi.create(projectId!, {
        kind,
        label: label.trim() || undefined,
      }),
    onError: () => setError('Could not create token.'),
    onSuccess: (token) => {
      setLabel('')
      setReveal(token)
      void queryClient.invalidateQueries({ queryKey: ['tokens', projectId] })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (id: string) => tokensApi.revoke(projectId!, id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['tokens', projectId] }),
  })

  const onCreate = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    createMutation.mutate()
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
        <h1 className="text-fg text-lg font-semibold">Tokens — {project.name}</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Public tokens go into the SDK. Admin tokens are reserved for CLI / scripted clients. Both
          are revocable; the raw value is shown only once at create time.
        </p>
        <div className="text-fg-muted mt-2 flex gap-3 text-xs">
          <Link
            className="hover:text-fg"
            to={`/org/${currentOrg.slug}/projects/${projectId}/settings/recipients`}
          >
            Notification recipients →
          </Link>
        </div>
      </header>

      {reveal && (
        <div className="border-accent/40 bg-accent/5 space-y-2 rounded-md border p-4">
          <div className="text-accent text-[11px] tracking-wider uppercase">
            New token — visible once
          </div>
          <code className="text-fg block font-mono text-sm break-all">{reveal.token}</code>
          <div className="flex gap-3 text-xs">
            <button
              className="text-fg-muted hover:text-fg"
              onClick={() => void navigator.clipboard.writeText(reveal.token)}
              type="button"
            >
              Copy
            </button>
            <button
              className="text-fg-muted hover:text-fg"
              onClick={() => setReveal(null)}
              type="button"
            >
              I've stored it — dismiss
            </button>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <form className="flex flex-wrap items-center gap-3" onSubmit={onCreate}>
          <input
            className="border-border bg-bg-tertiary text-fg focus:ring-accent flex-1 rounded-md border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. ios-prod)"
            value={label}
          />
          <select
            className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1.5 text-sm"
            onChange={(e) => setKind(e.target.value as 'admin' | 'public')}
            value={kind}
          >
            <option value="public">public</option>
            <option value="admin">admin</option>
          </select>
          <button
            className="bg-accent text-bg rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
            disabled={createMutation.isPending}
            type="submit"
          >
            {createMutation.isPending ? 'Generating…' : 'Generate token'}
          </button>
        </form>
        {error && <p className="text-sm text-red-400">{error}</p>}
      </section>

      <section>
        {tokensQuery.isLoading && <p className="text-fg-muted">Loading…</p>}
        {tokensQuery.data && tokensQuery.data.length === 0 && (
          <p className="text-fg-muted text-sm">No tokens yet.</p>
        )}
        {tokensQuery.data && tokensQuery.data.length > 0 && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-fg-muted border-border h-7 border-b text-left text-[11px] tracking-wider uppercase">
                <th className="px-2 font-medium">Label</th>
                <th className="w-16 px-2 font-medium">Kind</th>
                <th className="w-24 px-2 font-medium">Last 4</th>
                <th className="w-32 px-2 font-medium">Created</th>
                <th className="w-24 px-2 font-medium">Status</th>
                <th className="w-20 px-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {tokensQuery.data.map((t) => (
                <tr className="border-border/40 h-9 border-b" key={t.id}>
                  <td className="text-fg px-2 font-mono">{t.label ?? '(unlabeled)'}</td>
                  <td className="text-fg-muted px-2 font-mono uppercase">{t.kind}</td>
                  <td className="text-fg-muted px-2 font-mono">{t.last4 ? `…${t.last4}` : '—'}</td>
                  <td className="text-fg-muted px-2 font-mono text-[11px] tabular-nums">
                    {new Date(t.createdAt).toISOString().slice(0, 10)}
                  </td>
                  <td
                    className={`px-2 font-mono uppercase ${
                      t.revokedAt ? 'text-fg-muted' : 'text-accent'
                    }`}
                  >
                    {t.revokedAt ? 'revoked' : 'active'}
                  </td>
                  <td className="px-2 text-right">
                    {!t.revokedAt && (
                      <button
                        className="text-fg-muted hover:text-fg text-xs"
                        onClick={() => {
                          if (
                            confirm(
                              `Revoke ${t.label ?? 'this token'}? Existing apps using it will start getting 401s.`
                            )
                          ) {
                            revokeMutation.mutate(t.id)
                          }
                        }}
                        type="button"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

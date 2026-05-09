import { useMutation, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router'

import { orgsApi } from '@/api/client'
import { useAuth } from '@/auth/state'

/**
 * Phase 13 sub-H: fallback create-org page. The server normally
 * bootstraps a personal org on email verification, so most freshly
 * verified users skip this page (RootRedirect sends them straight to
 * their first org). This view is what they see when they have no
 * memberships at all — e.g. they left every org, or the server-side
 * bootstrap failed for some reason. Phase 14 supersedes it with the
 * full SaaS wizard (project create + token reveal + first event poll).
 */
export function OnboardingView() {
  const { logout, user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const initialSlug = user?.email ? slugCandidate(user.email) : ''
  const [name, setName] = useState(initialSlug)
  const [slug, setSlug] = useState(initialSlug)
  const [error, setError] = useState<null | string>(null)

  const createMutation = useMutation({
    mutationFn: () => orgsApi.create(slug.trim(), name.trim()),
    onError: (err: { body?: { error?: string }; status?: number }) => {
      const code = err.body?.error
      if (code === 'invalidSlug') setError('Slug must be 3–32 chars: a-z, 0-9, hyphen.')
      else if (code === 'invalidName') setError('Name is required (1–64 chars).')
      else if (code === 'slugTaken' || err.status === 409)
        setError('That slug is already taken — try another.')
      else setError('Could not create org.')
    },
    onSuccess: (org) => {
      void queryClient.invalidateQueries({ queryKey: ['orgs'] })
      navigate(`/org/${org.slug}/issues`)
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    createMutation.mutate()
  }

  return (
    <div className="bg-bg flex h-full items-center justify-center">
      <form
        className="border-border bg-bg w-[28rem] space-y-4 rounded-lg border p-6"
        onSubmit={onSubmit}
      >
        <div>
          <h1 className="text-fg text-lg font-semibold">Create your organization</h1>
          <p className="text-fg-muted mt-1 text-sm leading-relaxed">
            Signed in as <span className="text-fg font-mono">{user?.email}</span>. You aren't a
            member of any org yet — create one to get started.
          </p>
        </div>
        <label className="block">
          <span className="text-fg-muted text-xs tracking-wider uppercase">Name</span>
          <input
            autoFocus
            className="border-border bg-bg-tertiary text-fg focus:ring-accent mt-1 w-full rounded-md border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
            onChange={(e) => setName(e.target.value)}
            placeholder="Acme Inc"
            required
            value={name}
          />
        </label>
        <label className="block">
          <span className="text-fg-muted text-xs tracking-wider uppercase">Slug</span>
          <input
            className="border-border bg-bg-tertiary text-fg focus:ring-accent mt-1 w-full rounded-md border px-3 py-1.5 font-mono text-sm focus:ring-1 focus:outline-none"
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
            pattern="[a-z0-9-]{3,32}"
            placeholder="acme"
            required
            value={slug}
          />
          <span className="text-fg-muted mt-1 block font-mono text-[11px]">
            sentori.golia.jp/org/{slug || '...'}
          </span>
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          className="bg-accent text-bg w-full rounded-md px-3 py-2 text-sm disabled:opacity-50"
          disabled={createMutation.isPending || !name.trim() || slug.length < 3}
          type="submit"
        >
          {createMutation.isPending ? 'Creating…' : 'Create organization'}
        </button>
        <button
          className="text-fg-muted hover:text-fg w-full text-xs"
          onClick={() => void logout()}
          type="button"
        >
          Sign out instead
        </button>
      </form>
    </div>
  )
}

/** Mirrors the server's email_to_slug_candidate. */
function slugCandidate(email: string): string {
  const local = email.split('@')[0] ?? ''
  const cleaned = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
  return cleaned.length >= 3 ? cleaned : `user-${Math.random().toString(36).slice(2, 8)}`
}

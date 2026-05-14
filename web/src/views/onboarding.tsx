import { useState } from 'react'
import { useNavigate } from 'react-router'

import { orgsApi } from '@/api/client'
import { AuthShell, Field } from './login'

export function OnboardingView() {
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<null | string>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const created = await orgsApi.create(slug, name)
      nav(`/org/${created.slug}/overview`)
    } catch (cause) {
      const body = (cause as { body?: { error?: string } } | undefined)?.body
      setErr(body?.error ?? (cause instanceof Error ? cause.message : 'Failed to create org'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Create your first org">
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Display name" onChange={setName} value={name} />
        <Field label="Slug" onChange={setSlug} value={slug} />
        {err && <div className="text-danger t-sm">{err}</div>}
        <button
          className="bg-accent text-bg t-md w-full rounded px-3 py-1.5 font-medium disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Creating…' : 'Create org'}
        </button>
      </form>
    </AuthShell>
  )
}

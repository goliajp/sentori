import { useState } from 'react'
import { useNavigate } from 'react-router'

import { orgsApi } from '@/api/client'

import { AuthError, AuthShell, Field, PrimaryButton } from './login'

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
      nav(`/main/org/${created.slug}/overview`)
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
        <Field label="display name" onChange={setName} value={name} />
        <Field label="slug" onChange={setSlug} value={slug} />
        {err && <AuthError>{err}</AuthError>}
        <PrimaryButton busy={busy} disabled={!name || !slug}>
          {busy ? 'creating…' : 'create org'}
        </PrimaryButton>
        <p className="font-mono text-[10px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase">
          slug is lowercase, used in URLs (`/org/{'<slug>'}/…`)
        </p>
      </form>
    </AuthShell>
  )
}

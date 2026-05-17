import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { userAuthApi } from '@/api/client'

import { AuthShell, Field, OAuthButtons } from './login'

export function RegisterView() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<null | string>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await userAuthApi.register(email, password)
      nav('/verify', { state: { email } })
    } catch (cause) {
      const body = (cause as { body?: { error?: string } } | undefined)?.body
      setErr(body?.error ?? (cause instanceof Error ? cause.message : 'Registration failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Create account">
      <OAuthButtons />
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Email" onChange={setEmail} type="email" value={email} />
        <Field label="Password" onChange={setPassword} type="password" value={password} />
        {err && <div className="text-danger t-sm">{err}</div>}
        <button
          className="bg-accent text-bg t-md w-full rounded px-3 py-1.5 font-medium disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Creating…' : 'Create account'}
        </button>
      </form>
      <div className="text-fg-muted t-sm mt-4 text-center">
        Already have an account?{' '}
        <Link className="hover:text-fg" to="/login">
          Sign in
        </Link>
      </div>
    </AuthShell>
  )
}

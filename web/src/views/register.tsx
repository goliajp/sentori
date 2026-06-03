import { useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { userAuthApi } from '@/api/client'

import { AuthError, AuthShell, Field, FooterLinks, OAuthButtons, PrimaryButton } from './login'

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
        <Field autoComplete="email" label="email" onChange={setEmail} type="email" value={email} />
        <Field
          autoComplete="new-password"
          label="password"
          onChange={setPassword}
          type="password"
          value={password}
        />
        {err && <AuthError>{err}</AuthError>}
        <PrimaryButton busy={busy} disabled={password.length < 8}>
          {busy ? 'creating…' : 'create account'}
        </PrimaryButton>
        <p className="text-fg-muted font-mono text-[10px] tracking-[0.12em] uppercase">
          8 characters minimum
        </p>
      </form>
      <FooterLinks>
        <span>already a member?</span>
        <Link className="text-fg hover:text-accent" to="/login">
          sign in
        </Link>
      </FooterLinks>
    </AuthShell>
  )
}

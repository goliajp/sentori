import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'

import { userAuthApi } from '@/api/client'

import { AuthError, AuthShell, Field, FooterLinks, PrimaryButton } from './login'

/**
 * Reset-password — `POST /auth/reset-password` with the token from
 * the URL + the new password. Token is single-use; server returns
 * 400 `tokenAlreadyUsed` / `tokenExpired` / `tokenInvalid` on the
 * unhappy paths.
 *
 * On success all existing sessions are invalidated server-side, so
 * we route to /login (not /) — the user has to sign in again with
 * the new password.
 */
export function ResetPasswordView() {
  const { token } = useParams<{ token: string }>()
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<null | string>(null)
  const [done, setDone] = useState(false)

  if (!token) return <Navigate replace to="/forgot-password" />

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await userAuthApi.resetPassword(token, password)
      setDone(true)
      setTimeout(() => nav('/login'), 1800)
    } catch (cause) {
      const body = (cause as { body?: { error?: string } } | undefined)?.body
      setErr(body?.error ?? (cause instanceof Error ? cause.message : 'Reset failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Set a new password">
      {done ? (
        <p className="text-[13px] text-[color:var(--ink-soft)]">
          Password reset. All your other sessions were signed out. Redirecting to sign-in…
        </p>
      ) : (
        <form className="space-y-3" onSubmit={submit}>
          <Field
            autoComplete="new-password"
            label="new password"
            onChange={setPassword}
            type="password"
            value={password}
          />
          {err && <AuthError>{err}</AuthError>}
          <PrimaryButton busy={busy} disabled={password.length < 8}>
            {busy ? 'resetting…' : 'set password'}
          </PrimaryButton>
          <p className="font-mono text-[10px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase">
            8 characters minimum
          </p>
        </form>
      )}
      <FooterLinks>
        <Link className="hover:text-[color:var(--accent)]" to="/login">
          back to sign in
        </Link>
      </FooterLinks>
    </AuthShell>
  )
}

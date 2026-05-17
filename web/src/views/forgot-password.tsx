import { useState } from 'react'
import { Link } from 'react-router'

import { userAuthApi } from '@/api/client'

import { AuthShell, Field } from './login'

/**
 * Forgot-password — issue a reset email. The endpoint always returns
 * 200 OK regardless of whether the email matches a real user (standard
 * "don't leak which addresses are registered" pattern), so the success
 * state is the same shape either way.
 *
 * The reset link is logged server-side at tracing INFO; operators wire
 * their own SMTP to deliver it. In a self-hosted dev box just tail the
 * server log to find the link.
 */
export function ForgotPasswordView() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState<null | string>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await userAuthApi.forgotPassword(email)
      setSent(true)
    } catch (cause) {
      const body = (cause as { body?: { error?: string } } | undefined)?.body
      setErr(body?.error ?? (cause instanceof Error ? cause.message : 'Request failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Forgot password">
      {sent ? (
        <div className="space-y-3">
          <p className="text-fg-muted t-md">
            If <span className="text-fg font-mono">{email}</span> matches an account, a reset link
            is on its way. The link expires in 2 hours.
          </p>
          <p className="text-fg-muted t-sm">
            Self-hosting? The link is also logged in the server's tracing output — check{' '}
            <code className="font-mono">docker compose logs server</code> if SMTP isn't configured
            yet.
          </p>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={submit}>
          <Field label="Email" onChange={setEmail} type="email" value={email} />
          {err && <div className="text-danger t-sm">{err}</div>}
          <button
            className="bg-accent text-bg t-md w-full rounded px-3 py-1.5 font-medium disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
      <div className="text-fg-muted t-sm mt-4 text-center">
        <Link className="hover:text-fg" to="/login">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  )
}

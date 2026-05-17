import { useState } from 'react'
import { Link } from 'react-router'

import { userAuthApi } from '@/api/client'

import { AuthError, AuthShell, Field, FooterLinks, PrimaryButton } from './login'

/**
 * Forgot-password — issue a reset email. The endpoint always returns
 * 200 OK regardless of whether the email matches a real user (standard
 * "don't leak which addresses are registered" pattern), so the success
 * state is the same shape either way.
 *
 * On a deployment with SMTP wired up (Sentori's prod points at mailrs)
 * the link arrives by email. Self-hosters without SMTP still see the
 * link logged at server tracing INFO — they grep `docker logs`.
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
          <p className="text-[13px] text-[color:var(--ink-soft)]">
            If <span className="font-mono text-[color:var(--ink)]">{email}</span> matches an
            account, a reset link is on its way. The link expires in 48 hours.
          </p>
          <p className="border-t border-[color:var(--rule-soft)] pt-3 font-mono text-[10px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase">
            self-hosting w/o smtp? grep <span className="text-[color:var(--ink)]">docker logs</span>{' '}
            — the link is at info.
          </p>
        </div>
      ) : (
        <form className="space-y-3" onSubmit={submit}>
          <Field
            autoComplete="email"
            label="email"
            onChange={setEmail}
            type="email"
            value={email}
          />
          {err && <AuthError>{err}</AuthError>}
          <PrimaryButton busy={busy}>{busy ? 'sending…' : 'send reset link'}</PrimaryButton>
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

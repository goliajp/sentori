import { type FormEvent, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { userAuthApi } from '@/api/client'

export function RegisterView() {
  const [params] = useSearchParams()
  const nextRaw = params.get('next')
  const next = nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : null
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await userAuthApi.register(email, password)
      setDone(true)
    } catch (err) {
      const body = (err as { body?: { error?: string } })?.body
      const code = body?.error
      if (code === 'invalidEmail') setError('Email looks invalid.')
      else if (code === 'passwordTooShort') setError('Password must be at least 8 characters.')
      else if ((err as { status?: number })?.status === 429)
        setError('Too many attempts — slow down a moment.')
      else setError('Registration failed.')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="bg-bg flex h-full items-center justify-center">
        <div className="border-border bg-bg w-96 space-y-3 rounded-lg border p-6">
          <h1 className="text-fg text-lg font-semibold">Check your inbox</h1>
          <p className="text-fg-muted text-sm leading-relaxed">
            We sent a verification link to <span className="text-fg font-mono">{email}</span>. Open
            it within 24 hours to activate your account, then sign in.
          </p>
          <Link className="text-accent text-sm hover:underline" to={loginHref}>
            Back to sign in
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-bg flex h-full items-center justify-center">
      <form
        className="border-border bg-bg w-80 space-y-4 rounded-lg border p-6"
        onSubmit={onSubmit}
      >
        <div>
          <h1 className="text-fg text-lg font-semibold">Create account</h1>
          <p className="text-fg-muted mt-1 text-sm">Free, self-hosted or hosted.</p>
        </div>
        <input
          autoComplete="email"
          autoFocus
          className="border-border bg-bg-tertiary text-fg focus:ring-accent w-full rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
          name="email"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          type="email"
          value={email}
        />
        <input
          autoComplete="new-password"
          className="border-border bg-bg-tertiary text-fg focus:ring-accent w-full rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
          minLength={8}
          name="password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password (min 8 chars)"
          required
          type="password"
          value={password}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          className="bg-accent text-bg w-full rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={submitting || !email || password.length < 8}
          type="submit"
        >
          {submitting ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-fg-muted text-center text-xs">
          Already have one?{' '}
          <Link className="hover:text-fg" to={loginHref}>
            Sign in
          </Link>
        </p>
      </form>
    </div>
  )
}

import { type FormEvent, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'

import { useAuth } from '@/auth/state'

export function LoginView() {
  const { isAuthed, login } = useAuth()
  const [params] = useSearchParams()
  const next = sanitizeNext(params.get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [submitting, setSubmitting] = useState(false)

  if (isAuthed === true) {
    return <Navigate replace to={next ?? '/'} />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
    } catch (err) {
      const status = (err as { status?: number })?.status
      const body = (err as { body?: { error?: string } })?.body
      if (status === 401) {
        setError('Wrong email or password')
      } else if (status === 403 && body?.error === 'emailNotVerified') {
        setError('Please verify your email — check your inbox for the link.')
      } else if (status === 429) {
        setError('Too many attempts — slow down a moment.')
      } else {
        setError('Login failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-bg flex h-full items-center justify-center">
      <form
        className="border-border bg-bg w-80 space-y-4 rounded-lg border p-6"
        onSubmit={onSubmit}
      >
        <div>
          <h1 className="text-fg text-lg font-semibold">Sentori</h1>
          <p className="text-fg-muted mt-1 text-sm">Sign in to your dashboard.</p>
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
          autoComplete="current-password"
          className="border-border bg-bg-tertiary text-fg focus:ring-accent w-full rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
          name="password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          required
          type="password"
          value={password}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          className="bg-accent text-bg w-full rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={submitting || !email || !password}
          type="submit"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
        <div className="text-fg-muted flex justify-between text-xs">
          <Link
            className="hover:text-fg"
            to={next ? `/register?next=${encodeURIComponent(next)}` : '/register'}
          >
            Create account
          </Link>
          <Link className="hover:text-fg" to="/forgot-password">
            Forgot password?
          </Link>
        </div>
      </form>
    </div>
  )
}

/**
 * Only allow same-origin paths. Drops anything that smells like an open
 * redirect (absolute URL, protocol-relative, double-slash, etc.).
 */
function sanitizeNext(raw: null | string): null | string {
  if (!raw) return null
  if (!raw.startsWith('/')) return null
  if (raw.startsWith('//')) return null
  return raw
}

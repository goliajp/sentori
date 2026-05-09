import { type FormEvent, useState } from 'react'
import { Navigate } from 'react-router'

import { useAuth } from '@/auth/state'

export function LoginView() {
  const { isAuthed, login } = useAuth()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<null | string>(null)
  const [submitting, setSubmitting] = useState(false)

  if (isAuthed === true) {
    return <Navigate replace to="/issues" />
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(password)
    } catch (err) {
      const status = (err as { status?: number })?.status
      setError(status === 401 ? 'Wrong password' : 'Login failed')
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
          <p className="text-fg-muted mt-1 text-sm">Sign in to the admin dashboard.</p>
        </div>
        <input
          autoComplete="current-password"
          autoFocus
          className="border-border bg-bg-tertiary text-fg focus:ring-accent w-full rounded-md border px-3 py-2 text-sm focus:ring-1 focus:outline-none"
          name="password"
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="password"
          value={password}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          className="bg-accent text-bg w-full rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
          disabled={submitting || !password}
          type="submit"
        >
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  )
}

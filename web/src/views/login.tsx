import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'

import { useAuth } from '@/auth/state'

export function LoginView() {
  const { isAuthed, login } = useAuth()
  const nav = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<null | string>(null)

  if (isAuthed) {
    const to = (location.state as { from?: string } | null)?.from ?? '/'
    return <Navigate replace to={to} />
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      await login(email, password)
      nav('/')
    } catch (cause) {
      setErr(cause instanceof Error ? cause.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title="Sign in">
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Email" onChange={setEmail} type="email" value={email} />
        <Field label="Password" onChange={setPassword} type="password" value={password} />
        {err && <div className="text-danger t-sm">{err}</div>}
        <button
          className="bg-accent text-bg t-md w-full rounded px-3 py-1.5 font-medium disabled:opacity-50"
          disabled={busy}
          type="submit"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <div className="text-fg-muted t-sm mt-4 text-center">
        <Link className="hover:text-fg" to="/register">
          Create account
        </Link>
        <span className="mx-2">·</span>
        <Link className="hover:text-fg" to="/forgot-password">
          Forgot password?
        </Link>
      </div>
    </AuthShell>
  )
}

export function AuthShell({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="bg-bg flex h-full items-center justify-center">
      <div className="w-80">
        <h1
          className="text-fg t-lg mb-4 text-center font-semibold"
          style={{ letterSpacing: '0.22em' }}
        >
          SENTORI
        </h1>
        <div className="border-border bg-bg-secondary/30 rounded-md border p-4">
          <h2 className="text-fg t-md mb-3 font-semibold">{title}</h2>
          {children}
        </div>
      </div>
    </div>
  )
}

export function Field({
  autoComplete,
  label,
  onChange,
  type = 'text',
  value,
}: {
  autoComplete?: string
  label: string
  onChange: (v: string) => void
  type?: string
  value: string
}) {
  return (
    <label className="block">
      <span className="text-fg-muted t-sm mb-1 block">{label}</span>
      <input
        autoComplete={autoComplete}
        className="border-border bg-bg t-md text-fg focus:border-accent w-full rounded border px-2.5 py-1.5 outline-none"
        onChange={(e) => onChange(e.target.value)}
        required
        type={type}
        value={value}
      />
    </label>
  )
}

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'

import { userAuthApi } from '@/api/client'
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

/**
 * OAuth provider buttons — Google + GitHub. Polls
 * `/auth/oauth/providers` to see which the server has env-vars for,
 * hides the rest. When neither is configured the whole block is
 * suppressed (no awkward divider over an empty list).
 *
 * The /auth/oauth/{provider}/start handler isn't wired yet — these
 * buttons currently navigate to the start URL which 404s until the
 * follow-up commit. That's still the right shape because the dashboard
 * surface is the gate: the moment the env-vars + start handler land,
 * the buttons go live with no dashboard change.
 */
export function OAuthButtons() {
  const providersQ = useQuery({
    queryFn: userAuthApi.listOAuthProviders,
    queryKey: ['oauth-providers'],
    staleTime: 5 * 60 * 1000,
  })

  const providers = providersQ.data
  if (!providers) return null
  if (!providers.github && !providers.google) return null

  return (
    <div className="mb-4 space-y-2">
      {providers.github && (
        <a
          className="border-border bg-bg t-md text-fg hover:border-fg-muted flex w-full items-center justify-center gap-2 rounded border px-3 py-1.5"
          href="/api/auth/oauth/github/start"
        >
          <GitHubGlyph /> Continue with GitHub
        </a>
      )}
      {providers.google && (
        <a
          className="border-border bg-bg t-md text-fg hover:border-fg-muted flex w-full items-center justify-center gap-2 rounded border px-3 py-1.5"
          href="/api/auth/oauth/google/start"
        >
          <GoogleGlyph /> Continue with Google
        </a>
      )}
      <div className="text-fg-muted t-sm relative my-2 flex items-center gap-2">
        <span className="border-border flex-1 border-t" />
        <span className="text-[10px] tracking-[0.18em] uppercase">or</span>
        <span className="border-border flex-1 border-t" />
      </div>
    </div>
  )
}

function GitHubGlyph() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-1.98c-3.2.7-3.87-1.54-3.87-1.54-.52-1.32-1.27-1.67-1.27-1.67-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.75 2.69 1.25 3.35.96.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.19 1.18a11.1 11.1 0 0 1 5.8 0c2.22-1.5 3.19-1.18 3.19-1.18.62 1.59.23 2.76.11 3.05.73.81 1.18 1.84 1.18 3.1 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.07.78 2.17v3.21c0 .31.21.68.8.56C20.21 21.39 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5z" />
    </svg>
  )
}

function GoogleGlyph() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#EA4335"
        d="M12 10.9v3.2h5c-.2 1.3-1.5 3.8-5 3.8-3 0-5.5-2.5-5.5-5.6S9 6.7 12 6.7c1.7 0 2.9.7 3.5 1.3l2.4-2.3C16.3 4.2 14.3 3.3 12 3.3c-4.8 0-8.7 3.9-8.7 8.7s3.9 8.7 8.7 8.7c5 0 8.4-3.5 8.4-8.5 0-.6-.1-1-.1-1.4H12z"
      />
    </svg>
  )
}

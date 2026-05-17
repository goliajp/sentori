import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'

import { userAuthApi } from '@/api/client'
import { useAuth } from '@/auth/state'
import { SENTORI_VERSION } from '@/version'

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
        <Field autoComplete="email" label="email" onChange={setEmail} type="email" value={email} />
        <Field
          autoComplete="current-password"
          label="password"
          onChange={setPassword}
          type="password"
          value={password}
        />
        {err && <AuthError>{err}</AuthError>}
        <PrimaryButton busy={busy}>{busy ? 'signing in…' : 'sign in'}</PrimaryButton>
      </form>
      <FooterLinks>
        <Link className="hover:text-[color:var(--accent)]" to="/register">
          create account
        </Link>
        <span className="text-[color:var(--ink-muted)]/50">·</span>
        <Link className="hover:text-[color:var(--accent)]" to="/forgot-password">
          forgot password
        </Link>
      </FooterLinks>
    </AuthShell>
  )
}

/**
 * Editorial auth-page shell. Paper page + centered column, wordmark
 * + accent terminal dot + version micro-tag floating above a single
 * hairline-bracketed content strip. No card, no rounded chrome —
 * matches the dashboard's rule-grid lexicon.
 *
 *   SENTORI ·  ← wordmark with tora-orange dot
 *   v1.0.0     ← mono micro-tag
 *
 *   ── SIGN IN ────────────  ← top hairline + caps title
 *   <content>
 *   ───────────────────────  ← bottom hairline
 *   create account · forgot
 */
export function AuthShell({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-[color:var(--paper)] px-4 py-12">
      <div className="w-full max-w-[360px]">
        <div className="mb-7 flex items-baseline justify-center gap-2">
          <span
            className="text-[color:var(--ink)] uppercase"
            style={{
              fontFamily: 'var(--font-sans)',
              fontVariationSettings: "'wdth' 95, 'opsz' 48, 'wght' 600",
              fontSize: '18px',
              letterSpacing: '0.24em',
            }}
          >
            SENTORI
            <span
              aria-hidden
              className="ml-1.5 inline-block"
              style={{
                background: 'var(--accent)',
                borderRadius: '50%',
                height: '6px',
                transform: 'translateY(-2px)',
                width: '6px',
              }}
            />
          </span>
          <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
            {SENTORI_VERSION}
          </span>
        </div>

        <div className="border-y border-[color:var(--rule)]">
          <header className="flex items-baseline gap-3 px-px py-2.5">
            <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--accent)] uppercase">
              ·
            </span>
            <h2
              className="text-[color:var(--ink)]"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '11px',
                fontWeight: 500,
                letterSpacing: '0.22em',
                textTransform: 'uppercase',
              }}
            >
              {title}
            </h2>
          </header>
          <div className="border-t border-[color:var(--rule-soft)] px-px py-5">{children}</div>
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
      <span className="mb-1 block font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </span>
      <input
        autoComplete={autoComplete}
        className="h-9 w-full border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2.5 text-[13px] text-[color:var(--ink)] outline-none focus:border-[color:var(--accent)]"
        onChange={(e) => onChange(e.target.value)}
        required
        type={type}
        value={value}
      />
    </label>
  )
}

export function PrimaryButton({
  busy,
  children,
  disabled,
}: {
  busy?: boolean
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      className="mt-1 inline-flex h-9 w-full items-center justify-center bg-[color:var(--accent)] px-3 font-mono text-[11px] tracking-[0.12em] text-[color:var(--paper)] uppercase transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      disabled={busy || disabled}
      type="submit"
    >
      {children}
    </button>
  )
}

export function AuthError({ children }: { children: React.ReactNode }) {
  return (
    <div
      aria-live="polite"
      className="border border-[color:var(--danger-border)] bg-[color:var(--danger-bg)] px-2.5 py-1.5 font-mono text-[11px] text-[color:var(--danger)]"
    >
      {children}
    </div>
  )
}

export function FooterLinks({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-5 flex items-center justify-center gap-2 font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
      {children}
    </div>
  )
}

/**
 * OAuth provider buttons — Google + GitHub. Polls
 * `/auth/oauth/providers` to see which the server has env-vars for,
 * hides the rest. When neither is configured the whole block is
 * suppressed (no awkward divider over an empty list).
 *
 * Style matches the editorial form: paper-2 fill with a hairline
 * border, mono-cap label, hover ramps to ink-soft border. No rounded
 * corners — the rest of the page is square.
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
    <div className="mb-5 space-y-2">
      {providers.github && (
        <a
          className="flex h-9 w-full items-center justify-center gap-2 border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-3 text-[13px] text-[color:var(--ink)] transition-colors hover:border-[color:var(--ink-soft)]"
          href="/api/auth/oauth/github/start"
        >
          <GitHubGlyph /> Continue with GitHub
        </a>
      )}
      {providers.google && (
        <a
          className="flex h-9 w-full items-center justify-center gap-2 border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-3 text-[13px] text-[color:var(--ink)] transition-colors hover:border-[color:var(--ink-soft)]"
          href="/api/auth/oauth/google/start"
        >
          <GoogleGlyph /> Continue with Google
        </a>
      )}
      <div className="relative my-3 flex items-center gap-2 font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
        <span className="h-px flex-1 bg-[color:var(--rule)]" />
        <span>or with email</span>
        <span className="h-px flex-1 bg-[color:var(--rule)]" />
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
      <path
        fill="#34A853"
        d="M3.9 7.4l2.7 2c.7-1.5 2.2-2.7 5.4-2.7v-3.4C8.6 3.3 5.4 4.7 3.9 7.4z"
      />
      <path
        fill="#FBBC05"
        d="M3.9 7.4C3.4 8.7 3.3 10 3.3 11.3c0 1.3.2 2.6.6 3.9l3.3-2.5c-.2-.5-.3-1-.3-1.5s.1-.9.3-1.4L3.9 7.4z"
      />
      <path
        fill="#4285F4"
        d="M20.5 11.9c0-.6-.1-1-.1-1.4H12v3.2h5c-.2 1.3-1.5 3.8-5 3.8v3.4c4.8 0 8.5-3.4 8.5-9z"
      />
    </svg>
  )
}

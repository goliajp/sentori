import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { adminApi, isStructuredError, userAuthApi } from '@/api/client'
import { useAuth } from '@/auth/state'
import { PageHeader } from '@/layout/page-header'
import { qk } from '@/api/query-keys'
import { gravatarFor } from '@/lib/gravatar'

/**
 * Personal account page — `/account`.
 *
 * Mirrors GitHub's settings → profile + password panes. Three blocks:
 *
 *   1. Profile — display name + avatar URL (gravatar is the default
 *      fallback when avatar URL is empty)
 *   2. Account — read-only email + user id, "sign out everywhere" tbd
 *   3. Password — change-password form (current + new)
 *
 * Lives outside the org-scoped tree so the page works even when the
 * user belongs to zero orgs (e.g. right after invite-accept dropout).
 */
export function AccountView() {
  const { refresh, user } = useAuth()
  const qc = useQueryClient()

  const meQ = useQuery({ queryFn: userAuthApi.me, queryKey: qk.me() })

  const me = meQ.data?.user ?? user

  // After any profile mutation: invalidate react-query + push fresh
  // /me into the AuthProvider so the toolbar avatar + every
  // other `useAuth().user` consumer reflects the change.
  const onProfileSaved = () => {
    void qc.invalidateQueries({ queryKey: qk.me() })
    void refresh()
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <PageHeader subtitle="account settings" title="Account" />

      <ProfileBlock
        avatarUrl={me?.avatarUrl ?? null}
        displayName={me?.displayName ?? null}
        email={me?.email ?? ''}
        onSaved={onProfileSaved}
      />

      <ReadonlyBlock id={me?.id ?? ''} email={me?.email ?? ''} />

      <PasswordBlock />

      <NotificationsBlock />

      <SecurityBlock />
    </div>
  )
}

function SecurityBlock() {
  const [busy, setBusy] = useState(false)
  const [ok, setOk] = useState(false)
  const [err, setErr] = useState<null | string>(null)

  const onClick = async () => {
    if (
      !confirm('Sign out of every device except this one? You will keep your current session here.')
    ) {
      return
    }
    setBusy(true)
    setErr(null)
    setOk(false)
    try {
      await userAuthApi.signOutEverywhere()
      setOk(true)
    } catch (e) {
      const body = (e as { body?: { error?: string } } | undefined)?.body
      setErr(body?.error ?? (e instanceof Error ? e.message : 'request failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-8">
      <header className="sec-head">
        <span className="sec-head-title">Security</span>
        <span className="sec-head-sub">device sessions</span>
      </header>
      <div className="border-border flex flex-col gap-2 border-y py-5">
        <p className="text-fg-secondary text-[13px]">
          Sign out of every other device. Your current browser session stays valid; everywhere else
          has to sign in again.
        </p>
        <div className="flex items-center gap-3">
          <button
            className="border-border bg-bg-secondary text-fg hover:border-danger hover:text-danger inline-flex h-7 items-center border px-3 font-mono text-[11px] tracking-[0.05em] uppercase transition-colors disabled:opacity-50"
            disabled={busy}
            onClick={() => void onClick()}
            type="button"
          >
            {busy ? 'signing out…' : 'sign out other devices'}
          </button>
          {ok && (
            <span className="text-success font-mono text-[11px]">other sessions signed out ✓</span>
          )}
          {err && <span className="text-danger font-mono text-[11px]">{err}</span>}
        </div>
      </div>
    </section>
  )
}

function ProfileBlock({
  avatarUrl,
  displayName,
  email,
  onSaved,
}: {
  avatarUrl: null | string
  displayName: null | string
  email: string
  onSaved: () => void
}) {
  // Initial values come from server; once the user starts typing
  // we own the inputs locally. (No useEffect-driven re-sync: that
  // would clobber edits in flight and triggers the React 19 lint
  // about setState in effects.)
  const [name, setName] = useState(displayName ?? '')
  const [url, setUrl] = useState(avatarUrl ?? '')
  const [err, setErr] = useState<null | string>(null)
  const [ok, setOk] = useState(false)

  const m = useMutation({
    mutationFn: () =>
      userAuthApi.patchMe({
        avatarUrl: url.trim() || null,
        displayName: name.trim() || null,
      }),
    onError: (e) => {
      const body = (e as { body?: { error?: string } } | undefined)?.body
      setErr(body?.error ?? (e instanceof Error ? e.message : 'Save failed'))
      setOk(false)
    },
    onSuccess: () => {
      setOk(true)
      setErr(null)
      onSaved()
    },
  })

  const effectiveAvatar = url.trim() || gravatarFor(email)

  return (
    <section className="mt-8">
      <header className="sec-head">
        <span className="sec-head-title">Profile</span>
        <span className="sec-head-sub">how you appear in the dashboard</span>
      </header>
      <form
        className="border-border flex flex-col gap-4 border-y py-5 md:flex-row md:items-start"
        onSubmit={(e) => {
          e.preventDefault()
          m.mutate()
        }}
      >
        <img
          alt="Your avatar"
          className="border-border size-24 shrink-0 rounded-full border object-cover"
          src={effectiveAvatar}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
              display name
            </span>
            <input
              className="border-border bg-bg-secondary text-fg focus:border-accent h-8 border px-2 text-[13px] focus:outline-none"
              onChange={(e) => setName(e.target.value)}
              placeholder={localPart(email)}
              value={name}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
              avatar URL (optional)
            </span>
            <input
              className="border-border bg-bg-secondary text-fg focus:border-accent h-8 border px-2 font-mono text-[12px] focus:outline-none"
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/avatar.png"
              value={url}
            />
            <span className="text-fg-muted text-[11px]">
              Leave blank to fall back to a Gravatar derived from your email.
            </span>
          </label>

          <div className="flex items-center gap-3">
            <button
              className="bg-accent text-bg inline-flex h-7 items-center px-3 font-mono text-[11px] tracking-[0.05em] uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
              disabled={m.isPending}
              type="submit"
            >
              {m.isPending ? 'saving…' : 'save profile'}
            </button>
            {ok && <span className="text-success font-mono text-[11px]">saved ✓</span>}
            {err && <span className="text-danger font-mono text-[11px]">{err}</span>}
          </div>
        </div>
      </form>
    </section>
  )
}

function ReadonlyBlock({ id, email }: { id: string; email: string }) {
  return (
    <section className="mt-8">
      <header className="sec-head">
        <span className="sec-head-title">Account</span>
        <span className="sec-head-sub">identity · stable across sessions</span>
      </header>
      <div className="border-border border-y py-2">
        <RoRow label="email" value={email} />
        <RoRow label="user id" value={id} />
      </div>
    </section>
  )
}

function RoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-baseline gap-3 py-2">
      <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
        {label}
      </span>
      <span className="text-fg font-mono text-[12px] break-all">{value}</span>
    </div>
  )
}

function PasswordBlock() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [err, setErr] = useState<null | string>(null)
  const [ok, setOk] = useState(false)

  const m = useMutation({
    mutationFn: () => userAuthApi.changePassword(current, next),
    onError: (e) => {
      const body = (e as { body?: { error?: string } } | undefined)?.body
      setErr(body?.error ?? (e instanceof Error ? e.message : 'Change failed'))
      setOk(false)
    },
    onSuccess: () => {
      setOk(true)
      setErr(null)
      setCurrent('')
      setNext('')
    },
  })

  return (
    <section className="mt-8">
      <header className="sec-head">
        <span className="sec-head-title">Password</span>
        <span className="sec-head-sub">rotate your sign-in credential</span>
      </header>
      <form
        className="border-border flex flex-col gap-3 border-y py-5"
        onSubmit={(e) => {
          e.preventDefault()
          m.mutate()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            current password
          </span>
          <input
            autoComplete="current-password"
            className="border-border bg-bg-secondary text-fg focus:border-accent h-8 max-w-sm border px-2 text-[13px] focus:outline-none"
            onChange={(e) => setCurrent(e.target.value)}
            required
            type="password"
            value={current}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
            new password
          </span>
          <input
            autoComplete="new-password"
            className="border-border bg-bg-secondary text-fg focus:border-accent h-8 max-w-sm border px-2 text-[13px] focus:outline-none"
            onChange={(e) => setNext(e.target.value)}
            required
            type="password"
            value={next}
          />
          <span className="text-fg-muted text-[11px]">
            8 characters minimum. Changing your password signs you out of all other devices.
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button
            className="bg-accent text-bg inline-flex h-7 items-center px-3 font-mono text-[11px] tracking-[0.05em] uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
            disabled={m.isPending || next.length < 8 || !current}
            type="submit"
          >
            {m.isPending ? 'changing…' : 'change password'}
          </button>
          {ok && <span className="text-success font-mono text-[11px]">password updated ✓</span>}
          {err && <span className="text-danger font-mono text-[11px]">{err}</span>}
          <Link
            className="text-fg-muted hover:text-accent ml-auto font-mono text-[10px] tracking-[0.18em] uppercase"
            to="/forgot-password"
          >
            forgot password →
          </Link>
        </div>
      </form>
    </section>
  )
}

// v1.3 W14 — per-user notification preferences block on /account.
// Lets operators mute activity kinds they don't want to be paged
// about (status / assignee / priority / labels / merged / comments /
// regressed), pick a cadence (immediate is the only enforced one in
// v1.3; hourly + daily are stored for the v1.4 digest worker), and
// pick channels (in_app is the only enforced one in v1.3; email
// arrives in v1.4).
const KIND_OPTIONS: { id: string; label: string; help: string }[] = [
  { id: 'status_changed', label: 'Status changes', help: 'Resolve / silence / mute / reopen.' },
  { id: 'assignee_changed', label: 'Assignee changes', help: 'When someone is (un)assigned.' },
  { id: 'priority_changed', label: 'Priority changes', help: 'p0..p3 set or moved.' },
  { id: 'labels_changed', label: 'Label changes', help: 'Labels added or removed.' },
  { id: 'merged', label: 'Merges', help: 'Issues merged into this one.' },
  { id: 'commented', label: 'Comments', help: 'New comments on watched issues.' },
  { id: 'regressed', label: 'Regressions', help: 'Resolved issue fired again.' },
]

function NotificationsBlock() {
  const qc = useQueryClient()
  const prefsQ = useQuery({
    queryFn: adminApi.getNotificationPreferences,
    queryKey: qk.account.notificationPreferences(),
  })

  const initial = prefsQ.data
  const [muted, setMuted] = useState<null | string[]>(null)
  const [cadence, setCadence] = useState<null | string>(null)
  const [channels, setChannels] = useState<null | string[]>(null)
  const [savedAt, setSavedAt] = useState<null | number>(null)

  // Once the server returns the current prefs, prime the form state.
  // We do this lazily so the operator's in-progress edits don't get
  // clobbered by a background refetch.
  const ready = initial !== undefined && muted !== null && cadence !== null && channels !== null
  if (initial !== undefined && muted === null) {
    setMuted(initial.mutedKinds)
    setCadence(initial.cadence)
    setChannels(initial.channels)
  }

  const saveM = useMutation({
    mutationFn: () =>
      adminApi.putNotificationPreferences({
        cadence: cadence ?? 'immediate',
        channels: channels ?? ['in_app'],
        mutedKinds: muted ?? [],
      }),
    onSuccess: (next) => {
      setMuted(next.mutedKinds)
      setCadence(next.cadence)
      setChannels(next.channels)
      setSavedAt(Date.now())
      window.setTimeout(() => setSavedAt(null), 2500)
      void qc.invalidateQueries({ queryKey: qk.account.notificationPreferences() })
    },
  })

  const toggleMuted = (id: string) => {
    setMuted((cur) => {
      const set = new Set(cur ?? [])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      return [...set].sort()
    })
  }

  const toggleChannel = (c: string) => {
    setChannels((cur) => {
      const set = new Set(cur ?? [])
      if (set.has(c)) set.delete(c)
      else set.add(c)
      return [...set]
    })
  }

  return (
    <section className="border-border mt-10 border-t pt-8" id="notifications">
      <header className="flex items-baseline gap-3">
        <h2
          className="text-fg"
          style={{
            fontSize: '18px',
            fontVariationSettings: "'wdth' 100, 'opsz' 24, 'wght' 600",
          }}
        >
          Notifications
        </h2>
        <span className="text-fg-muted font-mono text-[10px] tracking-[0.18em] uppercase">
          per-user
        </span>
      </header>

      {prefsQ.isLoading && <p className="text-fg-muted mt-3 text-[12px]">Loading…</p>}
      {prefsQ.error && (
        <p className="border-danger/40 bg-danger/5 text-danger mt-3 rounded border px-3 py-2 text-[12px]">
          {hintOfErr(prefsQ.error) ?? 'Failed to load preferences.'}
        </p>
      )}

      {ready && (
        <form
          className="mt-3 space-y-5"
          onSubmit={(e) => {
            e.preventDefault()
            saveM.mutate()
          }}
        >
          <fieldset>
            <legend className="text-fg-secondary text-[12px]">
              Mute these activity kinds (your notification bell + email when it ships).
            </legend>
            <ul className="mt-2 space-y-1.5">
              {KIND_OPTIONS.map((k) => {
                const checked = (muted ?? []).includes(k.id)
                return (
                  <li className="flex items-baseline gap-2" key={k.id}>
                    <input
                      checked={checked}
                      className="accent-accent"
                      id={`mute-${k.id}`}
                      onChange={() => toggleMuted(k.id)}
                      type="checkbox"
                    />
                    <label className="t-sm text-fg select-none" htmlFor={`mute-${k.id}`}>
                      {k.label}
                      <span className="text-fg-muted ml-2 text-[11px]">{k.help}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>

          <fieldset>
            <legend className="text-fg-secondary text-[12px]">
              Cadence (v1.4 W17: hourly + daily now batch unread notifications into one email per
              period).
            </legend>
            <div className="mt-2 flex items-baseline gap-4">
              {[
                { id: 'immediate', label: 'Immediate' },
                { id: 'hourly', label: 'Hourly digest' },
                { id: 'daily', label: 'Daily digest' },
              ].map((c) => (
                <label className="t-sm text-fg flex items-baseline gap-1.5" key={c.id}>
                  <input
                    checked={cadence === c.id}
                    className="accent-accent"
                    name="cadence"
                    onChange={() => setCadence(c.id)}
                    type="radio"
                    value={c.id}
                  />
                  {c.label}
                </label>
              ))}
              <RunDigestButton enabled={cadence === 'hourly' || cadence === 'daily'} />
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-fg-secondary text-[12px]">
              Channels (v1.4 W16: email channel now active when SMTP is configured).
            </legend>
            <div className="mt-2 flex items-baseline gap-4">
              {[
                { id: 'in_app', label: 'In-app' },
                { id: 'email', label: 'Email' },
              ].map((c) => {
                const checked = (channels ?? []).includes(c.id)
                return (
                  <label className="t-sm text-fg flex items-baseline gap-1.5" key={c.id}>
                    <input
                      checked={checked}
                      className="accent-accent"
                      onChange={() => toggleChannel(c.id)}
                      type="checkbox"
                    />
                    {c.label}
                  </label>
                )
              })}
              <TestEmailButton enabled={(channels ?? []).includes('email')} />
            </div>
          </fieldset>

          {saveM.error && (
            <p className="border-danger/40 bg-danger/5 text-danger rounded border px-3 py-2 text-[12px]">
              {hintOfErr(saveM.error) ?? 'Save failed. Check your selection and try again.'}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              className="bg-accent text-bg t-sm rounded px-3 py-1.5 font-medium disabled:opacity-50"
              disabled={saveM.isPending}
              type="submit"
            >
              {saveM.isPending ? 'Saving…' : 'Save'}
            </button>
            {savedAt !== null && (
              <span className="text-success font-mono text-[11px] tracking-wider uppercase">
                ✓ saved
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  )
}

// v1.4 W17 — fire the digest worker for current user. Only useful
// when cadence ∈ {hourly, daily}; the button is disabled otherwise.
function RunDigestButton({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<null | { ok: boolean; msg: string }>(null)
  const onClick = async () => {
    setBusy(true)
    setResult(null)
    try {
      const r = await adminApi.runDigestNow()
      setResult({
        ok: r.sent > 0,
        msg: r.sent > 0 ? 'digest sent' : 'no unread — try again after a notification',
      })
    } catch (e) {
      setResult({ ok: false, msg: hintOfErr(e) ?? 'digest run failed' })
    } finally {
      setBusy(false)
      window.setTimeout(() => setResult(null), 6000)
    }
  }
  return (
    <span className="flex items-baseline gap-2">
      <button
        className="border-border text-fg-muted hover:text-fg t-sm rounded border px-2 py-0.5 disabled:opacity-50"
        disabled={!enabled || busy}
        onClick={onClick}
        title={enabled ? 'Run a digest now for testing' : 'Pick hourly or daily cadence first'}
        type="button"
      >
        {busy ? 'Running…' : 'Run digest now'}
      </button>
      {result !== null && (
        <span
          className={`font-mono text-[10px] tracking-wider uppercase ${
            result.ok ? 'text-success' : 'text-danger'
          }`}
        >
          {result.ok ? '✓ ' : '— '}
          {result.msg}
        </span>
      )}
    </span>
  )
}

// v1.4 W16 — tiny diagnostic button. Tries to send a one-shot test
// email to the operator's own address. Useful so they can validate
// SMTP + their email lives in their inbox without waiting for a real
// notification.
function TestEmailButton({ enabled }: { enabled: boolean }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<null | { ok: boolean; msg: string }>(null)
  const onClick = async () => {
    setBusy(true)
    setResult(null)
    try {
      const r = await adminApi.sendTestNotificationEmail()
      setResult({
        ok: r.delivered,
        msg: r.delivered
          ? `sent to ${r.recipient}`
          : (r.error ?? 'send failed — check server logs'),
      })
    } catch (e) {
      setResult({ ok: false, msg: hintOfErr(e) ?? 'send failed' })
    } finally {
      setBusy(false)
      window.setTimeout(() => setResult(null), 6000)
    }
  }
  return (
    <span className="flex items-baseline gap-2">
      <button
        className="border-border text-fg-muted hover:text-fg t-sm rounded border px-2 py-0.5 disabled:opacity-50"
        disabled={!enabled || busy}
        onClick={onClick}
        title={enabled ? 'Send a test email to yourself' : 'Enable the Email channel first'}
        type="button"
      >
        {busy ? 'Sending…' : 'Send test'}
      </button>
      {result !== null && (
        <span
          className={`font-mono text-[10px] tracking-wider uppercase ${
            result.ok ? 'text-success' : 'text-danger'
          }`}
        >
          {result.ok ? '✓ ' : '✗ '}
          {result.msg}
        </span>
      )}
    </span>
  )
}

function hintOfErr(error: unknown): null | string {
  if (isStructuredError(error)) {
    return error.body.error.hint ?? error.body.error.message
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return null
}

function localPart(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

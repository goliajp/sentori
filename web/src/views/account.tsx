import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { userAuthApi } from '@/api/client'
import { useAuth } from '@/auth/state'
import { PageHeader } from '@/layout/page-header'

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

  const meQ = useQuery({ queryFn: userAuthApi.me, queryKey: ['me'] })

  const me = meQ.data?.user ?? user

  // After any profile mutation: invalidate react-query + push fresh
  // /me into the AuthProvider so the toolbar avatar + every
  // other `useAuth().user` consumer reflects the change.
  const onProfileSaved = () => {
    void qc.invalidateQueries({ queryKey: ['me'] })
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
      <div className="flex flex-col gap-2 border-y border-[color:var(--rule)] py-5">
        <p className="text-[13px] text-[color:var(--ink-soft)]">
          Sign out of every other device. Your current browser session stays valid; everywhere else
          has to sign in again.
        </p>
        <div className="flex items-center gap-3">
          <button
            className="inline-flex h-7 items-center border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--ink)] uppercase transition-colors hover:border-[color:var(--danger)] hover:text-[color:var(--danger)] disabled:opacity-50"
            disabled={busy}
            onClick={() => void onClick()}
            type="button"
          >
            {busy ? 'signing out…' : 'sign out other devices'}
          </button>
          {ok && (
            <span className="font-mono text-[11px] text-[color:var(--success)]">
              other sessions signed out ✓
            </span>
          )}
          {err && <span className="font-mono text-[11px] text-[color:var(--danger)]">{err}</span>}
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
        className="flex flex-col gap-4 border-y border-[color:var(--rule)] py-5 md:flex-row md:items-start"
        onSubmit={(e) => {
          e.preventDefault()
          m.mutate()
        }}
      >
        <img
          alt="Your avatar"
          className="size-24 shrink-0 rounded-full border border-[color:var(--rule)] object-cover"
          src={effectiveAvatar}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
              display name
            </span>
            <input
              className="h-8 border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 text-[13px] text-[color:var(--ink)] focus:border-[color:var(--accent)] focus:outline-none"
              onChange={(e) => setName(e.target.value)}
              placeholder={localPart(email)}
              value={name}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
              avatar URL (optional)
            </span>
            <input
              className="h-8 border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[12px] text-[color:var(--ink)] focus:border-[color:var(--accent)] focus:outline-none"
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/avatar.png"
              value={url}
            />
            <span className="text-[11px] text-[color:var(--ink-muted)]">
              Leave blank to fall back to a Gravatar derived from your email.
            </span>
          </label>

          <div className="flex items-center gap-3">
            <button
              className="inline-flex h-7 items-center bg-[color:var(--accent)] px-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--paper)] uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
              disabled={m.isPending}
              type="submit"
            >
              {m.isPending ? 'saving…' : 'save profile'}
            </button>
            {ok && (
              <span className="font-mono text-[11px] text-[color:var(--success)]">saved ✓</span>
            )}
            {err && <span className="font-mono text-[11px] text-[color:var(--danger)]">{err}</span>}
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
      <div className="border-y border-[color:var(--rule)] py-2">
        <RoRow label="email" value={email} />
        <RoRow label="user id" value={id} />
      </div>
    </section>
  )
}

function RoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[120px_1fr] items-baseline gap-3 py-2">
      <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </span>
      <span className="font-mono text-[12px] break-all text-[color:var(--ink)]">{value}</span>
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
        className="flex flex-col gap-3 border-y border-[color:var(--rule)] py-5"
        onSubmit={(e) => {
          e.preventDefault()
          m.mutate()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
            current password
          </span>
          <input
            autoComplete="current-password"
            className="h-8 max-w-sm border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 text-[13px] text-[color:var(--ink)] focus:border-[color:var(--accent)] focus:outline-none"
            onChange={(e) => setCurrent(e.target.value)}
            required
            type="password"
            value={current}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
            new password
          </span>
          <input
            autoComplete="new-password"
            className="h-8 max-w-sm border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 text-[13px] text-[color:var(--ink)] focus:border-[color:var(--accent)] focus:outline-none"
            onChange={(e) => setNext(e.target.value)}
            required
            type="password"
            value={next}
          />
          <span className="text-[11px] text-[color:var(--ink-muted)]">
            8 characters minimum. Changing your password signs you out of all other devices.
          </span>
        </label>
        <div className="flex items-center gap-3">
          <button
            className="inline-flex h-7 items-center bg-[color:var(--accent)] px-3 font-mono text-[11px] tracking-[0.05em] text-[color:var(--paper)] uppercase transition-opacity hover:opacity-90 disabled:opacity-50"
            disabled={m.isPending || next.length < 8 || !current}
            type="submit"
          >
            {m.isPending ? 'changing…' : 'change password'}
          </button>
          {ok && (
            <span className="font-mono text-[11px] text-[color:var(--success)]">
              password updated ✓
            </span>
          )}
          {err && <span className="font-mono text-[11px] text-[color:var(--danger)]">{err}</span>}
          <Link
            className="ml-auto font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--accent)]"
            to="/forgot-password"
          >
            forgot password →
          </Link>
        </div>
      </form>
    </section>
  )
}

function localPart(email: string): string {
  const at = email.indexOf('@')
  return at > 0 ? email.slice(0, at) : email
}

/** Gravatar URL for a given email — md5 hash of the lower-case
 *  trimmed email, 200px, identicon fallback. */
export function gravatarFor(email: string): string {
  const hash = md5(email.trim().toLowerCase())
  return `https://www.gravatar.com/avatar/${hash}?s=200&d=identicon`
}

// Minimal MD5 (used only for gravatar URL — not for crypto).
function md5(input: string): string {
  // Tiny in-tree MD5 to avoid an extra dep. Sourced from the public-
  // domain reference in RFC 1321; reformatted for TypeScript.
  const safeAdd = (x: number, y: number): number => {
    const lsw = (x & 0xffff) + (y & 0xffff)
    const msw = (x >> 16) + (y >> 16) + (lsw >> 16)
    return (msw << 16) | (lsw & 0xffff)
  }
  const rotateLeft = (n: number, s: number): number => (n << s) | (n >>> (32 - s))
  const cmn = (q: number, a: number, b: number, x: number, s: number, t: number): number =>
    safeAdd(rotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b)
  const ff = (
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number
  ): number => cmn((b & c) | (~b & d), a, b, x, s, t)
  const gg = (
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number
  ): number => cmn((b & d) | (c & ~d), a, b, x, s, t)
  const hh = (
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number
  ): number => cmn(b ^ c ^ d, a, b, x, s, t)
  const ii = (
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    t: number
  ): number => cmn(c ^ (b | ~d), a, b, x, s, t)
  const bytes = new TextEncoder().encode(input)
  const len = bytes.length * 8
  const padded = new Uint8Array(((bytes.length + 8) >> 6) * 64 + 64)
  padded.set(bytes)
  padded[bytes.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, len, true)
  const words = new Int32Array(padded.length / 4)
  for (let i = 0; i < words.length; i++) words[i] = view.getInt32(i * 4, true)
  let a = 0x67452301
  let b = -0x10325477
  let c = -0x67452302
  let d = 0x10325476
  for (let i = 0; i < words.length; i += 16) {
    const olda = a
    const oldb = b
    const oldc = c
    const oldd = d
    a = ff(a, b, c, d, words[i]!, 7, -0x28955b88)
    d = ff(d, a, b, c, words[i + 1]!, 12, -0x173848aa)
    c = ff(c, d, a, b, words[i + 2]!, 17, 0x242070db)
    b = ff(b, c, d, a, words[i + 3]!, 22, -0x3e423112)
    a = ff(a, b, c, d, words[i + 4]!, 7, -0xa83f051)
    d = ff(d, a, b, c, words[i + 5]!, 12, 0x4787c62a)
    c = ff(c, d, a, b, words[i + 6]!, 17, -0x57cfb9ed)
    b = ff(b, c, d, a, words[i + 7]!, 22, -0x2b96aff)
    a = ff(a, b, c, d, words[i + 8]!, 7, 0x698098d8)
    d = ff(d, a, b, c, words[i + 9]!, 12, -0x74bb0851)
    c = ff(c, d, a, b, words[i + 10]!, 17, -0xa44f)
    b = ff(b, c, d, a, words[i + 11]!, 22, -0x76a32842)
    a = ff(a, b, c, d, words[i + 12]!, 7, 0x6b901122)
    d = ff(d, a, b, c, words[i + 13]!, 12, -0x2678e6d)
    c = ff(c, d, a, b, words[i + 14]!, 17, -0x5986bc72)
    b = ff(b, c, d, a, words[i + 15]!, 22, 0x49b40821)
    a = gg(a, b, c, d, words[i + 1]!, 5, -0x9e1da9e)
    d = gg(d, a, b, c, words[i + 6]!, 9, -0x3fbf4cc0)
    c = gg(c, d, a, b, words[i + 11]!, 14, 0x265e5a51)
    b = gg(b, c, d, a, words[i]!, 20, -0x16493856)
    a = gg(a, b, c, d, words[i + 5]!, 5, -0x29d0efa3)
    d = gg(d, a, b, c, words[i + 10]!, 9, 0x2441453)
    c = gg(c, d, a, b, words[i + 15]!, 14, -0x275e197f)
    b = gg(b, c, d, a, words[i + 4]!, 20, -0x182c0438)
    a = gg(a, b, c, d, words[i + 9]!, 5, 0x21e1cde6)
    d = gg(d, a, b, c, words[i + 14]!, 9, -0x3cc8f82a)
    c = gg(c, d, a, b, words[i + 3]!, 14, -0xb2af279)
    b = gg(b, c, d, a, words[i + 8]!, 20, 0x455a14ed)
    a = gg(a, b, c, d, words[i + 13]!, 5, -0x561c16fb)
    d = gg(d, a, b, c, words[i + 2]!, 9, -0x3105c08)
    c = gg(c, d, a, b, words[i + 7]!, 14, 0x676f02d9)
    b = gg(b, c, d, a, words[i + 12]!, 20, -0x72d5b376)
    a = hh(a, b, c, d, words[i + 5]!, 4, -0x5c6be)
    d = hh(d, a, b, c, words[i + 8]!, 11, -0x788e097f)
    c = hh(c, d, a, b, words[i + 11]!, 16, 0x6d9d6122)
    b = hh(b, c, d, a, words[i + 14]!, 23, -0x21ac7f4)
    a = hh(a, b, c, d, words[i + 1]!, 4, -0x5b4115bc)
    d = hh(d, a, b, c, words[i + 4]!, 11, 0x4bdecfa9)
    c = hh(c, d, a, b, words[i + 7]!, 16, -0x944b4a0)
    b = hh(b, c, d, a, words[i + 10]!, 23, -0x41404390)
    a = hh(a, b, c, d, words[i + 13]!, 4, 0x289b7ec6)
    d = hh(d, a, b, c, words[i]!, 11, -0x155ed806)
    c = hh(c, d, a, b, words[i + 3]!, 16, -0x2b10cf7b)
    b = hh(b, c, d, a, words[i + 6]!, 23, 0x4881d05)
    a = hh(a, b, c, d, words[i + 9]!, 4, -0x262b2fc7)
    d = hh(d, a, b, c, words[i + 12]!, 11, -0x1924661b)
    c = hh(c, d, a, b, words[i + 15]!, 16, 0x1fa27cf8)
    b = hh(b, c, d, a, words[i + 2]!, 23, -0x3b53a99b)
    a = ii(a, b, c, d, words[i]!, 6, -0xbd6ddbc)
    d = ii(d, a, b, c, words[i + 7]!, 10, 0x432aff97)
    c = ii(c, d, a, b, words[i + 14]!, 15, -0x546bdc59)
    b = ii(b, c, d, a, words[i + 5]!, 21, -0x36c5fc7)
    a = ii(a, b, c, d, words[i + 12]!, 6, 0x655b59c3)
    d = ii(d, a, b, c, words[i + 3]!, 10, -0x70f3336e)
    c = ii(c, d, a, b, words[i + 10]!, 15, -0x100b83)
    b = ii(b, c, d, a, words[i + 1]!, 21, -0x7a7ba22f)
    a = ii(a, b, c, d, words[i + 8]!, 6, 0x6fa87e4f)
    d = ii(d, a, b, c, words[i + 15]!, 10, -0x1d31920)
    c = ii(c, d, a, b, words[i + 6]!, 15, -0x5cfebcec)
    b = ii(b, c, d, a, words[i + 13]!, 21, 0x4e0811a1)
    a = ii(a, b, c, d, words[i + 4]!, 6, -0x8ac817e)
    d = ii(d, a, b, c, words[i + 11]!, 10, -0x42c50dcb)
    c = ii(c, d, a, b, words[i + 2]!, 15, 0x2ad7d2bb)
    b = ii(b, c, d, a, words[i + 9]!, 21, -0x14792c6f)
    a = safeAdd(a, olda)
    b = safeAdd(b, oldb)
    c = safeAdd(c, oldc)
    d = safeAdd(d, oldd)
  }
  const toHex = (n: number) =>
    Array.from({ length: 4 }, (_, j) => ((n >> (j * 8)) & 0xff).toString(16).padStart(2, '0')).join(
      ''
    )
  return toHex(a) + toHex(b) + toHex(c) + toHex(d)
}

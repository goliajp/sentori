import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'

import { orgsApi } from '@/api/client'
import { useAuth } from '@/auth/state'

/**
 * Phase 14 sub-D: landing for invite emails.
 *
 * - not signed in       → /login?next=/invite/{token}
 *                          (sign-in flow returns here and auto-accepts)
 * - signed in           → POST /api/invites/{token}/accept once on mount;
 *                          navigate to the new org's issues on success
 * - common error codes  → friendly messages instead of bubbling JSON
 */
export function InviteAcceptView() {
  const { token } = useParams<{ token: string }>()
  const { isAuthed } = useAuth()
  const navigate = useNavigate()
  const calledRef = useRef(false)

  const accept = useMutation({
    mutationFn: () => orgsApi.acceptInvite(token!),
    onSuccess: ({ orgSlug }) => navigate(`/org/${orgSlug}/issues`),
  })

  // Fire the accept request exactly once on mount, but only after auth
  // is resolved as authenticated. Ref guards against StrictMode's
  // double-invoke in dev.
  useEffect(() => {
    if (!isAuthed || !token || calledRef.current) return
    calledRef.current = true
    accept.mutate()
  }, [isAuthed, token, accept])

  if (!token) return <Navigate replace to="/" />
  if (isAuthed === null) return <CenteredCard>Checking session…</CenteredCard>
  if (isAuthed === false) {
    const next = encodeURIComponent(`/invite/${token}`)
    return <Navigate replace to={`/login?next=${next}`} />
  }

  if (accept.isPending || accept.isIdle) {
    return <CenteredCard>Joining the organization…</CenteredCard>
  }
  if (accept.isError) {
    const code = (accept.error as { body?: { error?: string } } | null)?.body?.error
    return (
      <CenteredCard>
        <h1 className="text-fg text-lg font-semibold">Couldn't accept invite</h1>
        <p className="text-fg-muted text-sm leading-relaxed">{messageForError(code)}</p>
        <Link className="text-accent text-sm hover:underline" to="/">
          Back to dashboard
        </Link>
      </CenteredCard>
    )
  }
  return <CenteredCard>Joining…</CenteredCard>
}

function messageForError(code: string | undefined): string {
  switch (code) {
    case 'inviteEmailMismatch':
      return 'This invite was sent to a different email. Sign in with the email that received the invite, or ask the inviter to re-send.'
    case 'inviteExpired':
      return 'This invite has expired. Ask an admin of the org to send a fresh one.'
    case 'inviteNotFound':
      return 'This invite link is invalid. The token may have been revoked.'
    case 'inviteUsed':
      return 'This invite has already been used.'
    default:
      return 'Something went wrong while joining the org.'
  }
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-bg flex h-full items-center justify-center">
      <div className="border-border bg-bg w-96 space-y-3 rounded-lg border p-6">{children}</div>
    </div>
  )
}

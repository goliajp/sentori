import { useMutation } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'

import { orgsApi } from '@/api/client'

import { AuthError, AuthShell } from './login'

export function InviteAcceptView() {
  const { token } = useParams<{ token: string }>()
  const nav = useNavigate()
  const m = useMutation({
    mutationFn: (t: string) => orgsApi.acceptInvite(t),
    onSuccess: (r) => nav(`/main/org/${r.orgSlug}/overview`),
  })

  useEffect(() => {
    if (token) m.mutate(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <AuthShell title="Accept invite">
      {m.isPending && <p className="text-fg-secondary text-[13px]">Accepting your invite…</p>}
      {m.error && (
        <AuthError>
          {m.error instanceof Error ? m.error.message : 'Failed to accept invite.'}
        </AuthError>
      )}
    </AuthShell>
  )
}

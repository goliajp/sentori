import { useMutation } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useNavigate, useParams } from 'react-router'

import { orgsApi } from '@/api/client'
import { AuthShell } from './login'

export function InviteAcceptView() {
  const { token } = useParams<{ token: string }>()
  const nav = useNavigate()
  const m = useMutation({
    mutationFn: (t: string) => orgsApi.acceptInvite(t),
    onSuccess: (r) => nav(`/org/${r.orgSlug}/overview`),
  })

  useEffect(() => {
    if (token) m.mutate(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  return (
    <AuthShell title="Accept invite">
      {m.isPending && <p className="text-fg-muted t-md">Accepting…</p>}
      {m.error && (
        <p className="text-danger t-md">
          {m.error instanceof Error ? m.error.message : 'Failed to accept invite.'}
        </p>
      )}
    </AuthShell>
  )
}

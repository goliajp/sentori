import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'

import { transfersApi } from '@/api/client'
import { useAuth } from '@/auth/state'

export function TransferAcceptView() {
  const { token } = useParams<{ token: string }>()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [errorMsg, setErrorMsg] = useState<null | string>(null)

  const accept = useMutation({
    mutationFn: () => transfersApi.accept(token!),
    onError: (err: { body?: { error?: string }; status?: number }) => {
      // Map server error codes to human-readable copy.
      const code = err.body?.error
      const human =
        code === 'transferUsed'
          ? 'This transfer has already been accepted.'
          : code === 'transferExpired'
            ? 'This transfer link has expired.'
            : code === 'forbidden'
              ? 'This transfer was sent to a different account.'
              : code === 'transferNotFound'
                ? 'Transfer not found — the link may be invalid.'
                : `Accept failed (${code ?? err.status ?? 'error'}).`
      setErrorMsg(human)
    },
    onSuccess: () => {
      navigate('/')
    },
  })

  if (!token) return <Navigate replace to="/" />

  if (!user) {
    // Caller hit /transfers/<token> while logged out — push them to login
    // with a return-to so they come right back here.
    return <Navigate replace to={`/login?next=${encodeURIComponent(`/transfers/${token}`)}`} />
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-fg text-xl font-semibold">Accept ownership transfer</h1>
      <p className="text-fg-muted mt-2 text-sm">
        You're about to become the owner of this Sentori organization. The current owner will be
        demoted to admin. This action is reversible only by another transfer initiated by the new
        owner (you).
      </p>
      <p className="text-fg-muted t-md mt-3">
        Signed in as <span className="font-mono">{user.email}</span>.
      </p>

      <div className="mt-6 flex items-center gap-3">
        <button
          className="bg-accent text-bg rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50"
          disabled={accept.isPending}
          onClick={() => {
            setErrorMsg(null)
            accept.mutate()
          }}
          type="button"
        >
          {accept.isPending ? 'Accepting…' : 'Accept ownership'}
        </button>
        <Link className="text-fg-muted hover:text-fg text-sm" to="/">
          Cancel
        </Link>
      </div>

      {errorMsg && <p className="text-danger mt-4 text-sm">{errorMsg}</p>}
    </div>
  )
}

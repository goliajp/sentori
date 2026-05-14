import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import { userAuthApi } from '@/api/client'

type Status = 'error' | 'idle' | 'success'

export function VerifyView() {
  const [params] = useSearchParams()
  const token = params.get('token')
  const [status, setStatus] = useState<Status>(token ? 'idle' : 'error')
  const [message, setMessage] = useState<null | string>(
    token ? null : 'Missing verification token.'
  )

  useEffect(() => {
    if (!token) return
    userAuthApi
      .verify(token)
      .then(() => setStatus('success'))
      .catch((err: { body?: { error?: string } }) => {
        const code = err.body?.error
        setStatus('error')
        setMessage(
          code === 'tokenExpired'
            ? 'This link has expired. Register again to get a new one.'
            : code === 'invalidToken'
              ? 'This link is invalid or already used.'
              : 'Verification failed.'
        )
      })
  }, [token])

  return (
    <div className="bg-bg flex h-full items-center justify-center">
      <div className="border-border bg-bg w-96 space-y-3 rounded-lg border p-6">
        <h1 className="text-fg text-lg font-semibold">
          {status === 'idle' && 'Verifying…'}
          {status === 'success' && 'Email verified'}
          {status === 'error' && "Couldn't verify"}
        </h1>
        {status === 'idle' && (
          <p className="text-fg-muted text-sm">Hang tight, we're checking your link.</p>
        )}
        {status === 'success' && (
          <>
            <p className="text-fg-muted text-sm">Your account is now active.</p>
            <Link className="text-accent text-sm hover:underline" to="/login">
              Sign in
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <p className="text-sm text-[color:var(--color-danger)]">{message}</p>
            <Link className="text-accent text-sm hover:underline" to="/register">
              Register again
            </Link>
          </>
        )}
      </div>
    </div>
  )
}

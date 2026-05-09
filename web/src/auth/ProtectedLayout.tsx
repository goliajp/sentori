import { Navigate } from 'react-router'

import { AppLayout } from '@/app'

import { useAuth } from './state'

export function ProtectedLayout() {
  const { isAuthed } = useAuth()
  if (isAuthed === null) {
    return (
      <div className="text-fg-muted flex h-full items-center justify-center text-sm">Loading…</div>
    )
  }
  if (!isAuthed) {
    return <Navigate replace to="/login" />
  }
  return <AppLayout />
}

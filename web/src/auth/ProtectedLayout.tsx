import { Navigate, Outlet } from 'react-router'

import { useAuth } from './state'

/**
 * Auth guard only. Renders <Outlet /> so child routes pick their own layout
 * (OrgLayout for /org/:slug/*, the bare onboarding stub for /onboarding).
 */
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
  return <Outlet />
}

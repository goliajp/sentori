import { useSentoriRouter } from '@goliapkg/sentori-react/router'
import { Navigate, Outlet } from 'react-router'

import { useAuth } from './state'

/**
 * Auth guard only. Renders <Outlet /> so child routes pick their own layout
 * (OrgLayout for /org/:slug/*, the bare onboarding stub for /onboarding).
 *
 * Phase 35 sub-E: also mounts `useSentoriRouter()` once so every nav
 * transition becomes a `nav` breadcrumb. Plus, because SentoriProvider
 * at main.tsx now installs fetch instrumentation transitively through
 * sentori-javascript@0.3, every admin-API request from any page
 * becomes an http.client span on the sentori-dashboard project — first
 * end-to-end dogfood trace.
 */
export function ProtectedLayout() {
  useSentoriRouter()
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

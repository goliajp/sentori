import './index.css'

import { SentoriErrorBoundary, SentoriProvider } from '@goliapkg/sentori-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'

import { ErrorState } from './components/states'

// Phase 17 sub-F: dogfood. Reports dashboard's own JS errors back to
// the same Sentori instance under the `sentori-dashboard` project.
// Phase 31 sub-D: migrated from imperative initSentori() to
// <SentoriProvider> so the boundary below shares context. When
// VITE_SENTORI_TOKEN is unset (dev runs without a token), the
// provider is fed a placeholder config — init fails fast inside the
// provider's try/catch, the boundary still functions, and no events
// are actually sent because the ingest URL is unreachable.
const sentoriToken = import.meta.env.VITE_SENTORI_TOKEN
const sentoriConfig = {
  environment: import.meta.env.MODE === 'production' ? 'prod' : 'dev',
  ingestUrl: sentoriToken
    ? (import.meta.env.VITE_SENTORI_INGEST ?? 'https://ingest.sentori.golia.jp')
    : 'http://127.0.0.1:0',
  release: `dashboard@${import.meta.env.VITE_GIT_SHA ?? '0.0.0'}`,
  token: sentoriToken ?? 'st_pk_unconfigured00000000000',
}

import { AuthProvider } from './auth/AuthProvider'
import { ProtectedLayout } from './auth/ProtectedLayout'
import { DensityProvider } from './lib/density'
import { applyTheme } from './components/theme'

/*
 * Phase 28 sub-D: route-level code splitting.
 *
 * Auth views and the OrgLayout shell stay eager — they're on the
 * first paint path and bundling them out costs more in extra
 * round-trips than it saves. Everything else lazy-loads on first
 * visit. `Suspense` wraps the route tree once at the top, so each
 * lazy boundary doesn't need its own fallback shell.
 *
 * react-router's RouteObject doesn't accept lazy components in the
 * `element` slot directly without `<Suspense>`, so we wrap each one
 * in a tiny `lazyEl()` helper to keep the routing table readable.
 */

import { ForgotPasswordView } from './views/forgot-password'
import { LoginView } from './views/login'
import { OrgLayout } from './views/org-layout'
import { ProtectedLayout as _ProtectedLayoutTypeOnly } from './auth/ProtectedLayout'
import { RegisterView } from './views/register'
import { RootRedirect } from './views/root-redirect'
import { VerifyView } from './views/verify'

void _ProtectedLayoutTypeOnly // tsc keeps the import alive

const InviteAcceptView = lazy(() =>
  import('./views/invite-accept').then((m) => ({ default: m.InviteAcceptView }))
)
const TransferAcceptView = lazy(() =>
  import('./views/transfer-accept').then((m) => ({ default: m.TransferAcceptView }))
)
const OnboardingView = lazy(() =>
  import('./views/onboarding').then((m) => ({ default: m.OnboardingView }))
)
const UserActivityView = lazy(() =>
  import('./views/user-activity').then((m) => ({ default: m.UserActivityView }))
)
const OverviewView = lazy(() =>
  import('./views/overview').then((m) => ({ default: m.OverviewView }))
)
const IssuesView = lazy(() => import('./views/issues').then((m) => ({ default: m.IssuesView })))
const IssueDetailView = lazy(() =>
  import('./views/issue-detail').then((m) => ({ default: m.IssueDetailView }))
)
const ReleasesView = lazy(() =>
  import('./views/releases').then((m) => ({ default: m.ReleasesView }))
)
const ReleaseDetailView = lazy(() =>
  import('./views/release-detail').then((m) => ({ default: m.ReleaseDetailView }))
)
const ReleaseCompareView = lazy(() =>
  import('./views/release-compare').then((m) => ({ default: m.ReleaseCompareView }))
)
const OrgSettingsView = lazy(() =>
  import('./views/org-settings').then((m) => ({ default: m.OrgSettingsView }))
)
const TeamListView = lazy(() =>
  import('./views/team-list').then((m) => ({ default: m.TeamListView }))
)
const TeamDetailView = lazy(() =>
  import('./views/team-detail').then((m) => ({ default: m.TeamDetailView }))
)
const AlertsView = lazy(() => import('./views/alerts').then((m) => ({ default: m.AlertsView })))
const AuditLogView = lazy(() =>
  import('./views/audit-log').then((m) => ({ default: m.AuditLogView }))
)
const RecipientSettingsView = lazy(() =>
  import('./views/recipient-settings').then((m) => ({ default: m.RecipientSettingsView }))
)
const TokenSettingsView = lazy(() =>
  import('./views/token-settings').then((m) => ({ default: m.TokenSettingsView }))
)
const ProjectTeamSettingsView = lazy(() =>
  import('./views/project-team-settings').then((m) => ({ default: m.ProjectTeamSettingsView }))
)

function RouteSuspense({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="text-fg-muted px-6 py-6 text-sm">Loading…</div>}>
      {children}
    </Suspense>
  )
}

function lazyEl(node: React.ReactNode) {
  return <RouteSuspense>{node}</RouteSuspense>
}

applyTheme()

const router = createBrowserRouter([
  { element: <LoginView />, path: '/login' },
  { element: <RegisterView />, path: '/register' },
  { element: <VerifyView />, path: '/verify' },
  { element: <ForgotPasswordView />, path: '/forgot-password' },
  {
    children: [
      { element: <RootRedirect />, index: true },
      { element: lazyEl(<OnboardingView />), path: 'onboarding' },
      { element: lazyEl(<UserActivityView />), path: 'me/activity' },
      { element: lazyEl(<InviteAcceptView />), path: 'invite/:token' },
      { element: lazyEl(<TransferAcceptView />), path: 'transfers/:token' },
      {
        children: [
          { element: <Navigate replace to="issues" />, index: true },
          { element: lazyEl(<OverviewView />), path: 'overview' },
          { element: lazyEl(<IssuesView />), path: 'issues' },
          { element: lazyEl(<IssueDetailView />), path: 'issues/:issueId' },
          { element: lazyEl(<ReleasesView />), path: 'releases' },
          { element: lazyEl(<ReleaseDetailView />), path: 'releases/:releaseName' },
          { element: lazyEl(<ReleaseCompareView />), path: 'releases/:target/compare/:base' },
          { element: lazyEl(<OrgSettingsView />), path: 'settings' },
          { element: lazyEl(<TeamListView />), path: 'teams' },
          { element: lazyEl(<TeamDetailView />), path: 'teams/:teamSlug' },
          { element: lazyEl(<AlertsView />), path: 'alerts' },
          { element: lazyEl(<AuditLogView />), path: 'audit' },
          {
            element: lazyEl(<RecipientSettingsView />),
            path: 'projects/:projectId/settings/recipients',
          },
          {
            element: lazyEl(<TokenSettingsView />),
            path: 'projects/:projectId/settings/tokens',
          },
          {
            element: lazyEl(<ProjectTeamSettingsView />),
            path: 'projects/:projectId/settings/teams',
          },
        ],
        element: <OrgLayout />,
        path: 'org/:slug',
      },
      { element: <Navigate replace to="/" />, path: '*' },
    ],
    element: <ProtectedLayout />,
    path: '/',
  },
])

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchInterval: 60_000,
      retry: 1,
      staleTime: 30_000,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SentoriProvider config={sentoriConfig}>
      <SentoriErrorBoundary
        fallback={
          <ErrorState
            detail="The dashboard hit an unexpected error. Refresh the page or contact support if it persists."
            label="Dashboard crashed"
          />
        }
      >
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <DensityProvider>
              <RouterProvider router={router} />
            </DensityProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SentoriErrorBoundary>
    </SentoriProvider>
  </StrictMode>
)

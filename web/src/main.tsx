import './index.css'

import { initSentori } from '@goliapkg/sentori-javascript'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'

// Phase 17 sub-F: dogfood. Reports dashboard's own JS errors back to
// the same Sentori instance under the `sentori-dashboard` project.
// Token is build-time injected (Vite reads VITE_*); skips silently in
// dev / when no token is set.
const sentoriToken = import.meta.env.VITE_SENTORI_TOKEN
if (sentoriToken) {
  initSentori({
    environment: import.meta.env.MODE === 'production' ? 'prod' : 'dev',
    ingestUrl: import.meta.env.VITE_SENTORI_INGEST ?? 'https://ingest.sentori.golia.jp',
    release: `dashboard@${import.meta.env.VITE_GIT_SHA ?? '0.0.0'}`,
    token: sentoriToken,
  })
}

import { AuthProvider } from './auth/AuthProvider'
import { ProtectedLayout } from './auth/ProtectedLayout'
import { applyTheme } from './components/theme'
import { ForgotPasswordView } from './views/forgot-password'
import { InviteAcceptView } from './views/invite-accept'
import { IssueDetailView } from './views/issue-detail'
import { IssuesView } from './views/issues'
import { LoginView } from './views/login'
import { AuditLogView } from './views/audit-log'
import { OnboardingView } from './views/onboarding'
import { OrgLayout } from './views/org-layout'
import { OrgSettingsView } from './views/org-settings'
import { ProjectTeamSettingsView } from './views/project-team-settings'
import { RecipientSettingsView } from './views/recipient-settings'
import { ReleaseDetailView } from './views/release-detail'
import { ReleasesView } from './views/releases'
import { RegisterView } from './views/register'
import { TeamDetailView } from './views/team-detail'
import { TeamListView } from './views/team-list'
import { TransferAcceptView } from './views/transfer-accept'
import { UserActivityView } from './views/user-activity'
import { TokenSettingsView } from './views/token-settings'
import { RootRedirect } from './views/root-redirect'
import { VerifyView } from './views/verify'

applyTheme()

const router = createBrowserRouter([
  { element: <LoginView />, path: '/login' },
  { element: <RegisterView />, path: '/register' },
  { element: <VerifyView />, path: '/verify' },
  { element: <ForgotPasswordView />, path: '/forgot-password' },
  {
    children: [
      { element: <RootRedirect />, index: true },
      { element: <OnboardingView />, path: 'onboarding' },
      { element: <UserActivityView />, path: 'me/activity' },
      { element: <InviteAcceptView />, path: 'invite/:token' },
      { element: <TransferAcceptView />, path: 'transfers/:token' },
      {
        children: [
          { element: <Navigate replace to="issues" />, index: true },
          { element: <IssuesView />, path: 'issues' },
          { element: <IssueDetailView />, path: 'issues/:issueId' },
          { element: <ReleasesView />, path: 'releases' },
          { element: <ReleaseDetailView />, path: 'releases/:releaseName' },
          { element: <OrgSettingsView />, path: 'settings' },
          { element: <TeamListView />, path: 'teams' },
          { element: <TeamDetailView />, path: 'teams/:teamSlug' },
          { element: <AuditLogView />, path: 'audit' },
          {
            element: <RecipientSettingsView />,
            path: 'projects/:projectId/settings/recipients',
          },
          {
            element: <TokenSettingsView />,
            path: 'projects/:projectId/settings/tokens',
          },
          {
            element: <ProjectTeamSettingsView />,
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
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
)

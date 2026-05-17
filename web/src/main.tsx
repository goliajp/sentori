import './index.css'

import { SentoriErrorBoundary, SentoriProvider } from '@goliapkg/sentori-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'

import { AuthProvider } from './auth/AuthProvider'
import { ProtectedLayout } from './auth/ProtectedLayout'
import { installThemeWiring } from './components/theme'
import { MODULES } from './modules/registry'
import { AccountView } from './views/account'
import { ForgotPasswordView } from './views/forgot-password'
import { InviteAcceptView } from './views/invite-accept'
import { LoginView } from './views/login'
import { OnboardingView } from './views/onboarding'
import { OrgLayout } from './views/org-layout'
import { ProjectIntegrationView } from './views/project-integration'
import { RegisterView } from './views/register'
import { ResetPasswordView } from './views/reset-password'
import { RootRedirect } from './views/root-redirect'
import {
  SuperadminLayout,
  SuperadminOrgsView,
  SuperadminProjectsView,
  SuperadminUsersView,
} from './views/superadmin'
import { TransferAcceptView } from './views/transfer-accept'
import { UserActivityView } from './views/user-activity'
import { VerifyView } from './views/verify'

/**
 * Phase 17 sub-F: dogfood. Reports dashboard's own JS errors back to
 * the same Sentori instance under the `sentori-dashboard` project.
 * When VITE_SENTORI_TOKEN is unset (dev runs without a token), the
 * provider gets a placeholder config — init fails fast inside its own
 * try/catch and no events ship because the ingest URL is unreachable.
 */
const sentoriToken = import.meta.env.VITE_SENTORI_TOKEN
const sentoriConfig = {
  environment: import.meta.env.MODE === 'production' ? 'prod' : 'dev',
  ingestUrl: sentoriToken
    ? (import.meta.env.VITE_SENTORI_INGEST ?? 'https://ingest.sentori.golia.jp')
    : 'http://127.0.0.1:0',
  release: `dashboard@${import.meta.env.VITE_GIT_SHA ?? '0.0.0'}`,
  token: sentoriToken ?? 'st_pk_unconfigured00000000000',
}

installThemeWiring()

/**
 * Modules with `children` get a NESTED route so the parent renders
 * <Outlet /> and child views appear inside the parent's layout. This
 * lets Issues / Traces show a master-detail (rail on left, detail on
 * right) instead of jumping between separate full-page screens.
 */
const moduleChildren = MODULES.map((m) => {
  const View = m.view
  if (!m.children || m.children.length === 0) {
    return { element: <View />, path: m.path }
  }
  return {
    children: m.children.map((c) => {
      const Child = c.view
      return { element: <Child />, path: c.path }
    }),
    element: <View />,
    path: m.path,
  }
})

const router = createBrowserRouter([
  { element: <LoginView />, path: '/login' },
  { element: <RegisterView />, path: '/register' },
  { element: <VerifyView />, path: '/verify' },
  { element: <ForgotPasswordView />, path: '/forgot-password' },
  { element: <ResetPasswordView />, path: '/reset-password/:token' },
  {
    children: [
      { element: <RootRedirect />, index: true },
      { element: <OnboardingView />, path: 'onboarding' },
      { element: <AccountView />, path: 'account' },
      { element: <UserActivityView />, path: 'me/activity' },
      {
        children: [
          { element: <Navigate replace to="users" />, index: true },
          { element: <SuperadminUsersView />, path: 'users' },
          { element: <SuperadminOrgsView />, path: 'orgs' },
          { element: <SuperadminProjectsView />, path: 'projects' },
        ],
        element: <SuperadminLayout />,
        path: 'superadmin',
      },
      { element: <InviteAcceptView />, path: 'invite/:token' },
      { element: <TransferAcceptView />, path: 'transfers/:token' },
      {
        children: [
          { element: <Navigate replace to="overview" />, index: true },
          // Project-scoped integration view — lives inside OrgLayout so
          // the sidebar / context block stays mounted while the user
          // works through token setup for a specific project.
          {
            element: <ProjectIntegrationView />,
            path: 'projects/:projectId/integration',
          },
          ...moduleChildren,
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
          <div className="bg-bg text-fg t-md flex h-full items-center justify-center">
            Dashboard crashed. Refresh the page or contact support.
          </div>
        }
      >
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </QueryClientProvider>
      </SentoriErrorBoundary>
    </SentoriProvider>
  </StrictMode>
)

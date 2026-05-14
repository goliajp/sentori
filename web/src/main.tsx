import './index.css'

import { SentoriErrorBoundary, SentoriProvider } from '@goliapkg/sentori-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'

import { AuthProvider } from './auth/AuthProvider'
import { ProtectedLayout } from './auth/ProtectedLayout'
import { applyTheme } from './components/theme'
import { MODULES } from './modules/registry'
import { ForgotPasswordView } from './views/forgot-password'
import { InviteAcceptView } from './views/invite-accept'
import { LoginView } from './views/login'
import { OnboardingView } from './views/onboarding'
import { OrgLayout } from './views/org-layout'
import { RegisterView } from './views/register'
import { RootRedirect } from './views/root-redirect'
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

applyTheme()

const moduleChildren = MODULES.flatMap((m) => {
  const View = m.view
  const own = { element: <View />, path: m.path }
  if (!m.children) return [own]
  return [
    own,
    ...m.children.map((c) => {
      const Child = c.view
      return { element: <Child />, path: `${m.path}/${c.path}` }
    }),
  ]
})

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
        children: [{ element: <Navigate replace to="overview" />, index: true }, ...moduleChildren],
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

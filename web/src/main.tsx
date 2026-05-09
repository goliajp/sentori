import './index.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router'

import { AuthProvider } from './auth/AuthProvider'
import { ProtectedLayout } from './auth/ProtectedLayout'
import { applyTheme } from './components/theme'
import { ForgotPasswordView } from './views/forgot-password'
import { IssueDetailView } from './views/issue-detail'
import { IssuesView } from './views/issues'
import { LoginView } from './views/login'
import { RegisterView } from './views/register'
import { VerifyView } from './views/verify'

applyTheme()

const router = createBrowserRouter([
  { element: <LoginView />, path: '/login' },
  { element: <RegisterView />, path: '/register' },
  { element: <VerifyView />, path: '/verify' },
  { element: <ForgotPasswordView />, path: '/forgot-password' },
  {
    children: [
      { element: <Navigate replace to="/issues" />, index: true },
      { element: <IssuesView />, path: 'issues' },
      { element: <IssueDetailView />, path: 'issues/:issueId' },
      { element: <Navigate replace to="/issues" />, path: '*' },
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

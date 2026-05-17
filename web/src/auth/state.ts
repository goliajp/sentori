import { createContext, useContext } from 'react'

import type { AuthUser } from '@/api/client'

export type AuthContextValue = {
  isAuthed: boolean | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  /** Re-fetch /me from the server. Call after profile mutations so
   *  display_name / avatar_url update everywhere the user is shown. */
  refresh: () => Promise<void>
  user: AuthUser | null
}

export const AuthCtx = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

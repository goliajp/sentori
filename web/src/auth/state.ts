import { createContext, useContext } from 'react'

import type { AuthUser } from '@/api/client'

export type AuthContextValue = {
  isAuthed: boolean | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  user: AuthUser | null
}

export const AuthCtx = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

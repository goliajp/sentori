import { createContext, useContext } from 'react'

export type AuthContextValue = {
  isAuthed: boolean | null
  login: (password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthCtx = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

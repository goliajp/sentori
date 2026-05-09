import { type ReactNode, useEffect, useState } from 'react'

import { adminApi } from '@/api/client'

import { AuthCtx } from './state'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null)

  useEffect(() => {
    adminApi
      .me()
      .then(() => setIsAuthed(true))
      .catch(() => setIsAuthed(false))
  }, [])

  const login = async (password: string) => {
    await adminApi.login(password)
    setIsAuthed(true)
  }

  const logout = async () => {
    try {
      await adminApi.logout()
    } catch {
      // ignore — clear locally regardless
    }
    setIsAuthed(false)
  }

  return <AuthCtx.Provider value={{ isAuthed, login, logout }}>{children}</AuthCtx.Provider>
}

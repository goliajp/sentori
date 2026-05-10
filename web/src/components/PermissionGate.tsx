import { type ReactNode } from 'react'

import type { TeamRole } from '@/api/client'
import { useHasPermission } from '@/auth/useHasPermission'
import type { PermissionAction } from '@/auth/permissions'

type Props = {
  action: PermissionAction
  children: ReactNode
  /** Rendered when the caller is denied. Defaults to nothing. */
  fallback?: ReactNode
  scope?: { teamRole?: TeamRole }
}

export function PermissionGate({ action, children, fallback = null, scope }: Props) {
  const allowed = useHasPermission(action, scope)
  return <>{allowed ? children : fallback}</>
}

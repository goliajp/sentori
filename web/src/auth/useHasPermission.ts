import { useOrg } from '@/auth/orgContext'
import { hasPermission, type PermissionAction } from '@/auth/permissions'

import type { TeamRole } from '@/api/client'

/**
 * Hook form of the permission matrix. Pulls the caller's org role from
 * OrgCtx; team role must be passed in by the team-aware view that owns
 * the data. Returns a plain boolean — components should `&&`-render or
 * wrap with `<PermissionGate>` for clarity.
 */
export function useHasPermission(
  action: PermissionAction,
  scope?: { teamRole?: TeamRole }
): boolean {
  const { currentOrg } = useOrg()
  return hasPermission(action, {
    orgRole: currentOrg.role,
    teamRole: scope?.teamRole,
  })
}

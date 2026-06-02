// Phase 18 sub-E: dashboard-side permission matrix.
//
// Mirrors what the server enforces (admin_auth::require_project_in_org +
// per-endpoint role checks) so the UI never offers a button that would
// 403 on submit. The server stays the source of truth — this is purely
// "should I render this control?" gating.
//
// Phase 19 will widen the role enum (viewer / billing_admin) and refine
// scope-aware checks (team lead can manage their own team's members);
// that's deliberately out of scope here.

import type { OrgRole, TeamRole } from '@/api/client'

export type PermissionAction =
  | 'alert.manage'
  | 'audit.read'
  | 'invite.manage'
  | 'member.manage'
  | 'org.delete'
  | 'org.manage'
  | 'project.create'
  | 'project.team.bind'
  | 'team.manage'
  | 'team.member.manage'
  | 'token.manage'
  | 'transfer.initiate'

type Scope = {
  orgRole?: OrgRole
  teamRole?: TeamRole
}

/**
 * Returns true if the given role(s) can perform `action`.
 *
 * - org owner can do everything in the org
 * - org admin: everything except `org.delete` / `transfer.initiate`
 * - org member: read-only org, can self-leave
 * - team lead: can manage their own team's members on top of their org role
 */
export function hasPermission(action: PermissionAction, scope: Scope): boolean {
  const { orgRole, teamRole } = scope

  switch (action) {
    case 'alert.manage':
    case 'audit.read':
    case 'invite.manage':
    case 'member.manage':
    case 'org.manage':
    case 'project.create':
    case 'project.team.bind':
    case 'team.manage':
    case 'token.manage':
      return orgRole === 'owner' || orgRole === 'admin'

    case 'org.delete':
    case 'transfer.initiate':
      return orgRole === 'owner'

    case 'team.member.manage':
      // org admins manage any team; team leads manage their own team only.
      return orgRole === 'owner' || orgRole === 'admin' || teamRole === 'lead'
  }
}

// Phase 19 sub-B: typed org role enum.
//
// Endpoints historically did inline `matches!(role.as_str(), "owner" |
// "admin")`. That works but every new role (viewer in this phase,
// billing_admin in Phase 27) means hunting through call sites and
// keeping the patterns in sync. This module centralises:
//
//   - the canonical string values (must match the DB CHECK constraint)
//   - parse / serialize helpers
//   - the "can write?" predicate that all admin gates collapse to
//
// Comparisons via `Ord` are intentionally avoided — viewer < member <
// admin < owner reads natural but member and viewer differ in
// permissions only by one bit (member can self-leave; viewer is fully
// read-only) and a future role might not slot cleanly into a linear
// order. Use the explicit predicates instead.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrgRole {
    Owner,
    Admin,
    Member,
    Viewer,
}

impl OrgRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Owner => "owner",
            Self::Admin => "admin",
            Self::Member => "member",
            Self::Viewer => "viewer",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "owner" => Some(Self::Owner),
            "admin" => Some(Self::Admin),
            "member" => Some(Self::Member),
            "viewer" => Some(Self::Viewer),
            _ => None,
        }
    }

    /// True for org owner / admin. The right gate for write actions
    /// that are reserved to org-management people: invite, create
    /// project, manage tokens, delete team, etc.
    pub fn can_manage_org(self) -> bool {
        matches!(self, Self::Owner | Self::Admin)
    }

    /// Everything a write-restricted role (member, viewer) cannot do
    /// at the org level. Member ⊃ Viewer in capabilities, but neither
    /// can mutate org-scoped resources without escalation.
    pub fn is_writer(self) -> bool {
        self.can_manage_org()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TeamRole {
    Lead,
    Member,
    Viewer,
}

impl TeamRole {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Lead => "lead",
            Self::Member => "member",
            Self::Viewer => "viewer",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "lead" => Some(Self::Lead),
            "member" => Some(Self::Member),
            "viewer" => Some(Self::Viewer),
            _ => None,
        }
    }
}

/// Roles allowed on `org_invites.role`. Owner is excluded — promoting
/// to owner goes through the ownership-transfer flow, never an invite.
pub const VALID_INVITE_ROLES: &[&str] = &["admin", "member", "viewer"];

/// Roles allowed on `memberships.role` patches. Same logic: owner is
/// reachable only via ownership transfer, never a direct PATCH.
pub const VALID_MEMBER_PATCH_ROLES: &[&str] = &["admin", "member", "viewer"];

/// Roles allowed on `team_memberships.role`.
pub const VALID_TEAM_ROLES: &[&str] = &["lead", "member", "viewer"];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_round_trips() {
        for v in [OrgRole::Owner, OrgRole::Admin, OrgRole::Member, OrgRole::Viewer] {
            assert_eq!(OrgRole::parse(v.as_str()), Some(v));
        }
        for v in [TeamRole::Lead, TeamRole::Member, TeamRole::Viewer] {
            assert_eq!(TeamRole::parse(v.as_str()), Some(v));
        }
    }

    #[test]
    fn only_owner_admin_can_manage() {
        assert!(OrgRole::Owner.can_manage_org());
        assert!(OrgRole::Admin.can_manage_org());
        assert!(!OrgRole::Member.can_manage_org());
        assert!(!OrgRole::Viewer.can_manage_org());
    }
}

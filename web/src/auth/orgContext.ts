import { createContext, useContext } from 'react'

import type { OrgRow, ProjectRow, TeamRow } from '@/api/client'

export type OrgContextValue = {
  currentOrg: OrgRow
  /**
   * The active project for the current org. v0.1 picks the first project;
   * a project switcher comes later.
   */
  currentProject: null | ProjectRow
  /**
   * Phase 18 sub-E: optional team filter. When set, IssuesView narrows
   * the project list to projects bound to this team. Persisted via the
   * `team` query param on the issues route.
   */
  currentTeamSlug: null | string
  orgs: OrgRow[]
  /** Projects belonging to currentOrg. */
  projects: ProjectRow[]
  /** All teams in the current org (used by OrgSwitcher and gating UI). */
  teams: TeamRow[]
}

export const OrgCtx = createContext<null | OrgContextValue>(null)

export function useOrg() {
  const ctx = useContext(OrgCtx)
  if (!ctx) throw new Error('useOrg must be used inside OrgCtx.Provider')
  return ctx
}

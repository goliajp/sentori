import { createContext, useContext } from 'react'

import type { OrgRow, ProjectRow } from '@/api/client'

export type OrgContextValue = {
  currentOrg: OrgRow
  /**
   * The active project for the current org. v0.1 picks the first project;
   * a project switcher comes later.
   */
  currentProject: null | ProjectRow
  orgs: OrgRow[]
  /** Projects belonging to currentOrg. */
  projects: ProjectRow[]
}

export const OrgCtx = createContext<null | OrgContextValue>(null)

export function useOrg() {
  const ctx = useContext(OrgCtx)
  if (!ctx) throw new Error('useOrg must be used inside OrgCtx.Provider')
  return ctx
}

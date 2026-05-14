import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import { adminApi, teamsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { useHasPermission } from '@/auth/useHasPermission'

export function ProjectTeamSettingsView() {
  const { projectId } = useParams<{ projectId: string }>()
  const { currentOrg, projects } = useOrg()
  const orgSlug = currentOrg.slug
  const canManage = useHasPermission('project.team.bind')
  const queryClient = useQueryClient()

  const project = projects.find((p) => p.id === projectId) ?? null

  const orgTeamsQuery = useQuery({
    queryFn: () => teamsApi.list(orgSlug),
    queryKey: ['teams', orgSlug],
  })
  const projectTeamsQuery = useQuery({
    enabled: !!projectId,
    queryFn: () => teamsApi.listProjectTeams(projectId!),
    queryKey: ['project-teams', projectId],
  })
  const allProjectsQuery = useQuery({
    queryFn: adminApi.listProjects,
    queryKey: ['projects'],
  })

  const bind = useMutation({
    mutationFn: (teamSlug: string) => teamsApi.bindProject(projectId!, teamSlug),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project-teams', projectId] }),
  })
  const unbind = useMutation({
    mutationFn: (teamSlug: string) => teamsApi.unbindProject(projectId!, teamSlug),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['project-teams', projectId] }),
  })

  const orgTeams = orgTeamsQuery.data ?? []
  const projectTeamSlugs = new Set((projectTeamsQuery.data ?? []).map((t) => t.slug))

  if (!project) {
    return (
      <div className="p-6">
        <p className="text-fg-muted text-sm">Project not found in this org.</p>
        <Link className="text-accent text-sm hover:underline" to={`/org/${orgSlug}/issues`}>
          Back to issues
        </Link>
      </div>
    )
  }

  // The "everyone in the org sees this project" copy is the headline value.
  // Hide it once any team binding exists.
  const isOpen = projectTeamSlugs.size === 0

  return (
    <div className="space-y-6 p-6">
      <header>
        <Link className="text-fg-muted hover:text-fg text-[12px]" to={`/org/${orgSlug}/issues`}>
          ← Back
        </Link>
        <h1 className="text-fg mt-2 text-xl font-semibold">{project.name} — Teams</h1>
        <p className="text-fg-muted mt-1 text-sm">
          {isOpen
            ? 'No team binding — every member of this org can see this project.'
            : 'Only members of the bound teams (plus org owner / admin) can see this project.'}
        </p>
      </header>

      {orgTeamsQuery.isLoading || projectTeamsQuery.isLoading || allProjectsQuery.isLoading ? (
        <p className="text-fg-muted text-sm">Loading…</p>
      ) : orgTeams.length === 0 ? (
        <p className="text-fg-muted text-sm">
          This org has no teams yet.{' '}
          <Link className="text-accent hover:underline" to={`/org/${orgSlug}/teams`}>
            Create one
          </Link>{' '}
          first.
        </p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-lg border">
          {orgTeams.map((t) => {
            const isBound = projectTeamSlugs.has(t.slug)
            return (
              <li className="flex items-center justify-between px-4 py-3" key={t.id}>
                <div>
                  <Link
                    className="text-accent font-mono text-[12px] hover:underline"
                    to={`/org/${orgSlug}/teams/${t.slug}`}
                  >
                    {t.slug}
                  </Link>
                  <span className="text-fg ml-2 text-[13px]">{t.name}</span>
                </div>
                {canManage ? (
                  <button
                    className={`rounded-md px-3 py-1 text-[12px] font-medium ${
                      isBound
                        ? 'border-border text-fg-muted hover:bg-bg-tertiary border'
                        : 'bg-accent text-bg'
                    }`}
                    disabled={bind.isPending || unbind.isPending}
                    onClick={() => (isBound ? unbind.mutate(t.slug) : bind.mutate(t.slug))}
                    type="button"
                  >
                    {isBound ? 'Unbind' : 'Bind'}
                  </button>
                ) : (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      isBound ? 'bg-emerald-500/15 text-emerald-300' : 'bg-fg/10 text-fg-muted'
                    }`}
                  >
                    {isBound ? 'Bound' : 'Not bound'}
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

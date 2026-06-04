import { Alert, Card, PageHeader } from '@goliapkg/gds'
import { Badge, Skeleton } from '@goliapkg/gds'
import { EmptyState } from '@goliapkg/gds'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { adminApi, type ProjectRow } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'

/**
 * Overview — entry surface for an org. Three blocks stacked:
 *
 *   1. PageHeader with the org breadcrumb and a count badge.
 *   2. Platform health Alert (rolled from `/admin/api/self-test`,
 *      polled every 30 s with L2 persist so cold reload paints last
 *      known status before the network responds).
 *   3. Project grid — one Card per project with deep-links into
 *      Issues / Traces / Vitals / Integrate. Empty + loading states
 *      driven by GDS EmptyState / Skeleton so they match the rest
 *      of the dashboard's empty + loading idiom.
 */
export function OverviewView() {
  const { currentOrg } = useOrg()
  const projectsQ = useQuery({ queryFn: adminApi.listProjects, queryKey: qk.projects() })
  const projects = (projectsQ.data ?? []).filter((p) => p.orgSlug === currentOrg.slug)

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[
          { label: 'sentori', href: '/main' },
          { label: currentOrg.name ?? currentOrg.slug },
        ]}
        subtitle={`Errors, traces and intent across ${projects.length.toLocaleString()} project${projects.length === 1 ? '' : 's'}.`}
        title="Overview"
      />

      <PlatformHealth />

      <section aria-labelledby="projects-heading" className="space-y-3">
        <header className="flex items-baseline justify-between">
          <h2 className="text-fg text-[14px] font-semibold" id="projects-heading">
            Projects
          </h2>
          <span className="text-fg-muted font-mono text-[11px] tracking-[0.08em] tabular-nums">
            {projectsQ.isLoading ? 'loading…' : `${projects.length} in ${currentOrg.slug}`}
          </span>
        </header>

        {projectsQ.isError && (
          <Alert title="Failed to load projects" variant="danger">
            Refresh the page to retry. If this persists, check the dashboard&apos;s connection to
            the server.
          </Alert>
        )}

        {projectsQ.isLoading && <ProjectGridSkeleton />}

        {!projectsQ.isLoading && !projectsQ.isError && projects.length === 0 && (
          <Card>
            <EmptyState
              description="Create one via the CLI or the server admin endpoint, then point your SDK at it with the ingest token."
              title="No projects in this org yet"
            />
          </Card>
        )}

        {!projectsQ.isLoading && projects.length > 0 && (
          <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <ProjectCard orgSlug={currentOrg.slug} project={p} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

/**
 * Per-project Card — composes GDS Card with custom CardHeader-style
 * heading + a four-link footer for deep navigation into the most
 * common drill targets (Issues / Traces / Vitals / Integrate).
 */
function ProjectCard({ orgSlug, project }: { orgSlug: string; project: ProjectRow }) {
  const repoHost = project.sourceRepoUrl
    ? (() => {
        try {
          return new URL(project.sourceRepoUrl).host
        } catch {
          return null
        }
      })()
    : null

  return (
    <Card className="hover:border-accent transition-colors">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Link
            className="text-fg hover:text-accent gds-heading"
            to={`/main/org/${orgSlug}/issues?project=${project.id}`}
          >
            {project.name}
          </Link>
          <span className="text-fg-muted font-mono text-[10px] tracking-[0.08em] tabular-nums">
            {new Date(project.createdAt).toLocaleDateString()}
          </span>
        </div>

        <div className="text-fg-muted font-mono text-[11px]">{project.id}</div>

        {project.sourceRepoUrl && (
          <a
            className="text-fg-secondary hover:text-accent inline-flex font-mono text-[11px]"
            href={project.sourceRepoUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            ↗ {repoHost ?? project.sourceRepoUrl}
          </a>
        )}

        <div className="border-border/40 text-fg-muted flex items-center justify-between gap-3 border-t pt-2 font-mono text-[10px] tracking-[0.1em] uppercase">
          <Link
            className="hover:text-accent"
            to={`/main/org/${orgSlug}/issues?project=${project.id}`}
          >
            issues →
          </Link>
          <Link
            className="hover:text-accent"
            to={`/main/org/${orgSlug}/traces?project=${project.id}`}
          >
            traces →
          </Link>
          <Link
            className="hover:text-accent"
            to={`/main/org/${orgSlug}/vitals?project=${project.id}`}
          >
            vitals →
          </Link>
          <Link
            className="text-accent hover:text-accent-hover"
            to={`/main/org/${orgSlug}/integrate?project=${project.id}`}
            title="Install SDK + ingest tokens"
          >
            integrate →
          </Link>
        </div>
      </div>
    </Card>
  )
}

function ProjectGridSkeleton() {
  return (
    <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i}>
          <Card>
            <div className="space-y-2">
              <Skeleton height={18} variant="rect" width="70%" />
              <Skeleton height={11} variant="rect" width="90%" />
              <Skeleton height={11} variant="rect" width="40%" />
              <Skeleton className="mt-2" height={11} variant="rect" width="100%" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  )
}

/**
 * Platform health — rolled `/admin/api/self-test` snapshot pinned
 * above the project grid so the first thing the operator sees is
 * whether the platform itself is up. Green status hides into a
 * single thin badge row; amber / red opens an Alert with detail.
 */
function PlatformHealth() {
  const { data } = useQuery({
    meta: { persist: true },
    queryFn: () => adminApi.selfTest(),
    queryKey: qk.selfTest(),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
  if (!data) return null
  const rt = (n: null | number | undefined): string =>
    n === null || n === undefined ? '—' : n < 0 ? 'down' : `${n}ms`

  const variant =
    data.overall === 'green' ? 'success' : data.overall === 'amber' ? 'warning' : 'danger'

  if (data.overall === 'green') {
    return (
      <div className="border-border flex items-center gap-3 border-y py-2 font-mono text-[11px]">
        <Badge variant={variant}>{data.overall}</Badge>
        <span className="text-fg-secondary">build {data.serverVersion}</span>
        <span className="text-fg-muted">·</span>
        <span className="text-fg-secondary">db {rt(data.dbRtMs)}</span>
        <span className="text-fg-muted">·</span>
        <span className="text-fg-secondary">valkey {rt(data.valkeyRtMs)}</span>
      </div>
    )
  }

  return (
    <Alert title={`Platform status: ${data.overall}`} variant={variant}>
      <span className="text-fg-secondary inline-flex items-center gap-3 font-mono text-[11px]">
        <span>build {data.serverVersion}</span>
        <span className="text-fg-muted">·</span>
        <span>db {rt(data.dbRtMs)}</span>
        <span className="text-fg-muted">·</span>
        <span>valkey {rt(data.valkeyRtMs)}</span>
      </span>
    </Alert>
  )
}

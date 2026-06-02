import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { adminApi, type ProjectRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'
import { qk } from '@/api/query-keys'

/**
 * Overview — platform-health strip, editorial hero, then the
 * **project grid**: one card per project in the current org with
 * a link straight to its issues view + the source-repo URL if
 * configured. The "watching N projects" copy in the hero is backed
 * by the visible list below it.
 */
export function OverviewView() {
  const { currentOrg } = useOrg()
  const projectsQ = useQuery({ queryFn: adminApi.listProjects, queryKey: qk.projects() })
  const projects = (projectsQ.data ?? []).filter((p) => p.orgSlug === currentOrg.slug)
  const projectCount = projects.length

  return (
    <div className="sentori-page-in">
      <PageHeader subtitle={`org · ${currentOrg.slug}`} title="Overview" />

      <PlatformHealthStrip />

      <Hero count={projectCount} orgName={currentOrg.name ?? currentOrg.slug} />

      {projectsQ.isError && (
        <p className="border-y border-[color:var(--rule)] py-6 text-center text-[13px] text-[color:var(--danger)]">
          Failed to load projects. Refresh to retry.
        </p>
      )}

      <ProjectGrid isLoading={projectsQ.isLoading} orgSlug={currentOrg.slug} projects={projects} />
    </div>
  )
}

function Hero({ count, orgName }: { count: number; orgName: string }) {
  return (
    <div className="py-6">
      <h2
        className="max-w-prose text-[color:var(--ink)]"
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'clamp(30px, 4.4vw, 46px)',
          fontVariationSettings: "'wdth' 100, 'opsz' 96, 'wght' 600",
          letterSpacing: '-0.022em',
          lineHeight: '1.08',
        }}
      >
        Errors, traces &amp;{' '}
        <span
          style={{
            color: 'var(--accent)',
            fontVariationSettings: "'wdth' 100, 'opsz' 96, 'wght' 600",
          }}
        >
          intent
        </span>{' '}
        — at the speed of triage.
      </h2>
      <p className="mt-4 max-w-[56ch] text-[14px] leading-relaxed text-[color:var(--ink-soft)]">
        Watching {count.toLocaleString()} project{count === 1 ? '' : 's'} for{' '}
        <span className="font-mono text-[color:var(--ink)]">{orgName}</span>. Pick one below to dive
        into its issues, traces, and live debug.
      </p>
    </div>
  )
}

function ProjectGrid({
  isLoading,
  orgSlug,
  projects,
}: {
  isLoading: boolean
  orgSlug: string
  projects: ProjectRow[]
}) {
  return (
    <section className="mt-10">
      <header className="sec-head">
        <span className="sec-head-title">Your projects</span>
        <span className="sec-head-sub">
          {isLoading ? 'loading…' : `${projects.length} in ${orgSlug}`}
        </span>
      </header>

      {!isLoading && projects.length === 0 && (
        <p className="border-y border-[color:var(--rule)] py-8 text-center text-[13px] text-[color:var(--ink-soft)]">
          No projects in this org yet — create one via the CLI or the server admin endpoint, then
          point your SDK at it with the ingest token.
        </p>
      )}

      {projects.length > 0 && (
        <ul className="grid gap-3 pt-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} orgSlug={orgSlug} project={p} />
          ))}
        </ul>
      )}
    </section>
  )
}

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
    <li
      className="group relative flex flex-col gap-2 border border-[color:var(--rule)] bg-[color:var(--paper-2)] p-4 transition-colors hover:border-[color:var(--accent)]"
      key={project.id}
    >
      <div className="flex items-baseline justify-between gap-3">
        <Link
          className="text-[15px] font-medium text-[color:var(--ink)] hover:text-[color:var(--accent)]"
          to={`/main/org/${orgSlug}/issues?project=${project.id}`}
        >
          {project.name}
        </Link>
        <span className="font-mono text-[10px] tracking-[0.08em] text-[color:var(--ink-muted)] tabular-nums">
          {new Date(project.createdAt).toLocaleDateString()}
        </span>
      </div>

      <div className="font-mono text-[11px] text-[color:var(--ink-muted)]">{project.id}</div>

      {project.sourceRepoUrl && (
        <a
          className="font-mono text-[11px] text-[color:var(--ink-soft)] hover:text-[color:var(--accent)]"
          href={project.sourceRepoUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          ↗ {repoHost ?? project.sourceRepoUrl}
        </a>
      )}

      <div className="mt-1 flex items-center justify-between gap-3 border-t border-[color:var(--rule-soft)] pt-2 font-mono text-[10px] tracking-[0.1em] text-[color:var(--ink-muted)] uppercase">
        <Link
          className="hover:text-[color:var(--accent)]"
          to={`/main/org/${orgSlug}/issues?project=${project.id}`}
        >
          issues →
        </Link>
        <Link
          className="hover:text-[color:var(--accent)]"
          to={`/main/org/${orgSlug}/traces?project=${project.id}`}
        >
          traces →
        </Link>
        <Link
          className="hover:text-[color:var(--accent)]"
          to={`/main/org/${orgSlug}/vitals?project=${project.id}`}
        >
          vitals →
        </Link>
        <Link
          className="text-[color:var(--accent)] hover:text-[color:var(--accent-strong)]"
          to={`/main/org/${orgSlug}/integrate?project=${project.id}`}
          title="Install SDK + ingest tokens"
        >
          integrate →
        </Link>
      </div>
    </li>
  )
}

/** F4 — `/admin/api/self-test` snapshot. Operator-facing strip
 *  pinned above the hero so platform-health is the first signal
 *  the dashboard surfaces. Polled every 30 s; opt into L2 persist
 *  so cold reload paints the last known status before the network
 *  responds. */
function PlatformHealthStrip() {
  const { data } = useQuery({
    meta: { persist: true },
    queryFn: () => adminApi.selfTest(),
    queryKey: qk.selfTest(),
    refetchInterval: 30_000,
    staleTime: 25_000,
  })
  if (!data) return null
  const color =
    data.overall === 'green'
      ? 'var(--success)'
      : data.overall === 'amber'
        ? 'var(--warning)'
        : 'var(--danger)'
  const rt = (n: null | number | undefined): string =>
    n === null || n === undefined ? '—' : n < 0 ? 'down' : `${n}ms`
  return (
    <div className="mb-6 flex items-center gap-4 border-y border-[color:var(--rule)] py-2 font-mono text-[11px]">
      <span aria-hidden style={{ color }}>
        ●
      </span>
      <span className="tracking-[0.18em] uppercase" style={{ color }}>
        {data.overall}
      </span>
      <span className="text-[color:var(--ink-muted)]">·</span>
      <span className="text-[color:var(--ink-soft)]">build {data.serverVersion}</span>
      <span className="text-[color:var(--ink-muted)]">·</span>
      <span className="text-[color:var(--ink-soft)]">db {rt(data.dbRtMs)}</span>
      <span className="text-[color:var(--ink-muted)]">·</span>
      <span className="text-[color:var(--ink-soft)]">valkey {rt(data.valkeyRtMs)}</span>
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { adminApi, type ProjectRow } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'

/**
 * Overview — editorial hero, KPI strip, then the **project grid**:
 * one card per project in the current org with a link straight to its
 * issues view + the source-repo URL if configured. The "watching N
 * projects" copy in the hero is now backed by a visible list, not a
 * dangling number.
 */
export function OverviewView() {
  const { currentOrg } = useOrg()
  const projectsQ = useQuery({ queryFn: adminApi.listProjects, queryKey: ['projects'] })
  const projects = (projectsQ.data ?? []).filter((p) => p.orgSlug === currentOrg.slug)
  const projectCount = projects.length

  return (
    <div className="sentori-page-in">
      <PageHeader subtitle={`org · ${currentOrg.slug}`} title="Overview" />

      <Hero count={projectCount} orgName={currentOrg.name ?? currentOrg.slug} />

      <div className="rule-grid mt-8 grid-cols-2 md:grid-cols-4">
        <Kpi
          label="active projects"
          sub={projectsQ.isLoading ? 'loading…' : `${projectCount} configured`}
          value={projectCount.toString()}
        />
        <Kpi label="events / min" sub="wire /admin/api/overview" value="—" />
        <Kpi label="crash-free" sub="release-weighted" value="—" valueSuffix="%" />
        <Kpi highlight label="ingest" sub="all regions responding" value="OK" />
      </div>

      <ProjectGrid isLoading={projectsQ.isLoading} orgSlug={currentOrg.slug} projects={projects} />

      <SubSection sub="stub · live throughput chart lands next" title="Health">
        <p className="max-w-prose pt-3 text-[13px] text-[color:var(--ink-soft)]">
          Live throughput + per-project health summaries land here in the next iteration. The
          mini-charts will sit in the same column grid as the KPI strip above.
        </p>
      </SubSection>
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
          to={`/org/${orgSlug}/issues?project=${project.id}`}
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
          to={`/org/${orgSlug}/issues?project=${project.id}`}
        >
          issues →
        </Link>
        <Link
          className="hover:text-[color:var(--accent)]"
          to={`/org/${orgSlug}/traces?project=${project.id}`}
        >
          traces →
        </Link>
        <Link
          className="hover:text-[color:var(--accent)]"
          to={`/org/${orgSlug}/vitals?project=${project.id}`}
        >
          vitals →
        </Link>
        <Link
          className="text-[color:var(--accent)] hover:text-[color:var(--accent-strong)]"
          to={`/org/${orgSlug}/projects/${project.id}/integration`}
          title="Install SDK + ingest tokens"
        >
          integrate →
        </Link>
      </div>
    </li>
  )
}

function SubSection({
  children,
  sub,
  title,
}: {
  children: React.ReactNode
  sub: string
  title: string
}) {
  return (
    <section className="mt-8">
      <header className="sec-head">
        <span className="sec-head-title">{title}</span>
        <span className="sec-head-sub">{sub}</span>
      </header>
      <div>{children}</div>
    </section>
  )
}

function Kpi({
  highlight,
  label,
  sub,
  value,
  valueSuffix,
}: {
  highlight?: boolean
  label: string
  sub: string
  value: string
  valueSuffix?: string
}) {
  return (
    <div className="rule-cell">
      <div className="t-display text-[color:var(--ink)]" style={{ fontSize: '44px' }}>
        {highlight ? <span style={{ color: 'var(--accent)' }}>{value}</span> : value}
        {valueSuffix && (
          <span
            className="ml-1 text-[20px] text-[color:var(--ink-muted)]"
            style={{ fontVariationSettings: "'wdth' 96, 'opsz' 24, 'wght' 500" }}
          >
            {valueSuffix}
          </span>
        )}
      </div>
      <div className="t-tag mt-2.5">{label}</div>
      <div className="mt-1.5 text-[12px] text-[color:var(--ink-soft)]">{sub}</div>
    </div>
  )
}

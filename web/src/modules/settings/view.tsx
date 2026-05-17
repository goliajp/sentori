import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { adminApi, orgsApi, teamsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'

/**
 * Settings — org-wide config that doesn't belong on a single module.
 *
 * Sections (top → bottom):
 *   1. Organization (slug / name / role)
 *   2. Members (with role)
 *   3. Teams (with member count, link to detail)
 *   4. Projects (with slug, repo URL, "open issues" CTA)
 *
 * Lives behind /org/:slug/settings; admin gating happens in the
 * sidebar (the link only renders for owner/admin), not here.
 */
export function SettingsView() {
  const { currentOrg } = useOrg()

  const membersQ = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => orgsApi.listMembers(currentOrg.slug),
    queryKey: ['members', currentOrg.slug],
  })

  const teamsQ = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: () => teamsApi.list(currentOrg.slug),
    queryKey: ['teams', currentOrg.slug],
  })

  const projectsQ = useQuery({
    enabled: !!currentOrg.slug,
    queryFn: adminApi.listProjects,
    queryKey: ['projects'],
  })

  const members = membersQ.data ?? []
  const teams = teamsQ.data ?? []
  const projects = (projectsQ.data ?? []).filter((p) => p.orgSlug === currentOrg.slug)

  return (
    <div className="sentori-page-in">
      <PageHeader subtitle="org configuration" title="Settings" />

      <SubSection title="Organization">
        <Row label="slug">
          <span className="font-mono">{currentOrg.slug}</span>
        </Row>
        <Row label="name">{currentOrg.name}</Row>
        <Row label="your role">
          <span className="font-mono text-[color:var(--accent)]">{currentOrg.role}</span>
        </Row>
      </SubSection>

      <SubSection sub={`${members.length} total`} title="Members">
        {membersQ.isLoading && <Hint>Loading…</Hint>}
        {!membersQ.isLoading && members.length === 0 && <Hint>No members.</Hint>}
        {members.length > 0 && (
          <ul>
            {members.map((m, i) => (
              <li
                className={`flex items-baseline justify-between gap-3 border-b border-[color:var(--rule-soft)] py-2 ${
                  i === 0 ? 'border-t border-[color:var(--rule)]' : ''
                }`}
                key={m.userId}
              >
                <span className="text-[13px] text-[color:var(--ink)]">{m.email}</span>
                <span className="font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
                  {m.role}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SubSection>

      <SubSection sub={`${teams.length} total`} title="Teams">
        {teamsQ.isLoading && <Hint>Loading…</Hint>}
        {!teamsQ.isLoading && teams.length === 0 && (
          <Hint>
            No teams yet. Create one via <code className="font-mono">teamsApi.create</code> (orgs
            admin token), or wait for the in-dashboard create-team form — coming in v1.1.
          </Hint>
        )}
        {teams.length > 0 && (
          <table className="bench">
            <thead>
              <tr>
                <th>name</th>
                <th>slug</th>
                <th>description</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td className="lead">
                    <Link
                      className="text-[color:var(--ink)] hover:text-[color:var(--accent)]"
                      to={`/org/${currentOrg.slug}/teams/${t.slug}`}
                    >
                      {t.name}
                    </Link>
                  </td>
                  <td className="font-mono text-[color:var(--ink-soft)]">{t.slug}</td>
                  <td className="text-[color:var(--ink-soft)]">{t.description ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SubSection>

      <SubSection sub={`${projects.length} total`} title="Projects">
        {projectsQ.isLoading && <Hint>Loading…</Hint>}
        {!projectsQ.isLoading && projects.length === 0 && <Hint>No projects in this org yet.</Hint>}
        {projects.length > 0 && (
          <table className="bench">
            <thead>
              <tr>
                <th>name</th>
                <th>id</th>
                <th>repo</th>
                <th className="w-20"></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td className="lead">{p.name}</td>
                  <td className="font-mono text-[11px] text-[color:var(--ink-soft)]">{p.id}</td>
                  <td className="font-mono text-[11px] text-[color:var(--ink-soft)]">
                    {p.sourceRepoUrl ? (
                      <a
                        className="hover:text-[color:var(--accent)]"
                        href={p.sourceRepoUrl}
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        ↗ {hostOf(p.sourceRepoUrl) ?? p.sourceRepoUrl}
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <Link
                      className="font-mono text-[10px] tracking-[0.1em] text-[color:var(--ink-muted)] uppercase hover:text-[color:var(--accent)]"
                      to={`/org/${currentOrg.slug}/issues?project=${p.id}`}
                    >
                      open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </SubSection>
    </div>
  )
}

function hostOf(url: string): null | string {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-y border-[color:var(--rule)] py-4 text-[13px] text-[color:var(--ink-soft)]">
      {children}
    </p>
  )
}

function SubSection({
  children,
  sub,
  title,
}: {
  children: React.ReactNode
  sub?: string
  title: string
}) {
  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">{title}</span>
        {sub && <span className="sec-head-sub">{sub}</span>}
      </header>
      <div>{children}</div>
    </section>
  )
}

function Row({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[color:var(--rule-soft)] py-2 first:border-t first:border-[color:var(--rule)]">
      <span className="font-mono text-[10px] tracking-[0.22em] text-[color:var(--ink-muted)] uppercase">
        {label}
      </span>
      <span className="min-w-0 truncate text-right text-[13px] text-[color:var(--ink)]">
        {children}
      </span>
    </div>
  )
}

import { useQuery } from '@tanstack/react-query'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { PageHeader } from '@/layout/page-header'

/**
 * Overview — editorial hero + KPI strip + a Health placeholder. No
 * section numbering: these are unrelated content blocks, not a
 * sequence. Hierarchy lives in type scale and rule weight (strong
 * top+bottom rules on the KPI strip, no rules around the hero, soft
 * top rule above the Health sub-section).
 */
export function OverviewView() {
  const { currentOrg } = useOrg()
  const projectsQ = useQuery({ queryFn: adminApi.listProjects, queryKey: ['projects'] })
  const projectCount = (projectsQ.data ?? []).filter((p) => p.orgSlug === currentOrg.slug).length

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

      <SubSection sub="stub · live throughput chart lands next" title="Health">
        <p className="max-w-prose pt-3 text-[13px] text-[color:var(--ink-soft)]">
          Live throughput + per-project health summaries land here in the next
          iteration. The Plex-Mono mini-charts will sit in the same column grid
          as the KPI strip above.
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
          fontFamily: 'IBM Plex Sans, sans-serif',
          fontVariationSettings: "'wdth' 78, 'opsz' 96, 'wght' 700",
          fontSize: 'clamp(34px, 5vw, 54px)',
          lineHeight: '1.04',
          letterSpacing: '-0.035em',
        }}
      >
        Errors, traces &amp;{' '}
        <span
          style={{
            color: 'var(--accent)',
            fontVariationSettings: "'wdth' 78, 'opsz' 96, 'wght' 800",
          }}
        >
          intent
        </span>
        — at the speed of triage.
      </h2>
      <p className="mt-4 max-w-[56ch] text-[14px] leading-relaxed text-[color:var(--ink-soft)]">
        Watching {count.toLocaleString()} project{count === 1 ? '' : 's'} for{' '}
        <span className="font-mono text-[color:var(--ink)]">{orgName}</span>. Section
        anchors run down the left sidebar; data strips below have their own column rules.
      </p>
    </div>
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
    <section>
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
            style={{ fontVariationSettings: "'wdth' 92, 'opsz' 24, 'wght' 500" }}
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

import { useQuery } from '@tanstack/react-query'

import { adminApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'

/**
 * Overview — editorial KPI strip + section blocks. No card frames;
 * the rule-grid utility lays the KPIs in equal columns separated by
 * vertical hairlines and top/bottom rules.
 *
 * Real data: project count (live).
 * Placeholders: throughput, crash-free, ingest health — wire when
 * /admin/api/overview lands.
 */
export function OverviewView() {
  const { currentOrg } = useOrg()
  const projectsQ = useQuery({ queryFn: adminApi.listProjects, queryKey: ['projects'] })
  const projectCount = (projectsQ.data ?? []).filter((p) => p.orgSlug === currentOrg.slug).length

  return (
    <div className="sentori-page-in space-y-10">
      <Section num="00" title="Overview" sub={`org · ${currentOrg.slug}`}>
        <Hero count={projectCount} orgName={currentOrg.name ?? currentOrg.slug} />
      </Section>

      <Section num="01" title="Live numbers" sub="last 24h · placeholder">
        <div className="rule-grid grid-cols-2 md:grid-cols-4">
          <Kpi
            label="active projects"
            sub={projectsQ.isLoading ? 'loading…' : `${projectCount} configured`}
            value={projectCount.toString()}
          />
          <Kpi label="events / min" sub="wire /admin/api/overview" value="—" />
          <Kpi label="crash-free" sub="release-weighted" value="—" valueSuffix="%" />
          <Kpi highlight label="ingest" sub="all regions responding" value="OK" />
        </div>
      </Section>

      <Section num="02" title="Health" sub="stub · live throughput chart lands next">
        <p className="max-w-prose pt-4 text-[13px] text-[color:var(--ink-soft)]">
          Live throughput + per-project health summaries land here in the next iteration. Treat this
          as the canvas — the Plex-Mono mini-charts will fit the same column grid as the KPI strip
          above.
        </p>
      </Section>
    </div>
  )
}

function Section({
  children,
  num,
  sub,
  title,
}: {
  children: React.ReactNode
  num: string
  sub: string
  title: string
}) {
  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-num">{num}</span>
        <h2 className="sec-head-title">{title}</h2>
        <span className="sec-head-sub">{sub}</span>
      </header>
      <div>{children}</div>
    </section>
  )
}

function Hero({ count, orgName }: { count: number; orgName: string }) {
  return (
    <div className="py-8">
      <h1
        className="max-w-prose text-[color:var(--ink)]"
        style={{
          fontFamily: 'IBM Plex Sans, sans-serif',
          fontVariationSettings: "'wdth' 78, 'opsz' 96, 'wght' 700",
          fontSize: 'clamp(38px, 5.5vw, 60px)',
          lineHeight: '1.02',
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
      </h1>
      <p className="mt-5 max-w-[56ch] text-[15px] leading-relaxed text-[color:var(--ink-soft)]">
        Sentori's editorial dashboard reads like a pre-flight checklist: section numbering on the
        left, hairlines for structure, mono numerics for facts. Currently watching{' '}
        {count.toLocaleString()} project{count === 1 ? '' : 's'} for{' '}
        <span className="font-mono text-[color:var(--ink)]">{orgName}</span>.
      </p>
    </div>
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

import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'

import {
  adminApi,
  type ReleaseArtifacts,
  type ReleaseDsym,
  type ReleaseMapping,
  type ReleaseSourcemap,
} from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { ErrorState, LoadingState } from '@/components/states'

/**
 * Phase 23 sub-B: per-release artifact tree.
 *
 * Reads the unified summary the sub-F endpoint already returns and
 * splits it into three sections — source maps, iOS dSYMs, Android
 * proguard mappings — with per-row size + upload timestamp +
 * uploader. Empty sections render a one-line "nothing here yet" hint
 * with a CLI command the user can copy.
 *
 * Phase 23 sub-D will layer regression-detection metadata on top
 * (reopened-issue chip), and sub-E adds the compare-with-previous-
 * release diff.
 */
export function ReleaseDetailView() {
  const { releaseName } = useParams<{ releaseName: string }>()
  const { currentOrg, currentProject } = useOrg()
  const navigate = useNavigate()
  const projectId = currentProject?.id ?? null

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId && !!releaseName,
    queryFn: () => adminApi.releaseArtifacts(projectId!, releaseName!),
    queryKey: ['release-artifacts', projectId, releaseName],
  })

  // Phase 23 sub-E: pull the full release list so the compare-with
  // selector knows what's available. Cached separately because it's
  // also used by `/releases`.
  const { data: allReleases } = useQuery({
    enabled: !!projectId,
    queryFn: () => adminApi.listReleases(projectId!),
    queryKey: ['releases', projectId],
  })

  if (!releaseName || !projectId) return <ErrorState label="Missing release context." />
  if (isLoading) return <LoadingState />
  if (error) return <ErrorState label="Failed to load release artifacts." />
  if (!data) return null

  const artifactCount = data.sourcemaps.length + data.dsyms.length + data.mappings.length
  const otherReleases = (allReleases ?? []).filter((r) => r.name !== releaseName)

  return (
    <div className="space-y-6 p-6">
      <header>
        <Link
          className="text-fg-muted hover:text-fg text-[12px]"
          to={`/org/${currentOrg.slug}/releases`}
        >
          ← All releases
        </Link>
        <div className="mt-2 flex items-baseline justify-between gap-4">
          <h1 className="text-fg truncate font-mono text-[18px] font-semibold">{data.release}</h1>
          {otherReleases.length > 0 && (
            <select
              aria-label="Compare with"
              className="border-border bg-bg-tertiary text-fg max-w-[260px] shrink-0 rounded-md border px-2 py-1 font-mono text-[12px]"
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return
                navigate(
                  `/org/${currentOrg.slug}/releases/${encodeURIComponent(
                    releaseName
                  )}/compare/${encodeURIComponent(e.target.value)}`
                )
              }}
            >
              <option value="">Compare with…</option>
              {otherReleases.map((r) => (
                <option key={r.id} value={r.name}>
                  {r.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="text-fg-muted mt-1 text-[12px]">
          {artifactCount} artifact{artifactCount === 1 ? '' : 's'} uploaded for this release.
        </p>
      </header>

      <ReleaseHealthPanel projectId={projectId} release={data.release} />

      <ArtifactSection
        emptyHint={
          <>
            Upload with{' '}
            <code className="font-mono">
              sentori-cli upload sourcemap --release="{data.release}" ./build/static/js
            </code>
          </>
        }
        rows={data.sourcemaps.map((s) => ({
          createdAt: s.createdAt,
          key: s.id,
          left: s.name,
          right: <span className="text-fg-muted text-[11px]">{s.kind}</span>,
        }))}
        title="Source maps"
      />

      <DsymSection dsyms={data.dsyms} projectId={projectId} release={data.release} />

      <MappingSection mappings={data.mappings} projectId={projectId} release={data.release} />
    </div>
  )
}

/**
 * Phase 26 sub-E: per-release crash-free metrics.
 *
 * Same `health` endpoint as the overview widget, scoped by `?release=`.
 * v0.2 window is the last 7 days — short enough to feel current, long
 * enough to dwarf single-bucket noise on low-traffic releases. The
 * dashboard's overview widget uses 24h; we deliberately diverge here
 * because per-release sample sizes need a wider window to be useful.
 *
 * If the release has no session pings, we render a one-line hint
 * pointing at the SDK rather than misleading "0%" numbers.
 */
function ReleaseHealthPanel({ projectId, release }: { projectId: string; release: string }) {
  const { data, isLoading } = useQuery({
    queryFn: () => {
      // Compute the window inside queryFn so Date.now() runs at fetch
      // time, not during render. Keeps react-hooks/purity satisfied
      // and means a re-fetch picks up the rolling 7-day window.
      const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()
      return adminApi.health(projectId, { bucket: '1d', from: sevenDaysAgo, release })
    },
    queryKey: ['health', projectId, release, '7d'],
    staleTime: 60_000,
  })
  if (isLoading || !data) return null

  return (
    <section>
      <h2 className="text-fg-muted text-[11px] tracking-wider uppercase">Health · last 7 days</h2>
      {data.summary.totalSessions === 0 ? (
        <p className="text-fg-muted mt-2 text-[12px]">No session pings on this release yet.</p>
      ) : (
        <dl className="border-border mt-2 grid grid-cols-2 gap-x-6 gap-y-1 rounded-md border p-4 sm:grid-cols-4">
          <HealthStat
            label="Crash-free sessions"
            tone={rateTone(data.summary.crashFreeSessionRate, 0.99)}
            value={formatRate(data.summary.crashFreeSessionRate)}
          />
          <HealthStat
            label="Crash-free users"
            tone={rateTone(data.summary.crashFreeUserRate, 0.995)}
            value={formatRate(data.summary.crashFreeUserRate)}
          />
          <HealthStat
            label="Sessions"
            tone="neutral"
            value={data.summary.totalSessions.toLocaleString()}
          />
          <HealthStat
            label="Crashed"
            tone={data.summary.crashedSessions > 0 ? 'warn' : 'neutral'}
            value={data.summary.crashedSessions.toLocaleString()}
          />
        </dl>
      )}
    </section>
  )
}

function HealthStat({
  label,
  tone,
  value,
}: {
  label: string
  tone: 'good' | 'neutral' | 'warn'
  value: string
}) {
  const valueClass =
    tone === 'good'
      ? 'text-[color:var(--color-success)]'
      : tone === 'warn'
        ? 'text-[color:var(--color-warning)]'
        : 'text-fg'
  return (
    <div>
      <dt className="text-fg-muted text-[10px] tracking-wider uppercase">{label}</dt>
      <dd className={`mt-1 font-mono text-[14px] tabular-nums ${valueClass}`}>{value}</dd>
    </div>
  )
}

function formatRate(rate: null | number): string {
  if (rate == null) return '—'
  return `${(rate * 100).toFixed(2)}%`
}

function rateTone(rate: null | number, threshold: number): 'good' | 'neutral' | 'warn' {
  if (rate == null) return 'neutral'
  return rate >= threshold ? 'good' : 'warn'
}

function DsymSection({
  dsyms,
  projectId,
  release,
}: {
  dsyms: ReleaseDsym[]
  projectId: string
  release: string
}) {
  return (
    <ArtifactSection
      emptyHint={
        <>
          Upload with{' '}
          <code className="font-mono">
            sentori-cli upload dsym --project="{projectId}" --release="{release}" path/to/MyApp.dSYM
          </code>{' '}
          (needs Xcode CLT's <code className="font-mono">dwarfdump</code>; or pass{' '}
          <code className="font-mono">--debug-id</code> + <code className="font-mono">--arch</code>{' '}
          for a single slice)
        </>
      }
      rows={dsyms.map((d) => ({
        createdAt: d.uploadedAt,
        key: d.id,
        left: d.objectName ?? d.debugId,
        right: (
          <span className="flex items-center gap-2 text-[11px]">
            <span className="text-fg-muted font-mono">{d.debugId.slice(0, 8)}…</span>
            <span className="bg-bg-tertiary text-fg-muted rounded px-1.5 py-0.5 font-mono">
              {d.arch}
            </span>
            <span className="text-fg-muted font-mono tabular-nums">{humanBytes(d.sizeBytes)}</span>
          </span>
        ),
        uploader: d.uploadedByEmail,
      }))}
      title="iOS dSYMs"
    />
  )
}

function MappingSection({
  mappings,
  projectId,
  release,
}: {
  mappings: ReleaseMapping[]
  projectId: string
  release: string
}) {
  return (
    <ArtifactSection
      emptyHint={
        <>
          Upload with{' '}
          <code className="font-mono">
            sentori-cli upload mapping --project="{projectId}" --release="{release}"
            path/to/mapping.txt
          </code>
        </>
      }
      rows={mappings.map((m) => ({
        createdAt: m.uploadedAt,
        key: m.id,
        left: m.debugId ?? '(no embedded id)',
        right: (
          <span className="text-fg-muted font-mono text-[11px] tabular-nums">
            {humanBytes(m.sizeBytes)}
          </span>
        ),
        uploader: m.uploadedByEmail,
      }))}
      title="Android ProGuard mappings"
    />
  )
}

type Row = {
  createdAt: string
  key: string
  left: React.ReactNode
  right: React.ReactNode
  uploader?: null | string
}

function ArtifactSection({
  emptyHint,
  rows,
  title,
}: {
  emptyHint: React.ReactNode
  rows: Row[]
  title: string
}) {
  return (
    <section>
      <h2 className="text-fg-muted text-[11px] tracking-wider uppercase">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-fg-muted mt-2 text-[12px]">{emptyHint}</p>
      ) : (
        <ul className="border-border divide-border mt-2 divide-y rounded-md border">
          {rows.map((r) => (
            <li className="flex items-center justify-between gap-3 px-4 py-2" key={r.key}>
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="text-fg truncate font-mono text-[12px]">{r.left}</span>
                {r.right}
              </div>
              <div className="text-fg-muted shrink-0 text-right text-[11px]">
                <div className="font-mono tabular-nums">{relativeDay(r.createdAt)}</div>
                {r.uploader && (
                  <div className="text-[10px]" title={r.uploader}>
                    {r.uploader.length > 24 ? r.uploader.slice(0, 22) + '…' : r.uploader}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function relativeDay(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms)) return iso
  const days = Math.floor(ms / 86_400_000)
  if (days <= 0) {
    const hours = Math.floor(ms / 3_600_000)
    if (hours <= 0) return 'just now'
    return `${hours}h ago`
  }
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

// re-export type for clarity in callers
export type { ReleaseArtifacts, ReleaseSourcemap }

import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'

import {
  adminApi,
  type ReleaseArtifacts,
  type ReleaseDsym,
  type ReleaseMapping,
  type ReleaseSourcemap,
} from '@/api/client'
import { useOrg } from '@/auth/orgContext'

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
  const projectId = currentProject?.id ?? null

  const { data, error, isLoading } = useQuery({
    enabled: !!projectId && !!releaseName,
    queryFn: () => adminApi.releaseArtifacts(projectId!, releaseName!),
    queryKey: ['release-artifacts', projectId, releaseName],
  })

  if (!releaseName || !projectId) {
    return <div className="text-fg-muted px-6 py-6 text-sm">Missing release context.</div>
  }
  if (isLoading) return <div className="text-fg-muted px-6 py-6 text-sm">Loading…</div>
  if (error)
    return <div className="px-6 py-6 text-sm text-red-400">Failed to load release artifacts.</div>
  if (!data) return null

  const artifactCount = data.sourcemaps.length + data.dsyms.length + data.mappings.length

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <Link
          className="text-fg-muted hover:text-fg text-[12px]"
          to={`/org/${currentOrg.slug}/releases`}
        >
          ← All releases
        </Link>
        <h1 className="text-fg mt-2 truncate font-mono text-[18px] font-semibold">
          {data.release}
        </h1>
        <p className="text-fg-muted mt-1 text-[12px]">
          {artifactCount} artifact{artifactCount === 1 ? '' : 's'} uploaded for this release.
        </p>
      </header>

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

      <DsymSection dsyms={data.dsyms} release={data.release} />

      <MappingSection mappings={data.mappings} release={data.release} />
    </div>
  )
}

function DsymSection({ dsyms, release }: { dsyms: ReleaseDsym[]; release: string }) {
  return (
    <ArtifactSection
      emptyHint={
        <>
          Upload with{' '}
          <code className="font-mono">
            sentori-cli upload dsym --release="{release}" path/to/MyApp.dSYM
          </code>
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

function MappingSection({ mappings, release }: { mappings: ReleaseMapping[]; release: string }) {
  return (
    <ArtifactSection
      emptyHint={
        <>
          Upload with{' '}
          <code className="font-mono">
            sentori-cli upload mapping --release="{release}" path/to/mapping.txt
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

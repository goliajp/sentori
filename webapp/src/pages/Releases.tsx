// Releases — "did this version ship healthy?" (design.md §11).
// One row per release: the three symbolication lights (sourcemap /
// dsym / proguard), backed by upload commands when a light is off.
// Artifact gaps are most visible here, on purpose.

import { useState } from 'react';

import { useShell } from '../App';
import { EmptyState, ErrorBanner, formatRelative } from '../components/ui';
import { useT } from '../i18n';
import { api, type ArtifactRow, type ReleaseRow } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

export default function ReleasesPage() {
  const t = useT();
  const { projects } = useShell();
  const [projectId, setProjectId] = useState<string | null>(null);
  const active = projectId ?? projects[0]?.id ?? null;

  const { data, error, loading, reload } = useAsyncData(
    () => (active ? api.listReleases(active) : Promise.resolve({ releases: [] })),
    [active],
  );

  return (
    <div className="mx-auto max-w-[1760px] px-7 py-5">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-base font-semibold">{t('nav.releases')}</h1>
        {projects.length > 1 && (
          <select
            value={active ?? ''}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded border border-border bg-transparent px-2 py-1 text-xs"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <ErrorBanner>
          {t('releases.loadFailed')}{' '}
          <button type="button" className="underline" onClick={reload}>
            {t('common.retry')}
          </button>
        </ErrorBanner>
      )}
      {loading && !data && <div className="py-16 text-center text-sm opacity-50">…</div>}
      {data && data.releases.length === 0 && (
        <EmptyState title={t('releases.emptyTitle')} hint={t('releases.emptyHint')} />
      )}

      <div className="space-y-1.5">
        {(data?.releases ?? []).map((r) => (
          <ReleaseRowView key={r.id} release={r} projectId={active ?? ''} />
        ))}
      </div>
    </div>
  );
}

function ReleaseRowView({ release, projectId }: { release: ReleaseRow; projectId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { data } = useAsyncData(
    () =>
      open
        ? api.listArtifacts(projectId, release.id)
        : Promise.resolve({ artifacts: [] as ArtifactRow[] }),
    [open, release.id],
  );
  const artifacts = data?.artifacts ?? [];
  const kinds = new Set(artifacts.map((a) => a.kind));
  const created = release.createdAt ?? release.created_at;

  return (
    <div className="rounded-lg border border-border">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2 text-left"
      >
        <span className="min-w-0 flex-1 truncate font-mono text-sm">{release.name}</span>
        <Light on={open ? kinds.has('sourcemap') : undefined} label="js" />
        <Light on={open ? kinds.has('dsym') : undefined} label="ios" />
        <Light on={open ? kinds.has('proguard') : undefined} label="android" />
        {created && (
          <span className="w-16 text-right font-mono text-[11px] opacity-40">
            {formatRelative(created)}
          </span>
        )}
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2">
          {artifacts.length === 0 ? (
            <div className="text-xs opacity-60">
              <p>{t('releases.noArtifacts')}</p>
              <code className="mt-1 block rounded bg-bg p-2 font-mono text-[11px]">
                sentori-cli upload sourcemap --release &quot;{release.name}&quot; --token
                &lt;api-token&gt; &lt;map&gt;
              </code>
            </div>
          ) : (
            <div className="space-y-0.5">
              {artifacts.map((a) => (
                <div key={a.id} className="flex gap-3 font-mono text-xs">
                  <span className="w-20 opacity-60">{a.kind}</span>
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  {a.size_bytes !== undefined && (
                    <span className="opacity-40">{Math.round(a.size_bytes / 1024)} KB</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Light({ on, label }: { on: boolean | undefined; label: string }) {
  return (
    <span className="flex items-center gap-1 font-mono text-[10px] opacity-70">
      <span
        className="h-2 w-2 rounded-full"
        style={{
          backgroundColor: on === undefined ? 'color-mix(in srgb, var(--gds-fg-muted) 30%, transparent)' : on ? 'var(--s-kind-probe)' : 'var(--s-kind-error)',
        }}
      />
      {label}
    </span>
  );
}

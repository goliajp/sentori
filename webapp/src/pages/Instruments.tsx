// Instruments — "how are the devices I planted doing?" (design.md
// §11). Three panels: asserts (alive + failure rate, "ran 45k,
// failed 3"), probes (silent = fix holding), traces (did it run,
// what magnitude). A status panel, not a data browser.

import { useState } from 'react';
import { Link } from 'react-router-dom';

import { useShell } from '../App';
import { EmptyState, ErrorBanner, formatRelative } from '../components/ui';
import { useT } from '../i18n';
import { useAsyncData } from '../lib/useAsyncData';

type Instruments = {
  asserts: Array<{
    name: string;
    release: string;
    passCount: number;
    failCount: number;
    lastPassAt: string | null;
    lastFailAt: string | null;
  }>;
  probes: Array<{
    ref: string;
    issueId: string | null;
    lastSeenRelease: string | null;
    registeredAt: string;
    lastFiredAt: string | null;
    fireCount: number;
  }>;
  traces: Array<{
    name: string;
    eventCount: number;
    usersCount: number;
    lastSeen: string;
  }>;
};

export default function InstrumentsPage() {
  const t = useT();
  const { projects } = useShell();
  const [projectId, setProjectId] = useState<string | null>(null);
  const active = projectId ?? projects[0]?.id ?? null;

  const { data, error, loading, reload } = useAsyncData<Instruments | null>(
    () =>
      active
        ? fetchInstruments(active)
        : Promise.resolve(null),
    [active],
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-5">
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-base font-semibold">{t('nav.instruments')}</h1>
        {projects.length > 1 && (
          <select
            value={active ?? ''}
            onChange={(e) => setProjectId(e.target.value)}
            className="rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 text-xs"
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
          {t('instruments.loadFailed')}{' '}
          <button type="button" className="underline" onClick={reload}>
            {t('common.retry')}
          </button>
        </ErrorBanner>
      )}
      {loading && !data && <div className="py-16 text-center text-sm opacity-50">…</div>}
      {!active && <EmptyState title={t('instruments.noProject')} hint="" />}

      {data && (
        <div className="space-y-8">
          <Panel title={t('instruments.asserts')} count={data.asserts.length}>
            {data.asserts.length === 0 ? (
              <Hint text={t('instruments.assertsEmpty')} />
            ) : (
              data.asserts.map((a) => {
                const total = a.passCount + a.failCount;
                const healthy = a.failCount === 0;
                return (
                  <div
                    key={`${a.name}-${a.release}`}
                    className="flex items-center gap-3 px-3 py-1.5 font-mono text-xs"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: healthy ? '#4cd97b' : '#ff5d5d' }}
                    />
                    <span className="min-w-0 flex-1 truncate">{a.name}</span>
                    <span className="opacity-40">{a.release}</span>
                    <span className="tabular-nums opacity-80">
                      {t('instruments.assertRan', {
                        total: String(total),
                        failed: String(a.failCount),
                      })}
                    </span>
                  </div>
                );
              })
            )}
          </Panel>

          <Panel title={t('instruments.probes')} count={data.probes.length}>
            {data.probes.length === 0 ? (
              <Hint text={t('instruments.probesEmpty')} />
            ) : (
              data.probes.map((p) => {
                const silent = p.fireCount === 0;
                return (
                  <div
                    key={p.ref}
                    className="flex items-center gap-3 px-3 py-1.5 font-mono text-xs"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: silent ? '#4cd97b' : '#ff5d5d' }}
                    />
                    <span className="min-w-0 flex-1 truncate">{p.ref}</span>
                    {p.lastSeenRelease && (
                      <span className="opacity-40">{p.lastSeenRelease}</span>
                    )}
                    <span className="tabular-nums opacity-80">
                      {silent
                        ? t('instruments.probeSilent', {
                            since: formatRelative(p.registeredAt),
                          })
                        : t('instruments.probeFired', {
                            count: String(p.fireCount),
                            last: p.lastFiredAt ? formatRelative(p.lastFiredAt) : '',
                          })}
                    </span>
                    {p.issueId && (
                      <Link to={`/issues/${p.issueId}`} className="underline opacity-60">
                        {t('instruments.guardedIssue')}
                      </Link>
                    )}
                  </div>
                );
              })
            )}
          </Panel>

          <Panel title={t('instruments.traces')} count={data.traces.length}>
            {data.traces.length === 0 ? (
              <Hint text={t('instruments.tracesEmpty')} />
            ) : (
              data.traces.map((tr) => (
                <div
                  key={tr.name}
                  className="flex items-center gap-3 px-3 py-1.5 font-mono text-xs"
                >
                  <span className="min-w-0 flex-1 truncate">{tr.name}</span>
                  <span className="tabular-nums opacity-80">
                    {tr.eventCount}ev · {tr.usersCount}u
                  </span>
                  <span className="w-16 text-right opacity-40">
                    {formatRelative(tr.lastSeen)}
                  </span>
                </div>
              ))
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}

async function fetchInstruments(projectId: string): Promise<Instruments> {
  const resp = await fetch(`/admin/api/projects/${projectId}/instruments`, {
    credentials: 'include',
  });
  if (!resp.ok) throw new Error(String(resp.status));
  return (await resp.json()) as Instruments;
}

function Panel({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-50">
        {title} <span className="font-mono">({count})</span>
      </h2>
      <div className="divide-y divide-[var(--gds-border,#2a2a30)] rounded-lg border border-[var(--gds-border,#2a2a30)]">
        {children}
      </div>
    </section>
  );
}

function Hint({ text }: { text: string }) {
  return <div className="px-3 py-4 text-xs opacity-50">{text}</div>;
}

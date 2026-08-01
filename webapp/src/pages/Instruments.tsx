// Instruments — "how are the devices I planted doing?" (design.md
// §11). Three panels: asserts (alive + failure rate, "ran 45k,
// failed 3"), probes (silent = fix holding), traces (did it run,
// what magnitude). A status panel, not a data browser.

import { Link } from 'react-router-dom';

import { useShell } from '../App';
import {
  ErrorBanner,
  PageShell,
  Panel,
  PanelEmpty,
  formatRelative,
} from '../components/ui';
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
  const { activeProject } = useShell();
  const active = activeProject?.id ?? null;

  const { data, error, loading, reload } = useAsyncData<Instruments | null>(
    () => (active ? fetchInstruments(active) : Promise.resolve(null)),
    [active],
  );

  return (
    <PageShell
      title={t('nav.instruments')}
    >
      {error && (
        <ErrorBanner>
          {t('instruments.loadFailed')}{' '}
          <button type="button" className="underline" onClick={reload}>
            {t('common.retry')}
          </button>
        </ErrorBanner>
      )}
      {loading && !data && (
        <div className="py-16 text-center text-sm text-fg-subtle">…</div>
      )}
      {!active && <PanelEmpty>{t('instruments.noProject')}</PanelEmpty>}

      {data && (
        <>
          <Panel title={`${t('instruments.asserts')} (${data.asserts.length})`}>
            {data.asserts.length === 0 ? (
              <PanelEmpty>{t('instruments.assertsEmpty')}</PanelEmpty>
            ) : (
              <div className="divide-y divide-border/60">
                {data.asserts.map((a) => {
                  const total = a.passCount + a.failCount;
                  const healthy = a.failCount === 0;
                  return (
                    <div
                      key={`${a.name}-${a.release}`}
                      className="flex items-center gap-3 px-3.5 py-2 font-mono text-[13px]"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: healthy
                            ? 'var(--s-kind-probe)'
                            : 'var(--s-kind-error)',
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-fg">{a.name}</span>
                      <span className="text-fg-subtle">{a.release}</span>
                      <span className="tabular-nums text-fg-muted">
                        {t('instruments.assertRan', {
                          total: String(total),
                          failed: String(a.failCount),
                        })}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title={`${t('instruments.probes')} (${data.probes.length})`}>
            {data.probes.length === 0 ? (
              <PanelEmpty>{t('instruments.probesEmpty')}</PanelEmpty>
            ) : (
              <div className="divide-y divide-border/60">
                {data.probes.map((p) => {
                  const silent = p.fireCount === 0;
                  return (
                    <div
                      key={p.ref}
                      className="flex items-center gap-3 px-3.5 py-2 font-mono text-[13px]"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{
                          backgroundColor: silent
                            ? 'var(--s-kind-probe)'
                            : 'var(--s-kind-error)',
                        }}
                      />
                      <span className="min-w-0 flex-1 truncate text-fg">{p.ref}</span>
                      {p.lastSeenRelease && (
                        <span className="text-fg-subtle">{p.lastSeenRelease}</span>
                      )}
                      <span className="tabular-nums text-fg-muted">
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
                        <Link
                          to={`/issues/${p.issueId}`}
                          className="text-fg-muted underline hover:text-fg"
                        >
                          {t('instruments.guardedIssue')}
                        </Link>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel title={`${t('instruments.traces')} (${data.traces.length})`}>
            {data.traces.length === 0 ? (
              <PanelEmpty>{t('instruments.tracesEmpty')}</PanelEmpty>
            ) : (
              <div className="divide-y divide-border/60">
                {data.traces.map((tr) => (
                  <div
                    key={tr.name}
                    className="flex items-center gap-3 px-3.5 py-2 font-mono text-[13px]"
                  >
                    <span className="min-w-0 flex-1 truncate text-fg">{tr.name}</span>
                    <span className="tabular-nums text-fg-muted">
                      {tr.eventCount}ev · {tr.usersCount}u
                    </span>
                    <span className="w-16 text-right text-fg-subtle">
                      {formatRelative(tr.lastSeen)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </>
      )}
    </PageShell>
  );
}

async function fetchInstruments(projectId: string): Promise<Instruments> {
  const resp = await fetch(`/admin/api/projects/${projectId}/instruments`, {
    credentials: 'include',
  });
  if (!resp.ok) throw new Error(String(resp.status));
  return (await resp.json()) as Instruments;
}

// Projects — the layer above everything else. One professional
// table row per project, joined with the pulse its SDK traffic
// reports (heartbeat, day counts, users, replay coverage, artifact
// lights). Picking a row scopes the whole app to that project and
// lands in its inbox — the Jira space model: the sidebar names
// where you are; this page is where you choose.

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useShell } from '../App';
import {
  Button,
  DataTable,
  Input,
  PageShell,
  Panel,
  formatRelative,
  formatRelease,
} from '../components/ui';
import { useT } from '../i18n';
import { api, type Project, type ProjectHealth } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

type Row = Project & { health: ProjectHealth | null };

export default function ProjectsPage() {
  const t = useT();
  const { me, projects, activeProject, setActiveProjectId, reloadProjects } =
    useShell();
  const navigate = useNavigate();
  const owner = me.role === 'superadmin';
  const [name, setName] = useState('');

  // Captured per render, not called in render (react-hooks/purity).
  const [now] = useState(() => Date.now());
  const { data } = useAsyncData<Row[]>(
    () =>
      Promise.all(
        projects.map(async (p) => ({
          ...p,
          health: await api.projectHealth(p.id).catch(() => null),
        })),
      ),
    [projects],
  );
  const rows = data ?? projects.map((p) => ({ ...p, health: null }));

  const open = (row: Row) => {
    setActiveProjectId(row.id);
    navigate('/');
  };

  return (
    <PageShell
      title={t('nav.projects')}
      toolbar={
        owner ? (
          <div className="ml-auto flex items-center gap-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('settings.projectName')}
              className="h-7 w-56 text-[13px]"
            />
            <Button
              size="sm"
              variant="primary"
              disabled={name.trim().length === 0}
              onClick={() => {
                void api.createProject(name.trim()).then(() => {
                  setName('');
                  reloadProjects();
                });
              }}
            >
              {t('settings.createProject')}
            </Button>
          </div>
        ) : undefined
      }
    >
      <Panel title={`${t('nav.projects')} (${projects.length})`}>
        <DataTable<Row>
          columns={[
            {
              key: 'name',
              label: t('projects.col.name'),
              render: (r) => (
                <span className="flex items-center gap-2">
                  <Pulse health={r.health} now={now} />
                  <span className="font-medium text-fg">{r.name}</span>
                </span>
              ),
            },
            { key: 'platform', label: t('projects.col.platform'), width: '90px' },
            {
              key: 'lastEvent',
              label: t('projects.col.lastEvent'),
              width: '110px',
              render: (r) =>
                r.health?.lastEventAt ? (
                  <span className="font-mono text-xs">
                    {formatRelative(r.health.lastEventAt)}
                  </span>
                ) : (
                  <span className="text-fg-subtle">{t('health.silent')}</span>
                ),
            },
            {
              key: 'err',
              label: '24h err',
              align: 'right',
              width: '80px',
              render: (r) => <Num n={r.health?.counts24h.error} tone="error" />,
            },
            {
              key: 'warn',
              label: '24h warn',
              align: 'right',
              width: '90px',
              render: (r) => <Num n={r.health?.counts24h.warn} tone="warn" />,
            },
            {
              key: 'users',
              label: t('projects.col.users'),
              align: 'right',
              width: '80px',
              render: (r) => <Num n={r.health?.users24h} />,
            },
            {
              key: 'replay',
              label: t('health.replay'),
              align: 'right',
              width: '90px',
              render: (r) =>
                r.health && r.health.replay24h.eligible > 0 ? (
                  <span className="font-mono text-xs">
                    {r.health.replay24h.withScreens}/{r.health.replay24h.eligible}
                  </span>
                ) : (
                  <span className="text-fg-subtle">—</span>
                ),
            },
            {
              key: 'release',
              label: t('projects.col.release'),
              render: (r) =>
                r.health?.latestRelease ? (
                  <span
                    className="flex items-center gap-2 font-mono text-xs"
                    title={r.health.latestRelease}
                  >
                    <span className="min-w-0 max-w-56 truncate">
                      {formatRelease(r.health.latestRelease)}
                    </span>
                    <ArtifactLights kinds={r.health.latestReleaseArtifacts} />
                  </span>
                ) : (
                  <span className="text-fg-subtle">—</span>
                ),
            },
            {
              key: 'createdAt',
              label: t('projects.col.created'),
              align: 'right',
              width: '100px',
              render: (r) => (
                <span className="font-mono text-xs">{formatRelative(r.createdAt)}</span>
              ),
            },
            ...(owner
              ? [
                  {
                    key: 'actions',
                    label: '',
                    align: 'right' as const,
                    width: '70px',
                    render: (r: Row) => (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (
                            window.confirm(
                              t('settings.deleteProjectConfirm', { name: r.name }),
                            )
                          ) {
                            void api.deleteProject(r.id).then(reloadProjects);
                          }
                        }}
                        className="text-xs text-kind-error/70 hover:text-kind-error"
                      >
                        {t('common.delete')}
                      </button>
                    ),
                  },
                ]
              : []),
          ]}
          rows={rows}
          rowKey={(r) => r.id}
          activeKey={activeProject?.id ?? null}
          onRowClick={open}
          footer={t('projects.count', { n: String(projects.length) })}
        />
      </Panel>
    </PageShell>
  );
}

function Pulse({ health, now }: { health: ProjectHealth | null; now: number }) {
  const last = health?.lastEventAt ? Date.parse(health.lastEventAt) : null;
  const age = last === null ? null : now - last;
  const color =
    age === null
      ? 'var(--gds-fg-muted)'
      : age < 10 * 60_000
        ? 'var(--s-kind-probe)'
        : age < 60 * 60_000
          ? 'var(--s-kind-warn)'
          : 'var(--s-kind-error)';
  return (
    <span
      aria-hidden
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function Num({ n, tone }: { n: number | undefined; tone?: 'error' | 'warn' }) {
  if (n === undefined || n === 0)
    return <span className="text-fg-subtle">{n ?? '—'}</span>;
  return (
    <span
      className="font-mono text-xs font-medium"
      style={tone ? { color: `var(--s-kind-${tone})` } : undefined}
    >
      {n}
    </span>
  );
}

function ArtifactLights({ kinds }: { kinds: string[] }) {
  const lights: [string, string][] = [
    ['js', 'sourcemap'],
    ['ios', 'dsym'],
    ['android', 'proguard'],
  ];
  return (
    <span className="flex shrink-0 gap-1.5 text-[10px]">
      {lights.map(([label, kind]) => (
        <span
          key={label}
          style={{
            color: kinds.includes(kind)
              ? 'var(--s-kind-probe)'
              : 'var(--s-kind-error)',
          }}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

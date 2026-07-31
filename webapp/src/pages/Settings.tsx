// Settings — the admin surface. Owner sections (projects / admins /
// tokens / audit) plus the personal section (password, language).
// Tables are fine here: the anti-data-pool rule governs observability
// data, not management screens.

import { useState } from 'react';

import { useShell } from '../App';
import { ErrorBanner, formatRelative } from '../components/ui';
import { useLocale, useSetLocale, useT } from '../i18n';
import {
  api,
  type NotificationPref,
  type Project,
  type TokenRow,
  type UserRow,
} from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

type Tab = 'account' | 'audit' | 'notifications' | 'projects' | 'tokens' | 'users';

export default function SettingsPage() {
  const t = useT();
  const { me } = useShell();
  const owner = me.role === 'superadmin';
  const tabs: Tab[] = owner
    ? ['projects', 'tokens', 'users', 'notifications', 'audit', 'account']
    : ['tokens', 'notifications', 'account'];
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'account');

  return (
    <div className="mx-auto max-w-5xl px-6 py-5">
      <h1 className="mb-4 text-base font-semibold">{t('nav.settings')}</h1>
      <div className="mb-5 flex gap-1 border-b border-[var(--gds-border,#2a2a30)]">
        {tabs.map((x) => (
          <button
            key={x}
            type="button"
            onClick={() => setTab(x)}
            className={`px-3 py-1.5 text-sm ${
              tab === x
                ? 'border-b-2 border-[var(--gds-accent,#4c8dff)] font-medium'
                : 'opacity-60 hover:opacity-100'
            }`}
          >
            {t(`settings.tab.${x}`)}
          </button>
        ))}
      </div>
      {tab === 'projects' && <ProjectsTab />}
      {tab === 'tokens' && <TokensTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'account' && <AccountTab />}
    </div>
  );
}

function ProjectsTab() {
  const t = useT();
  const { projects, reloadProjects } = useShell();
  const [name, setName] = useState('');
  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.projectName')}
          className="flex-1 rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 text-sm"
        />
        <button
          type="button"
          disabled={name.trim().length === 0}
          onClick={() => {
            void api.createProject(name.trim()).then(() => {
              setName('');
              reloadProjects();
            });
          }}
          className="rounded bg-[var(--gds-accent,#4c8dff)] px-3 py-1 text-sm font-medium text-black disabled:opacity-40"
        >
          {t('settings.createProject')}
        </button>
      </div>
      <div className="divide-y divide-[var(--gds-border,#2a2a30)] rounded-lg border border-[var(--gds-border,#2a2a30)]">
        {projects.map((p: Project) => (
          <div key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="flex-1">{p.name}</span>
            <span className="font-mono text-xs opacity-40">{p.platform}</span>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t('settings.deleteProjectConfirm', { name: p.name }))) {
                  void api.deleteProject(p.id).then(reloadProjects);
                }
              }}
              className="text-xs text-[#ff5d5d] opacity-60 hover:opacity-100"
            >
              {t('common.delete')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function TokensTab() {
  const t = useT();
  const { projects } = useShell();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'api' | 'ingest'>('ingest');
  const [minted, setMinted] = useState<string | null>(null);
  const { data, reload } = useAsyncData(
    () => (projectId ? api.listTokens(projectId) : Promise.resolve({ tokens: [] })),
    [projectId],
  );

  return (
    <div className="max-w-2xl space-y-4">
      {projects.length > 1 && (
        <select
          value={projectId}
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
      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.tokenName')}
          className="flex-1 rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 text-sm"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as 'api' | 'ingest')}
          className="rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 text-sm"
        >
          <option value="ingest">ingest</option>
          <option value="api">api</option>
        </select>
        <button
          type="button"
          disabled={!projectId || name.trim().length === 0}
          onClick={() => {
            void api.createToken(projectId, name.trim(), scope).then((r) => {
              setMinted(r.token);
              setName('');
              reload();
            });
          }}
          className="rounded bg-[var(--gds-accent,#4c8dff)] px-3 py-1 text-sm font-medium text-black disabled:opacity-40"
        >
          {t('settings.mintToken')}
        </button>
      </div>
      {minted && (
        <div className="rounded border border-[#4cd97b40] p-3 text-xs">
          <p className="mb-1 opacity-70">{t('settings.tokenOnce')}</p>
          <code className="block break-all rounded bg-[var(--gds-surface-sunken,#121216)] p-2 font-mono">
            {minted}
          </code>
        </div>
      )}
      <div className="divide-y divide-[var(--gds-border,#2a2a30)] rounded-lg border border-[var(--gds-border,#2a2a30)]">
        {(data?.tokens ?? []).map((tok: TokenRow) => (
          <div key={tok.id} className="flex items-center gap-3 px-3 py-2 text-sm">
            <span className="flex-1">{tok.name}</span>
            <span className="rounded bg-[var(--gds-surface-raised,#26262c)] px-1.5 font-mono text-[11px]">
              {tok.scope}
            </span>
            {tok.last4 && <span className="font-mono text-xs opacity-40">…{tok.last4}</span>}
            {tok.revokedAt ? (
              <span className="text-xs opacity-40">{t('settings.revoked')}</span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(t('settings.revokeConfirm', { name: tok.name }))) {
                    void api.revokeToken(tok.id).then(reload);
                  }
                }}
                className="text-xs text-[#ff5d5d] opacity-60 hover:opacity-100"
              >
                {t('settings.revoke')}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function UsersTab() {
  const t = useT();
  const { projects } = useShell();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { data, error, reload } = useAsyncData(() => api.listUsers(), []);

  return (
    <div className="max-w-3xl space-y-4">
      {error && <ErrorBanner>{t('settings.usersLoadFailed')}</ErrorBanner>}
      <div className="flex gap-2">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('settings.adminEmail')}
          className="flex-1 rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 text-sm"
        />
        <input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder={t('settings.initialPassword')}
          className="flex-1 rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 text-sm"
        />
        <button
          type="button"
          disabled={!email.includes('@') || password.length < 8}
          onClick={() => {
            void api.createUser(email.trim(), password).then(() => {
              setEmail('');
              setPassword('');
              reload();
            });
          }}
          className="rounded bg-[var(--gds-accent,#4c8dff)] px-3 py-1 text-sm font-medium text-black disabled:opacity-40"
        >
          {t('settings.createAdmin')}
        </button>
      </div>
      <div className="divide-y divide-[var(--gds-border,#2a2a30)] rounded-lg border border-[var(--gds-border,#2a2a30)]">
        {(data?.users ?? []).map((u: UserRow) => (
          <div key={u.id} className="px-3 py-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="flex-1">{u.email}</span>
              <span className="font-mono text-[11px] opacity-50">{u.role}</span>
              {u.lastLoginAt && (
                <span className="font-mono text-[11px] opacity-40">
                  {formatRelative(u.lastLoginAt)}
                </span>
              )}
              {u.role === 'admin' && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(t('settings.deleteAdminConfirm', { email: u.email }))) {
                      void api.deleteUser(u.id).then(reload);
                    }
                  }}
                  className="text-xs text-[#ff5d5d] opacity-60 hover:opacity-100"
                >
                  {t('common.delete')}
                </button>
              )}
            </div>
            {u.role === 'admin' && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {projects.map((p) => {
                  const has = u.projects.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        const op = has
                          ? api.unassignProject(u.id, p.id)
                          : api.assignProject(u.id, p.id);
                        void op.then(reload);
                      }}
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        has
                          ? 'border-transparent bg-[var(--gds-surface-raised,#26262c)]'
                          : 'border-[var(--gds-border,#2a2a30)] opacity-50'
                      }`}
                    >
                      {p.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditTab() {
  const t = useT();
  const { data, error } = useAsyncData(() => api.listAudit(200), []);
  return (
    <div className="max-w-4xl">
      {error && <ErrorBanner>{t('settings.auditLoadFailed')}</ErrorBanner>}
      <div className="divide-y divide-[var(--gds-border,#2a2a30)] rounded-lg border border-[var(--gds-border,#2a2a30)]">
        {(data?.entries ?? []).map((e) => (
          <div key={e.id} className="flex items-center gap-3 px-3 py-1.5 font-mono text-xs">
            <span className="w-16 opacity-40">{formatRelative(e.createdAt)}</span>
            <span className="opacity-70">{e.actorEmail ?? '—'}</span>
            <span className="flex-1">{e.action}</span>
            <span className="opacity-40">{e.targetId?.slice(0, 8)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountTab() {
  const t = useT();
  const locale = useLocale();
  const setLocale = useSetLocale();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [saved, setSaved] = useState(false);

  return (
    <div className="max-w-md space-y-6">
      <div>
        <label className="mb-1 block text-xs opacity-60">{t('settings.language')}</label>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as typeof locale)}
          className="rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 text-sm"
        >
          <option value="en">English</option>
          <option value="ja">日本語</option>
          <option value="zh">简体中文</option>
        </select>
      </div>
      <div className="space-y-2">
        <label className="block text-xs opacity-60">{t('settings.changePassword')}</label>
        <input
          type="password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          placeholder={t('settings.currentPassword')}
          className="w-full rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 text-sm"
        />
        <input
          type="password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          placeholder={t('settings.newPassword')}
          className="w-full rounded border border-[var(--gds-border,#2a2a30)] bg-transparent px-2 py-1 text-sm"
        />
        <button
          type="button"
          disabled={current.length === 0 || next.length < 8}
          onClick={() => {
            void api.changePassword(current, next).then(() => {
              setCurrent('');
              setNext('');
              setSaved(true);
              setTimeout(() => setSaved(false), 2000);
            });
          }}
          className="rounded bg-[var(--gds-accent,#4c8dff)] px-3 py-1 text-sm font-medium text-black disabled:opacity-40"
        >
          {saved ? t('settings.saved') : t('settings.save')}
        </button>
      </div>
    </div>
  );
}

function NotificationsTab() {
  const t = useT();
  const [testState, setTestState] = useState<'error' | 'idle' | 'sending' | 'sent'>(
    'idle',
  );
  const smtp = useAsyncData(() => api.smtpStatus(), []);
  const prefs = useAsyncData(() => api.listNotificationPrefs(), []);
  const [local, setLocal] = useState<Record<string, NotificationPref>>({});

  const rows = (prefs.data?.prefs ?? []).map((p) => local[p.projectId] ?? p);

  const flip = (p: NotificationPref, field: 'onNewIssue' | 'onRegression') => {
    const next = { ...p, [field]: !p[field] };
    setLocal((m) => ({ ...m, [p.projectId]: next }));
    void api
      .putNotificationPref({
        projectId: next.projectId,
        onNewIssue: next.onNewIssue,
        onRegression: next.onRegression,
      })
      .catch(() => {
        // roll back on failure so the UI never lies about state
        setLocal((m) => ({ ...m, [p.projectId]: p }));
      });
  };

  return (
    <div className="max-w-2xl space-y-6">
      <section>
        <h2 className="mb-2 text-sm font-medium">{t('notify.smtpTitle')}</h2>
        {smtp.data && smtp.data.configured && (
          <div className="flex items-center gap-3 rounded-md border border-[var(--gds-border,#2a2a30)] px-3 py-2 text-sm">
            <span className="h-2 w-2 rounded-full bg-[#4cd97b]" />
            <span className="font-mono text-xs opacity-70">
              {smtp.data.host} · {smtp.data.from}
            </span>
            <button
              type="button"
              disabled={testState === 'sending'}
              onClick={() => {
                setTestState('sending');
                api.smtpTest().then(
                  () => setTestState('sent'),
                  () => setTestState('error'),
                );
              }}
              className="ml-auto rounded border border-[var(--gds-border,#2a2a30)] px-2 py-0.5 text-xs hover:bg-[var(--gds-surface-raised,#1c1c22)] disabled:opacity-40"
            >
              {testState === 'sending' ? t('notify.testSending') : t('notify.testButton')}
            </button>
          </div>
        )}
        {smtp.data && !smtp.data.configured && (
          <div className="flex items-center gap-3 rounded-md border border-[var(--gds-border,#2a2a30)] px-3 py-2 text-sm opacity-70">
            <span className="h-2 w-2 rounded-full bg-[var(--gds-border,#3a3a42)]" />
            {t('notify.smtpUnconfigured')}
          </div>
        )}
        {testState === 'sent' && (
          <p className="mt-2 text-xs text-[#4cd97b]">{t('notify.testSent')}</p>
        )}
        {testState === 'error' && (
          <p className="mt-2 text-xs text-[#ff5d5d]">{t('notify.testFailed')}</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">{t('notify.prefsTitle')}</h2>
        <p className="mb-3 text-xs opacity-60">{t('notify.prefsHint')}</p>
        {prefs.error && <ErrorBanner>{t('notify.loadFailed')}</ErrorBanner>}
        {rows.length === 0 && !prefs.loading && (
          <p className="text-sm opacity-50">{t('table.empty')}</p>
        )}
        {rows.length > 0 && (
          <div className="divide-y divide-[var(--gds-border,#2a2a30)] rounded-lg border border-[var(--gds-border,#2a2a30)]">
            {rows.map((p) => (
              <div key={p.projectId} className="flex items-center gap-4 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate font-medium">{p.projectName}</span>
                <label className="flex items-center gap-1.5 text-xs opacity-80">
                  <input
                    type="checkbox"
                    checked={p.onNewIssue}
                    onChange={() => flip(p, 'onNewIssue')}
                    className="h-3.5 w-3.5 accent-[var(--gds-accent,#4c8dff)]"
                  />
                  {t('notify.onNewIssue')}
                </label>
                <label className="flex items-center gap-1.5 text-xs opacity-80">
                  <input
                    type="checkbox"
                    checked={p.onRegression}
                    onChange={() => flip(p, 'onRegression')}
                    className="h-3.5 w-3.5 accent-[var(--gds-accent,#4c8dff)]"
                  />
                  {t('notify.onRegression')}
                </label>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

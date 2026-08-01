// Settings — the admin surface. Owner sections (projects / admins /
// tokens / audit) plus the personal section (password, language).
// Tables are fine here: the anti-data-pool rule governs observability
// data, not management screens.

import { useState } from 'react';

import { useShell } from '../App';
import {
  Button,
  ErrorBanner,
  Input,
  PageShell,
  Panel,
  PanelEmpty,
  Select,
  clsx,
  formatRelative,
} from '../components/ui';
import { useLocale, useSetLocale, useT } from '../i18n';
import {
  api,
  type NotificationPref,
  type TokenRow,
  type UserRow,
} from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

type Tab = 'account' | 'audit' | 'notifications' | 'tokens' | 'users';

export default function SettingsPage() {
  const t = useT();
  const { me } = useShell();
  const owner = me.role === 'superadmin';
  const tabs: Tab[] = owner
    ? ['tokens', 'users', 'notifications', 'audit', 'account']
    : ['tokens', 'notifications', 'account'];
  const [tab, setTab] = useState<Tab>(tabs[0] ?? 'account');

  return (
    <PageShell
      title={t('nav.settings')}
      toolbar={
        <div className="flex items-center gap-1">
          {tabs.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setTab(x)}
              className={clsx(
                'rounded px-2 py-1 text-xs transition-colors',
                tab === x
                  ? 'bg-raised font-medium text-fg'
                  : 'text-fg-subtle hover:text-fg-muted',
              )}
            >
              {t(`settings.tab.${x}`)}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'tokens' && <TokensTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'account' && <AccountTab />}
    </PageShell>
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
    <div className="max-w-2xl space-y-3">
      <div className="flex gap-2">
        {projects.length > 1 && (
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('settings.tokenName')}
          className="flex-1"
        />
        <Select
          value={scope}
          onChange={(e) => setScope(e.target.value as 'api' | 'ingest')}
        >
          <option value="ingest">ingest</option>
          <option value="api">api</option>
        </Select>
        <Button
          variant="primary"
          disabled={!projectId || name.trim().length === 0}
          onClick={() => {
            void api.createToken(projectId, name.trim(), scope).then((r) => {
              setMinted(r.token);
              setName('');
              reload();
            });
          }}
        >
          {t('settings.mintToken')}
        </Button>
      </div>
      {minted && (
        <div className="rounded-lg border border-ok/40 bg-surface p-3 text-xs">
          <p className="mb-1.5 text-fg-muted">{t('settings.tokenOnce')}</p>
          <code className="block break-all rounded bg-bg p-2 font-mono text-fg">
            {minted}
          </code>
        </div>
      )}
      <Panel title={`${t('settings.tab.tokens')} (${(data?.tokens ?? []).length})`}>
        {(data?.tokens ?? []).length === 0 ? (
          <PanelEmpty>{t('table.empty')}</PanelEmpty>
        ) : (
          <div className="divide-y divide-border/60">
            {(data?.tokens ?? []).map((tok: TokenRow) => (
              <div key={tok.id} className="flex items-center gap-3 px-3.5 py-2 text-sm">
                <span className="flex-1 text-fg">{tok.name}</span>
                <span className="rounded bg-raised px-1.5 font-mono text-[11px] text-fg-muted">
                  {tok.scope}
                </span>
                {tok.last4 && (
                  <span className="font-mono text-xs text-fg-subtle">…{tok.last4}</span>
                )}
                {tok.revokedAt ? (
                  <span className="text-xs text-fg-subtle">{t('settings.revoked')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('settings.revokeConfirm', { name: tok.name }))) {
                        void api.revokeToken(tok.id).then(reload);
                      }
                    }}
                    className="text-xs text-kind-error/70 hover:text-kind-error"
                  >
                    {t('settings.revoke')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
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
    <div className="max-w-3xl space-y-3">
      {error && <ErrorBanner>{t('settings.usersLoadFailed')}</ErrorBanner>}
      <div className="flex gap-2">
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t('settings.adminEmail')}
          className="flex-1"
        />
        <Input
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          placeholder={t('settings.initialPassword')}
          className="flex-1"
        />
        <Button
          variant="primary"
          disabled={!email.includes('@') || password.length < 8}
          onClick={() => {
            void api.createUser(email.trim(), password).then(() => {
              setEmail('');
              setPassword('');
              reload();
            });
          }}
        >
          {t('settings.createAdmin')}
        </Button>
      </div>
      <Panel title={`${t('settings.tab.users')} (${(data?.users ?? []).length})`}>
        <div className="divide-y divide-border/60">
          {(data?.users ?? []).map((u: UserRow) => (
            <div key={u.id} className="px-3.5 py-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="flex-1 text-fg">{u.email}</span>
                <span className="font-mono text-[11px] text-fg-subtle">{u.role}</span>
                {u.lastLoginAt && (
                  <span className="font-mono text-[11px] text-fg-subtle">
                    {formatRelative(u.lastLoginAt)}
                  </span>
                )}
                {u.role === 'admin' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        window.confirm(t('settings.deleteAdminConfirm', { email: u.email }))
                      ) {
                        void api.deleteUser(u.id).then(reload);
                      }
                    }}
                    className="text-xs text-kind-error/70 hover:text-kind-error"
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
              {u.role === 'admin' && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
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
                        className={clsx(
                          'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                          has
                            ? 'border-transparent bg-raised text-fg'
                            : 'border-border text-fg-subtle hover:text-fg-muted',
                        )}
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
      </Panel>
    </div>
  );
}

function AuditTab() {
  const t = useT();
  const { data, error } = useAsyncData(() => api.listAudit(200), []);
  return (
    <div className="max-w-4xl space-y-3">
      {error && <ErrorBanner>{t('settings.auditLoadFailed')}</ErrorBanner>}
      <Panel title={`${t('settings.tab.audit')} (${(data?.entries ?? []).length})`}>
        {(data?.entries ?? []).length === 0 ? (
          <PanelEmpty>{t('table.empty')}</PanelEmpty>
        ) : (
          <div className="divide-y divide-border/60">
            {(data?.entries ?? []).map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-3 px-3.5 py-1.5 font-mono text-xs"
              >
                <span className="w-16 text-fg-subtle">{formatRelative(e.createdAt)}</span>
                <span className="text-fg-muted">{e.actorEmail ?? '—'}</span>
                <span className="flex-1 text-fg">{e.action}</span>
                <span className="text-fg-subtle">{e.targetId?.slice(0, 8)}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
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
    <div className="max-w-md space-y-3">
      <Panel title={t('settings.language')}>
        <div className="p-3.5">
          <Select
            value={locale}
            onChange={(e) => setLocale(e.target.value as typeof locale)}
          >
            <option value="en">English</option>
            <option value="ja">日本語</option>
            <option value="zh">简体中文</option>
          </Select>
        </div>
      </Panel>
      <Panel title={t('settings.changePassword')}>
        <div className="space-y-2 p-3.5">
          <Input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            placeholder={t('settings.currentPassword')}
          />
          <Input
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            placeholder={t('settings.newPassword')}
          />
          <Button
            variant="primary"
            disabled={current.length === 0 || next.length < 8}
            onClick={() => {
              void api.changePassword(current, next).then(() => {
                setCurrent('');
                setNext('');
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
              });
            }}
          >
            {saved ? t('settings.saved') : t('settings.save')}
          </Button>
        </div>
      </Panel>
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
    <div className="max-w-2xl space-y-3">
      <Panel title={t('notify.smtpTitle')}>
        <div className="p-3.5">
          {smtp.data && smtp.data.configured && (
            <div className="flex items-center gap-3 text-sm">
              <span className="h-2 w-2 rounded-full bg-ok" />
              <span className="font-mono text-xs text-fg-muted">
                {smtp.data.host} · {smtp.data.from}
              </span>
              <Button
                size="sm"
                disabled={testState === 'sending'}
                onClick={() => {
                  setTestState('sending');
                  api.smtpTest().then(
                    () => setTestState('sent'),
                    () => setTestState('error'),
                  );
                }}
              >
                {testState === 'sending' ? t('notify.testSending') : t('notify.testButton')}
              </Button>
            </div>
          )}
          {smtp.data && !smtp.data.configured && (
            <div className="flex items-center gap-3 text-sm text-fg-muted">
              <span className="h-2 w-2 rounded-full bg-border-strong" />
              {t('notify.smtpUnconfigured')}
            </div>
          )}
          {testState === 'sent' && (
            <p className="mt-2 text-xs text-ok">{t('notify.testSent')}</p>
          )}
          {testState === 'error' && (
            <p className="mt-2 text-xs text-kind-error">{t('notify.testFailed')}</p>
          )}
        </div>
      </Panel>

      <Panel title={t('notify.prefsTitle')}>
        {prefs.error && (
          <div className="p-3.5">
            <ErrorBanner>{t('notify.loadFailed')}</ErrorBanner>
          </div>
        )}
        {rows.length === 0 && !prefs.loading && !prefs.error && (
          <PanelEmpty>{t('table.empty')}</PanelEmpty>
        )}
        {rows.length > 0 && (
          <>
            <p className="px-3.5 pt-2.5 text-xs text-fg-subtle">{t('notify.prefsHint')}</p>
            <div className="mt-1 divide-y divide-border/60">
              {rows.map((p) => (
                <div
                  key={p.projectId}
                  className="flex items-center gap-4 px-3.5 py-2 text-sm"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-fg">
                    {p.projectName}
                  </span>
                  <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <input
                      type="checkbox"
                      checked={p.onNewIssue}
                      onChange={() => flip(p, 'onNewIssue')}
                      className="h-3.5 w-3.5 accent-accent"
                    />
                    {t('notify.onNewIssue')}
                  </label>
                  <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                    <input
                      type="checkbox"
                      checked={p.onRegression}
                      onChange={() => flip(p, 'onRegression')}
                      className="h-3.5 w-3.5 accent-accent"
                    />
                    {t('notify.onRegression')}
                  </label>
                </div>
              ))}
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

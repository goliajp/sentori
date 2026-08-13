// Settings — the admin surface. Owner sections (projects / admins /
// tokens / audit) plus the personal section (password, language).
// Jira posture throughout: visible labels on every control, real
// tables with headers for every list, full width put to work.

import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { useShell } from '../App';
import {
  Button,
  DataTable,
  ErrorBanner,
  Field,
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
  type AuditRow,
  type NotificationPref,
  type TokenRow,
  type UserRow,
} from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

type Tab = 'account' | 'audit' | 'notifications' | 'push' | 'tokens' | 'users';

export default function SettingsPage() {
  const t = useT();
  const { me } = useShell();
  const owner = me.role === 'superadmin';
  const tabs: Tab[] = owner
    ? ['tokens', 'users', 'push', 'notifications', 'audit', 'account']
    : ['tokens', 'push', 'notifications', 'account'];
  // The tab lives in the URL, not in component state: a settings
  // section you cannot link to is a section nobody can point a
  // colleague at, and it is also one no screenshot sweep can reach.
  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as null | Tab;
  const tab: Tab = asked && tabs.includes(asked) ? asked : tabs[0] ?? 'account';
  const setTab = (x: Tab) => setParams({ tab: x }, { replace: true });

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
      {tab === 'push' && <PushTab />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'audit' && <AuditTab />}
      {tab === 'account' && <AccountTab />}
    </PageShell>
  );
}

function TokensTab() {
  const t = useT();
  const { projects } = useShell();
  // `projects` loads async: a state initialised from projects[0] at
  // mount stays '' forever on a direct /settings load, and the list
  // never fetches. Derive the effective project instead.
  const [chosenId, setChosenId] = useState<null | string>(null);
  const projectId = chosenId ?? projects[0]?.id ?? '';
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'api' | 'ingest'>('ingest');
  const [minted, setMinted] = useState<string | null>(null);
  const { data, reload } = useAsyncData(
    () => (projectId ? api.listTokens(projectId) : Promise.resolve({ tokens: [] })),
    [projectId],
  );
  const tokens = data?.tokens ?? [];

  return (
    <div className="space-y-4">
      <Panel title={t('settings.mintToken')}>
        {/* items-end so the button shares the controls' baseline */}
        <div className="flex flex-wrap items-end gap-3 p-3.5">
          {projects.length > 1 && (
            <Field label={t('settings.fieldProject')}>
              <Select value={projectId} onChange={(e) => setChosenId(e.target.value)}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t('settings.tokenName')} className="w-64">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label={t('settings.fieldScope')}>
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'api' | 'ingest')}
            >
              <option value="ingest">ingest</option>
              <option value="api">api</option>
            </Select>
          </Field>
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
          <div className="border-t border-border p-3.5 text-xs">
            <p className="mb-1.5 text-fg-muted">{t('settings.tokenOnce')}</p>
            <code className="block break-all rounded bg-bg p-2 font-mono text-fg">
              {minted}
            </code>
          </div>
        )}
      </Panel>

      <Panel title={`${t('settings.tab.tokens')} (${tokens.length})`}>
        <DataTable<TokenRow>
          rows={tokens}
          rowKey={(r) => r.id}
          columns={[
            { key: 'name', label: t('settings.tokenName') },
            {
              key: 'scope',
              label: t('settings.fieldScope'),
              width: '110px',
              render: (r) => (
                <span className="rounded bg-raised px-1.5 font-mono text-xs text-fg-muted">
                  {r.scope}
                </span>
              ),
            },
            {
              key: 'last4',
              label: t('settings.colToken'),
              width: '110px',
              render: (r) =>
                r.last4 ? (
                  <span className="font-mono text-xs text-fg-subtle">…{r.last4}</span>
                ) : (
                  '—'
                ),
            },
            {
              key: 'createdAt',
              label: t('settings.colCreated'),
              width: '120px',
              align: 'right',
              render: (r) => (
                <span className="text-xs tabular-nums text-fg-subtle">
                  {formatRelative(r.createdAt)}
                </span>
              ),
            },
            {
              key: 'actions',
              label: '',
              width: '90px',
              align: 'right',
              render: (r) =>
                r.revokedAt ? (
                  <span className="text-xs text-fg-subtle">{t('settings.revoked')}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(t('settings.revokeConfirm', { name: r.name }))) {
                        void api.revokeToken(r.id).then(reload);
                      }
                    }}
                    className="text-xs text-kind-error/70 hover:text-kind-error"
                  >
                    {t('settings.revoke')}
                  </button>
                ),
            },
          ]}
        />
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
  const users = data?.users ?? [];

  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{t('settings.usersLoadFailed')}</ErrorBanner>}
      <Panel title={t('settings.createAdmin')}>
        <div className="flex flex-wrap items-end gap-3 p-3.5">
          <Field label={t('settings.adminEmail')} className="w-72">
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          {/* no hint line here: in an items-end inline form a hint
              would push the neighbouring button off the baseline */}
          <Field label={t('settings.initialPassword')} className="w-64">
            <Input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
            />
          </Field>
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
      </Panel>

      <Panel title={`${t('settings.tab.users')} (${users.length})`}>
        <div className="divide-y divide-border/60">
          {/* header row — the assignment chips give each row a second
              line, so this stays a disciplined flex list rather than
              a <table>; the columns still line up via fixed widths */}
          <div className="flex items-center gap-3 bg-bg/50 px-4 py-2 text-xs font-medium text-fg-muted">
            <span className="flex-1">{t('settings.adminEmail')}</span>
            <span className="w-24">{t('settings.colRole')}</span>
            <span className="w-24 text-right">{t('settings.colLastLogin')}</span>
            <span className="w-14" />
          </div>
          {users.map((u: UserRow) => (
            <div key={u.id} className="px-4 py-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="flex-1 text-fg">{u.email}</span>
                <span className="w-24 text-xs text-fg-subtle">
                  {u.role}
                </span>
                <span className="w-24 text-right text-xs tabular-nums text-fg-subtle">
                  {u.lastLoginAt ? formatRelative(u.lastLoginAt) : '—'}
                </span>
                <span className="w-14 text-right">
                  {u.role === 'admin' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            t('settings.deleteAdminConfirm', { email: u.email }),
                          )
                        ) {
                          void api.deleteUser(u.id).then(reload);
                        }
                      }}
                      className="text-xs text-kind-error/70 hover:text-kind-error"
                    >
                      {t('common.delete')}
                    </button>
                  )}
                </span>
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
                          'rounded-full border px-2 py-0.5 text-xs transition-colors',
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
  const entries = data?.entries ?? [];
  return (
    <div className="space-y-4">
      {error && <ErrorBanner>{t('settings.auditLoadFailed')}</ErrorBanner>}
      <Panel title={`${t('settings.tab.audit')} (${entries.length})`}>
        <DataTable<AuditRow>
          rows={entries}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'createdAt',
              label: t('settings.colWhen'),
              width: '110px',
              render: (r) => (
                <span className="text-xs tabular-nums text-fg-subtle">
                  {formatRelative(r.createdAt)}
                </span>
              ),
            },
            {
              key: 'actorEmail',
              label: t('settings.colActor'),
              width: '240px',
              render: (r) => (
                <span className="text-fg-muted">{r.actorEmail ?? '—'}</span>
              ),
            },
            {
              key: 'action',
              label: t('settings.colAction'),
              render: (r) => <span className="font-mono text-xs text-fg">{r.action}</span>,
            },
            {
              key: 'targetId',
              label: t('settings.colTarget'),
              width: '120px',
              align: 'right',
              render: (r) => (
                <span className="font-mono text-xs text-fg-subtle">
                  {r.targetId?.slice(0, 8) ?? '—'}
                </span>
              ),
            },
          ]}
        />
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
    <div className="grid max-w-4xl grid-cols-1 items-start gap-4 md:grid-cols-2">
      <Panel title={t('settings.changePassword')}>
        <div className="space-y-3 p-3.5">
          <Field label={t('settings.currentPassword')}>
            <Input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </Field>
          <Field label={t('settings.newPassword')}>
            <Input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </Field>
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
      <Panel title={t('settings.language')}>
        <div className="p-3.5">
          <Field label={t('settings.language')}>
            <Select
              value={locale}
              onChange={(e) => setLocale(e.target.value as typeof locale)}
            >
              <option value="en">English</option>
              <option value="ja">日本語</option>
              <option value="zh">简体中文</option>
            </Select>
          </Field>
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
    <div className="space-y-4">
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
          <p className="px-3.5 py-4 text-sm text-fg-subtle">{t('table.empty')}</p>
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

/** Push — credentials, delivery health, and the sends behind it.
 *
 *  Push has been a complete backend since v0.2 and had no dashboard
 *  at all, which is why it had no users: the only way to give Sentori
 *  an APNs key was an admin API nobody could see. This tab is the
 *  second step of a three-step integration; the other two already
 *  worked. */
function PushTab() {
  const t = useT();
  const { activeProject } = useShell();
  const projectId = activeProject?.id ?? '';
  const [busy, setBusy] = useState(false);

  const health = useAsyncData(
    () => (projectId ? api.pushHealth(projectId) : Promise.resolve(null)),
    [projectId],
  );
  const creds = useAsyncData(
    () => (projectId ? api.pushCredentials(projectId) : Promise.resolve({ credentials: [] })),
    [projectId],
  );
  const sends = useAsyncData(
    () => (projectId ? api.pushSends(projectId) : Promise.resolve({ sends: [] })),
    [projectId],
  );
  const devices = useAsyncData(
    () => (projectId ? api.pushDevices(projectId) : Promise.resolve({ devices: [] })),
    [projectId],
  );

  const [provider, setProvider] = useState('apns');
  const [config, setConfig] = useState('');
  // The secret was never collected. `config` holds non-secret
  // metadata and the worker reads the key out of `secret_blob`, so
  // every credential ever saved through this form stored an empty
  // secret — for every provider, not only FCM. The panel's own empty
  // state says to paste an APNs key or an FCM service account, and
  // there was nowhere to paste it.
  const [secret, setSecret] = useState('');
  const [saveError, setSaveError] = useState<null | string>(null);

  if (!projectId) return <PanelEmpty>{t('instruments.noProject')}</PanelEmpty>;

  const h = health.data;
  const rows = sends.data?.sends ?? [];
  const configured = creds.data?.credentials ?? [];

  const deviceRows = devices.data?.devices ?? [];

  const reload = () => {
    health.reload();
    creds.reload();
    sends.reload();
    devices.reload();
  };

  return (
    <div className="space-y-4">
      <Panel title={t('push.deliveryTitle')}>
        {!h || (h.sent24h === 0 && h.failed24h === 0 && h.queued === 0) ? (
          <PanelEmpty>{t('push.deliveryEmpty')}</PanelEmpty>
        ) : (
          <div className="space-y-2 p-3.5">
            <div className="flex items-baseline gap-6 text-sm tabular-nums">
              <span>
                <span className="text-ok">{h.sent24h}</span>{' '}
                <span className="text-fg-subtle">{t('push.sent24h')}</span>
              </span>
              <span>
                <span className={h.failed24h > 0 ? 'text-kind-error' : ''}>
                  {h.failed24h}
                </span>{' '}
                <span className="text-fg-subtle">{t('push.failed24h')}</span>
              </span>
              <span>
                {h.queued} <span className="text-fg-subtle">{t('push.queued')}</span>
              </span>
              <span className="ml-auto text-fg-subtle">
                {t('push.tokens', {
                  live: String(h.liveTokens),
                  identified: String(h.identifiedTokens),
                  quarantined: String(h.quarantinedTokens),
                })}
              </span>
            </div>
            {/* A count is an alarm; a reason is a fix. */}
            {h.reasons.length > 0 && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-fg-muted">
                {h.reasons.map((r) => (
                  <span key={r.reason} className="font-mono">
                    {r.reason} <span className="text-fg-subtle">×{r.count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </Panel>

      {/* The devices themselves. Counts on the card above answer "how
          many"; this answers "which, and what did it tell us" — the
          only way an integrator can confirm their `metadata` arrived
          without asking us, and the place a device that registered
          before `sentori.user()` shows up as not addressable. */}
      <Panel title={`${t('push.devicesTitle')} (${deviceRows.length})`}>
        <DataTable
          rows={deviceRows}
          rowKey={(d) => d.id}
          empty={t('push.devicesEmpty')}
          columns={[
            {
              key: 'device',
              label: t('push.device'),
              render: (d) => (
                <span className="font-mono text-xs">
                  {d.provider}
                  {d.env ? `/${d.env}` : ''}
                  <span className="text-fg-subtle"> ···{d.tokenTail ?? ''}</span>
                  {d.revokedAt && <span className="text-fg-subtle"> {t('push.revoked')}</span>}
                </span>
              ),
            },
            {
              key: 'addressable',
              label: t('push.addressable'),
              width: '130px',
              render: (d) =>
                d.addressable ? (
                  <span className="text-xs text-ok">{t('push.yes')}</span>
                ) : (
                  <span className="text-xs text-fg-subtle" title={t('push.notAddressableHint')}>
                    {t('push.no')}
                  </span>
                ),
            },
            {
              key: 'metadata',
              label: t('push.metadata'),
              render: (d) =>
                Object.keys(d.metadata ?? {}).length === 0 ? (
                  <span className="text-xs text-fg-subtle">{t('push.metadataNone')}</span>
                ) : (
                  <span className="font-mono text-xs text-fg-muted">
                    {JSON.stringify(d.metadata)}
                  </span>
                ),
            },
            {
              key: 'lastSeenAt',
              label: t('settings.colWhen'),
              width: '110px',
              align: 'right',
              render: (d) => (
                <span className="text-xs tabular-nums text-fg-subtle">
                  {formatRelative(d.lastSeenAt)}
                </span>
              ),
            },
          ]}
        />
      </Panel>

      <Panel title={t('push.credentialsTitle')}>
        <div className="flex flex-wrap items-end gap-3 p-3.5">
          <Field label={t('push.provider')}>
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="apns">apns</option>
              <option value="fcm">fcm</option>
              <option value="webpush">webpush</option>
            </Select>
          </Field>
          <Field label={t('push.config')} className="min-w-0 flex-1">
            <Input
              value={config}
              onChange={(e) => setConfig(e.target.value)}
              placeholder={
                provider === 'fcm' ? t('push.configOptionalFcm') : t('push.configPlaceholder')
              }
            />
          </Field>
          <Field label={t('push.secret')} className="min-w-0 flex-1">
            <Input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={
                provider === 'fcm' ? t('push.secretPlaceholderFcm') : t('push.secretPlaceholder')
              }
            />
          </Field>
          <Button
            variant="primary"
            size="sm"
            disabled={busy || secret.trim().length === 0}
            onClick={() => {
              setBusy(true);
              setSaveError(null);
              // FCM derives everything it shows from the credential
              // itself, so an empty config is the normal case there.
              let parsed: Record<string, unknown> = {};
              if (config.trim().length > 0) {
                try {
                  parsed = JSON.parse(config) as Record<string, unknown>;
                } catch {
                  setSaveError(t('push.configNotJson'));
                  setBusy(false);
                  return;
                }
              }
              void api
                .savePushCredential(projectId, provider, parsed, secret)
                .then(() => {
                  setConfig('');
                  setSecret('');
                  reload();
                })
                .catch((e: Error) => setSaveError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            {t('settings.save')}
          </Button>
        </div>
        {saveError && <ErrorBanner>{saveError}</ErrorBanner>}
        {configured.length === 0 ? (
          <PanelEmpty>{t('push.credentialsEmpty')}</PanelEmpty>
        ) : (
          <div className="divide-y divide-border/60">
            {configured.map((c) => (
              <div key={c.id} className="flex items-center gap-3 px-3.5 py-2 text-sm">
                <span className="w-24 font-mono text-xs text-fg">{c.kind}</span>
                <span className="text-xs text-fg-subtle">
                  {c.last_validate_status
                    ? t('push.lastValidated', {
                        status: c.last_validate_status,
                        when: c.last_validated_at
                          ? formatRelative(c.last_validated_at)
                          : '—',
                      })
                    : t('push.neverValidated')}
                </span>
                <button
                  type="button"
                  className="ml-auto text-xs text-fg-subtle hover:text-kind-error"
                  onClick={() => {
                    if (window.confirm(t('push.deleteConfirm', { kind: c.kind }))) {
                      void api.deletePushCredential(projectId, c.kind).then(reload);
                    }
                  }}
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title={`${t('push.sendsTitle')} (${rows.length})`}
        action={
          rows.some((r) => r.status === 'failed') ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api
                  .retryAllFailedPushSends(projectId)
                  .then(reload)
                  .finally(() => setBusy(false));
              }}
            >
              {t('push.retryAll')}
            </Button>
          ) : undefined
        }
      >
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          empty={t('push.sendsEmpty')}
          columns={[
            {
              key: 'provider',
              label: t('push.provider'),
              width: '110px',
              render: (r) => <span className="font-mono text-xs">{r.provider}</span>,
            },
            {
              key: 'status',
              label: t('instruments.colStatus'),
              width: '110px',
              render: (r) => (
                <span
                  className={clsx(
                    'font-mono text-xs',
                    r.status === 'failed' && 'text-kind-error',
                    r.status === 'sent' && 'text-ok',
                  )}
                >
                  {r.status}
                </span>
              ),
            },
            {
              key: 'error',
              label: t('push.reason'),
              render: (r) => (
                <span className="text-xs text-fg-muted">
                  {r.error ?? r.provider_outcome ?? '—'}
                </span>
              ),
            },
            {
              key: 'created_at',
              label: t('settings.colWhen'),
              width: '110px',
              align: 'right',
              render: (r) => (
                <span className="text-xs tabular-nums text-fg-subtle">
                  {formatRelative(r.created_at)}
                </span>
              ),
            },
            {
              key: 'retry',
              label: '',
              width: '70px',
              align: 'right',
              render: (r) =>
                r.status === 'failed' ? (
                  <button
                    type="button"
                    className="text-xs text-fg-subtle hover:text-fg"
                    onClick={() => {
                      void api.retryPushSend(projectId, r.id).then(reload);
                    }}
                  >
                    {t('push.retry')}
                  </button>
                ) : null,
            },
          ]}
        />
      </Panel>
    </div>
  );
}

// Push — its own module, not a settings tab.
//
// It was one: four panels stacked inside `Settings?tab=push`, which
// put "did last night's alert reach anyone" behind the same door as
// "change my password". They are not the same job. Settings is
// somewhere you go once to configure a thing; this is somewhere you
// come back to when something did not arrive, and it has its own
// nouns — devices, credentials, sends, receipts.
//
// Three sections, because the questions are three:
//   delivery    — did it go out, and if not, why
//   devices     — who can be reached, and what did they tell us
//   credentials — what we send with
//
// The section lives in the URL. A screen nobody can link to is a
// screen nobody can point a colleague at, and one no screenshot
// sweep can reach.
//
// The history is worth keeping: push was a complete backend for a
// year with no dashboard at all, which is why it had no users — the
// only way to give Sentori an APNs key was an admin API nobody could
// see. It got a settings tab, then a first real integrator, who
// found that the credential form had no field for the secret and
// that the test-send endpoint had never been wired to anything. Both
// are here now.

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
import { useT } from '../i18n';
import { api } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';

type Section = 'credentials' | 'delivery' | 'devices';
const SECTIONS: Section[] = ['delivery', 'devices', 'credentials'];

export default function PushPage() {
  const t = useT();
  const { activeProject } = useShell();
  const projectId = activeProject?.id ?? '';

  const [params, setParams] = useSearchParams();
  const asked = params.get('tab') as null | Section;
  const section: Section = asked && SECTIONS.includes(asked) ? asked : 'delivery';
  const setSection = (x: Section) => setParams({ tab: x }, { replace: true });

  return (
    <PageShell
      title={t('nav.push')}
      toolbar={
        <div className="flex items-center gap-1">
          {SECTIONS.map((x) => (
            <button
              key={x}
              type="button"
              onClick={() => setSection(x)}
              className={clsx(
                'rounded px-2 py-1 text-xs transition-colors',
                section === x
                  ? 'bg-raised font-medium text-fg'
                  : 'text-fg-subtle hover:text-fg-muted',
              )}
            >
              {t(`push.section.${x}`)}
            </button>
          ))}
        </div>
      }
    >
      {!projectId ? (
        <PanelEmpty>{t('instruments.noProject')}</PanelEmpty>
      ) : section === 'delivery' ? (
        <DeliverySection projectId={projectId} />
      ) : section === 'devices' ? (
        <DevicesSection projectId={projectId} />
      ) : (
        <CredentialsSection projectId={projectId} />
      )}
    </PageShell>
  );
}

// ── delivery ────────────────────────────────────────────────────────

function DeliverySection({ projectId }: { projectId: string }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const health = useAsyncData(() => api.pushHealth(projectId), [projectId]);
  const sends = useAsyncData(() => api.pushSends(projectId), [projectId]);
  const devices = useAsyncData(() => api.pushDevices(projectId), [projectId]);

  const h = health.data;
  const all = sends.data?.sends ?? [];
  const rows = status ? all.filter((r) => r.status === status) : all;

  const reload = () => {
    health.reload();
    sends.reload();
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
                <span className={h.failed24h > 0 ? 'text-kind-error' : ''}>{h.failed24h}</span>{' '}
                <span className="text-fg-subtle">{t('push.failed24h')}</span>
              </span>
              <span>
                {h.queued} <span className="text-fg-subtle">{t('push.queued')}</span>
              </span>
              <span className="ml-auto text-fg-subtle">
                {t('push.tokens', {
                  identified: String(h.identifiedTokens),
                  live: String(h.liveTokens),
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

      <TestSend projectId={projectId} devices={devices.data?.devices ?? []} onSent={reload} />

      <Panel
        title={`${t('push.sendsTitle')} (${rows.length})`}
        action={
          <div className="flex items-center gap-2">
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              aria-label={t('push.filterStatus')}
            >
              <option value="">{t('push.statusAny')}</option>
              <option value="sent">sent</option>
              <option value="failed">failed</option>
              <option value="queued">queued</option>
            </Select>
            {all.some((r) => r.status === 'failed') && (
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
            )}
          </div>
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
              // The provider's own words. A `queued` row carries the
              // reason its last attempt failed, which is how a send
              // that is retrying is told apart from one that is
              // merely waiting — they used to look identical.
              key: 'error',
              label: t('push.reason'),
              render: (r) => (
                <span className="text-xs text-fg-muted">{r.error ?? r.provider_outcome ?? '—'}</span>
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

/// Send one, to a device you pick, and watch what comes back.
///
/// `api.pushTest` has existed the whole time, with a comment
/// describing the UI that would ask for a device first. Nothing ever
/// called it. So the only way to answer "does push work at all" was
/// to mint an api-scope token and curl `/v1/push/send` — which is
/// exactly what our first integrator did, from a terminal, to test
/// the product's own feature.
function TestSend({
  projectId,
  devices,
  onSent,
}: {
  devices: { addressable: boolean; env: null | string; id: string; provider: string; revokedAt: null | string; tokenTail: null | string }[];
  onSent: () => void;
  projectId: string;
}) {
  const t = useT();
  const reachable = devices.filter((d) => !d.revokedAt);
  const [deviceId, setDeviceId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<null | string>(null);
  const [error, setError] = useState<null | string>(null);

  const target = deviceId || reachable[0]?.id || '';

  return (
    <Panel title={t('push.testTitle')}>
      {reachable.length === 0 ? (
        <PanelEmpty>{t('push.testNoDevice')}</PanelEmpty>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 p-3.5">
            <Field label={t('push.device')}>
              <Select value={target} onChange={(e) => setDeviceId(e.target.value)}>
                {reachable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.provider}
                    {d.env ? `/${d.env}` : ''} ···{d.tokenTail ?? ''}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('push.testSubject')} className="min-w-0 flex-1">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('push.testSubjectPlaceholder')}
              />
            </Field>
            <Field label={t('push.testBody')} className="min-w-0 flex-1">
              <Input
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={t('push.testBodyPlaceholder')}
              />
            </Field>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || title.trim().length === 0}
              onClick={() => {
                setBusy(true);
                setResult(null);
                setError(null);
                void api
                  .pushTest(projectId, target, title, body)
                  .then((r) => {
                    // The server answers with an id, not an outcome:
                    // the worker has not tried yet. Saying "sent"
                    // here would be the same lie the receipts used to
                    // tell.
                    if (r.error) setError(r.error);
                    else setResult(r.sendId ?? '');
                    onSent();
                  })
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              {t('push.testSend')}
            </Button>
          </div>
          {error && <ErrorBanner>{error}</ErrorBanner>}
          {result !== null && (
            <div className="border-t border-border/60 px-3.5 py-2 text-xs text-fg-muted">
              {t('push.testQueued')}{' '}
              <span className="font-mono text-fg-subtle">{result}</span>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

// ── devices ─────────────────────────────────────────────────────────

function DevicesSection({ projectId }: { projectId: string }) {
  const t = useT();
  // Revoked rows are hidden by default and the toggle is here rather
  // than nowhere: a device that stopped receiving is exactly what
  // someone comes to this page to find, and `live` alone cannot show
  // it.
  const [scope, setScope] = useState<'all' | 'live'>('live');
  const devices = useAsyncData(() => api.pushDevices(projectId, 100, scope), [projectId, scope]);
  const rows = devices.data?.devices ?? [];

  return (
    <Panel
      title={`${t('push.devicesTitle')} (${rows.length})`}
      action={
        <Select
          value={scope}
          onChange={(e) => setScope(e.target.value as 'all' | 'live')}
          aria-label={t('push.filterScope')}
        >
          <option value="live">{t('push.scopeLive')}</option>
          <option value="all">{t('push.scopeAll')}</option>
        </Select>
      }
    >
      <DataTable
        rows={rows}
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
                <span className="font-mono text-xs text-fg-muted">{JSON.stringify(d.metadata)}</span>
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
  );
}

// ── credentials ─────────────────────────────────────────────────────

function CredentialsSection({ projectId }: { projectId: string }) {
  const t = useT();
  const creds = useAsyncData(() => api.pushCredentials(projectId), [projectId]);
  const [provider, setProvider] = useState('apns');
  const [config, setConfig] = useState('');
  // The secret was never collected. `config` holds non-secret
  // metadata and every adapter reads the key out of `secret_blob`, so
  // each credential saved through this form stored an empty secret —
  // for every provider, not only FCM. The panel's own empty state
  // said to paste an APNs key or an FCM service account, and there
  // was nowhere to paste it.
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<null | string>(null);

  const configured = creds.data?.credentials ?? [];

  return (
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
                creds.reload();
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
                      when: c.last_validated_at ? formatRelative(c.last_validated_at) : '—',
                    })
                  : t('push.neverValidated')}
              </span>
              <button
                type="button"
                className="ml-auto text-xs text-fg-subtle hover:text-kind-error"
                onClick={() => {
                  if (window.confirm(t('push.deleteConfirm', { kind: c.kind }))) {
                    void api.deletePushCredential(projectId, c.kind).then(creds.reload);
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
  );
}

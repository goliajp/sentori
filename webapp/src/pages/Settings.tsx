import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { api, UsageResponse } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';
import { Preferences } from '../components/Preferences';
import { Card, PageHeader, Section, Badge } from '../components/ui';

export function SettingsPage() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const navigate = useNavigate();
  const email =
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('sentori_email')
      : null;
  useEffect(() => {
    api.usage().then(setUsage).catch(() => {});
  }, []);

  async function logout() {
    // Cookie is HttpOnly; the server clears it via Set-Cookie
    // Max-Age=0 in its response. We just hit the endpoint and
    // tidy up the UI-display localStorage entries.
    try {
      await fetch('/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // Best-effort: local state is cleared below regardless.
    }
    localStorage.removeItem('sentori_user_id');
    localStorage.removeItem('sentori_email');
    navigate('/login');
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Workspace + plan + integrations + members."
      />

      {email && (
        <Section title="Account">
          <Card>
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-xs text-fg-subtle">Signed in as</p>
                <p className="font-mono text-sm">{email}</p>
              </div>
              <button
                onClick={logout}
                className="rounded border border-danger/40 px-3 py-1.5 text-sm text-danger hover:bg-danger/20 hover:text-white"
              >
                Sign out
              </button>
            </div>
          </Card>
        </Section>
      )}

      <Section title="Preferences">
        <Card>
          <Preferences />
        </Card>
      </Section>

      <Section title="Plan">
        <Card>
          <div className="grid grid-cols-3 divide-x divide-border">
            <Cell label="Tier">
              {usage ? (
                <Badge tone={usage.plan === 'free' ? 'neutral' : 'info'}>
                  {usage.plan}
                </Badge>
              ) : (
                '—'
              )}
            </Cell>
            <Cell label="Status">
              {usage ? (
                <Badge tone={usage.status === 'active' ? 'ok' : 'warn'}>
                  {usage.status}
                </Badge>
              ) : (
                '—'
              )}
            </Cell>
            <Cell label="Period">
              <span className="font-mono text-sm">
                {usage?.period_yyyymm ?? '—'}
              </span>
            </Cell>
          </div>
          <div className="flex items-center justify-between border-t border-border px-5 py-4">
            <p className="text-sm text-fg-subtle">
              Usage, upgrades, invoices, and cancellation.
            </p>
            <button
              onClick={() => navigate('/settings/billing')}
              className="inline-flex h-8 items-center rounded border border-border-strong px-3 text-sm hover:bg-raised"
            >
              Manage billing →
            </button>
          </div>
        </Card>
      </Section>

      <Section title="Members">
        <Card>
          <div className="p-6 text-sm text-fg-subtle">
            Member management UI lands in v0.1.x. Backend ready (K1
            workspace_members + K16 tenant-scoping ACL gate). Use the
            <code className="mx-1 rounded bg-raised px-1 py-0.5 text-xs">
              sentorictl
            </code>
            CLI for now.
          </div>
        </Card>
      </Section>

      <Section title="Integrations">
        <Card>
          <div className="p-6 text-sm text-fg-subtle">
            K12 IntegrationAdapter trait shipped with Slack reference impl.
            UI for connect/disconnect lands as K12.1-K12.4 vendor adapters
            roll out (Linear / Jira / GitHub / GitLab).
          </div>
        </Card>
      </Section>

      <Section title="Notifier transports">
        <Card>
          <div className="p-6 text-sm text-fg-subtle">
            K11 NotifierService is operator-configured via env at boot
            (SMTP host / port / auth). Webhook + Mock transports always
            available. delivery_log persistence visible via the audit
            log when admin actions trigger fan-out.
          </div>
        </Card>
      </Section>

      <Section title="Active sessions">
        <Card>
          <div className="px-5 py-4 flex items-center justify-between">
            <p className="text-sm text-fg-muted">
              Detailed list, IP+UA per session, revoke individual entries.
            </p>
            <button
              onClick={() => navigate('/sessions')}
              className="inline-flex h-8 items-center rounded border border-border-strong px-3 text-sm hover:bg-raised"
            >
              Open Sessions →
            </button>
          </div>
        </Card>
        <SessionsCard />
      </Section>

      <Section title="API ingest">
        <Card>
          <div className="p-6 text-sm text-fg-muted">
            <p className="mb-2">
              Send events to:{' '}
              <code className="rounded bg-raised px-1 py-0.5 text-xs">
                POST /v1/events/&lt;project_id&gt;
              </code>
            </p>
            <p className="text-sm text-fg-subtle">
              Per-project token auth lands with K2 token middleware in
              v0.1.x. Until then, restrict access to the ingest port at the
              network layer (firewall / k8s NetworkPolicy / Caddy
              allowlist).
            </p>
          </div>
        </Card>
      </Section>
    </div>
  );
}

function Cell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-5 py-4">
      <p className="mb-1 text-xs uppercase tracking-wide text-fg-subtle">
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
}

function SessionsCard() {
  const { data, loading, reload: refresh } = useAsyncData<
    {
      id_hash_hex: string;
      created_at: string;
      last_used_at: string | null;
      expires_at: string;
      ip: string | null;
      user_agent: string | null;
    }[]
  >(async () => (await api.listSessions()).sessions, []);
  const rows = data ?? [];

  async function revoke(id: string) {
    if (!confirm('Revoke this session?')) return;
    await api.revokeSession(id);
    refresh();
  }

  return (
    <Card>
      <div className="px-5 py-4 text-sm">
        {loading ? (
          <p className="text-fg-subtle text-xs">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-fg-subtle text-xs">No active sessions.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map(s => (
              <li
                key={s.id_hash_hex}
                className="flex items-center justify-between py-2"
              >
                <div>
                  <p className="font-mono text-xs text-fg-muted">
                    {s.id_hash_hex.slice(0, 12)}…
                  </p>
                  <p className="text-xs text-fg-subtle">
                    {s.ip ?? '?'} · {s.user_agent?.slice(0, 40) ?? '?'}
                  </p>
                  <p className="text-xs text-fg-subtle">
                    expires {s.expires_at}
                  </p>
                </div>
                <button
                  onClick={() => revoke(s.id_hash_hex)}
                  className="rounded border border-danger/40 px-2 py-1 text-xs text-danger hover:bg-danger/20"
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

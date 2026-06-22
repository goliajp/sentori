import { useEffect, useState } from 'react';
import { api, UsageResponse } from '../lib/api';
import { Card, PageHeader, Section, Badge } from '../components/ui';

export function SettingsPage() {
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  useEffect(() => {
    api.usage().then(setUsage).catch(() => {});
  }, []);

  return (
    <div className="p-8">
      <PageHeader
        title="Settings"
        subtitle="Workspace + plan + integrations + members."
      />

      <Section title="Plan">
        <Card>
          <div className="grid grid-cols-3 divide-x divide-zinc-800">
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
        </Card>
      </Section>

      <Section title="Members">
        <Card>
          <div className="p-6 text-sm text-zinc-500">
            Member management UI lands in v0.1.x. Backend ready (K1
            workspace_members + K16 tenant-scoping ACL gate). Use the
            <code className="mx-1 rounded bg-zinc-800 px-1 py-0.5 text-xs">
              sentorictl
            </code>
            CLI for now.
          </div>
        </Card>
      </Section>

      <Section title="Integrations">
        <Card>
          <div className="p-6 text-sm text-zinc-500">
            K12 IntegrationAdapter trait shipped with Slack reference impl.
            UI for connect/disconnect lands as K12.1-K12.4 vendor adapters
            roll out (Linear / Jira / GitHub / GitLab).
          </div>
        </Card>
      </Section>

      <Section title="Notifier transports">
        <Card>
          <div className="p-6 text-sm text-zinc-500">
            K11 NotifierService is operator-configured via env at boot
            (SMTP host / port / auth). Webhook + Mock transports always
            available. delivery_log persistence visible via the audit
            log when admin actions trigger fan-out.
          </div>
        </Card>
      </Section>

      <Section title="API ingest">
        <Card>
          <div className="p-6 text-sm text-zinc-300">
            <p className="mb-2">
              Send events to:{' '}
              <code className="rounded bg-zinc-800 px-1 py-0.5 text-xs">
                POST /v1/events/&lt;project_id&gt;
              </code>
            </p>
            <p className="text-sm text-zinc-500">
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
    <div className="p-4">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
}

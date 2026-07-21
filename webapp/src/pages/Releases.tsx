// Per-project releases — list deploys + per-release sourcemap /
// dsym / proguard artifact inventory.

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useT } from '../i18n';
import { api, ReleaseArtifact, ReleaseRow } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorBanner,
  PageHeader,
  formatNumber,
  formatRelative,
} from '../components/ui';

export default function Releases() {
  const t = useT();
  const { id: projectId } = useParams<{ id: string }>();
  const [rows, setRows] = useState<ReleaseRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [artifacts, setArtifacts] = useState<Record<string, ReleaseArtifact[]>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [sdkToken, setSdkToken] = useState('');

  async function create() {
    if (!newName.trim() || !sdkToken.trim()) return;
    try {
      await api.createDeploy(
        { name: newName.trim(), deploy_at: new Date().toISOString() },
        sdkToken.trim(),
      );
      setNewName('');
      setSdkToken('');
      setShowCreate(false);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function refresh() {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.listReleases(projectId);
      setRows(r.releases);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    refresh();
  }, [projectId]);

  async function expand(id: string) {
    if (!projectId) return;
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!artifacts[id]) {
      try {
        const r = await api.listArtifacts(projectId, id);
        setArtifacts(a => ({ ...a, [id]: r.artifacts }));
      } catch (e) {
        setError(String(e));
      }
    }
  }

  async function destroy(r: ReleaseRow) {
    if (!confirm(`Delete release "${r.name}"? Sourcemaps / dsyms CASCADE-removed.`))
      return;
    try {
      await api.deleteRelease(r.id);
      await refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  if (!projectId) {
    return <ErrorBanner>{t('common.missingProjectId')}</ErrorBanner>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('releases.title')}
        subtitle={t('releases.subtitle')}
        actions={
          <Button onClick={() => setShowCreate(!showCreate)} size="sm">
            {showCreate ? 'Cancel' : '+ Deploy marker'}
          </Button>
        }
      />

      {showCreate && (
        <Card>
          <CardHeader title={t('releases.mark')} />
          <CardBody>
            <p className="text-xs text-fg-subtle mb-2">
              Mints a release row via the public /v1/deploys endpoint.
              Requires a project SDK token (st_pk_...).
            </p>
            <input
              className="w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm"
              placeholder={t('releases.namePlaceholder')}
              value={newName}
              onChange={e => setNewName(e.target.value)}
            />
            <input
              type="password"
              className="mt-2 w-full rounded border border-border-strong bg-surface px-3 py-2 text-sm font-mono"
              placeholder={t('releases.tokenPlaceholder')}
              value={sdkToken}
              onChange={e => setSdkToken(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <Button onClick={create} size="sm">
                Mark deployed
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      <Card>
        <CardHeader title={`${t('releases.title')} (${rows.length})`} />
        <CardBody>
          {loading ? (
            <div className="py-8 text-center text-sm text-fg-subtle">Loading…</div>
          ) : rows.length === 0 ? (
            <EmptyState
              title={t('releases.empty')}
              hint={t('releases.emptyHint')}
            />
          ) : (
            <div className="space-y-2">
              {rows.map(r => (
                <div
                  key={r.id}
                  className="rounded border border-border bg-white"
                >
                  <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => expand(r.id)}
                        className="font-mono text-sm text-accent hover:underline"
                      >
                        {expanded === r.id ? '▼' : '▶'} {r.name}
                      </button>
                      {r.deploy_at && (
                        <Badge tone="ok">deployed</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-fg-subtle">
                        {formatRelative(r.created_at)}
                      </span>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => destroy(r)}
                      >{t('action.delete')}</Button>
                    </div>
                  </div>
                  {expanded === r.id && (
                    <div className="border-t border-border p-3">
                      {artifacts[r.id] ? (
                        artifacts[r.id].length === 0 ? (
                          <p className="text-xs text-fg-subtle">
                            No artifacts uploaded.
                          </p>
                        ) : (
                          <DataTable
                            columns={[
                              { key: 'kind', label: 'Kind' },
                              { key: 'name', label: 'Name' },
                              { key: 'size', label: 'Size' },
                              { key: 'hash', label: 'Hash' },
                              { key: 'when', label: 'Uploaded' },
                            ]}
                            rows={artifacts[r.id].map(a => ({
                              key: a.id,
                              kind: <Badge>{a.kind}</Badge>,
                              name: a.name,
                              size: formatNumber(a.size_bytes),
                              hash: (
                                <span className="font-mono text-xs">
                                  {a.content_hash.slice(0, 12)}…
                                </span>
                              ),
                              when: formatRelative(a.created_at),
                            }))}
                          />
                        )
                      ) : (
                        <p className="text-xs text-fg-subtle">Loading…</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

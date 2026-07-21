// Workspace members + pending invites in one page.

import { useState } from 'react';

import { api, InviteRow, MemberRow } from '../lib/api';
import { useAsyncData } from '../lib/useAsyncData';
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
  formatRelative,
} from '../components/ui';

export default function Members() {
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [invitedBy, setInvitedBy] = useState(
    typeof localStorage !== 'undefined'
      ? localStorage.getItem('sentori_user_id') ?? ''
      : '',
  );
  const [newInviteToken, setNewInviteToken] = useState<string | null>(null);

  const {
    data,
    loading,
    error,
    reload: refresh,
    setError,
  } = useAsyncData(
    async (): Promise<{ members: MemberRow[]; invites: InviteRow[] }> => {
      const [m, i] = await Promise.all([api.listMembers(), api.listInvites()]);
      return { members: m.members, invites: i.invites };
    },
    [],
    String,
  );
  const members = data?.members ?? [];
  const invites = data?.invites ?? [];

  async function setRole(uid: string, role: 'admin' | 'user') {
    try {
      await api.updateMemberRole(uid, role);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function removeMember(uid: string) {
    if (!confirm('Remove this member from the workspace?')) return;
    try {
      await api.removeMember(uid);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function mintInvite() {
    if (!inviteEmail || !invitedBy) return;
    try {
      const r = await api.mintInvite({
        email: inviteEmail,
        role: inviteRole,
        invited_by: invitedBy,
      });
      setNewInviteToken(r.token);
      setInviteEmail('');
      setShowInvite(false);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  async function revokeInvite(id: string) {
    if (!confirm('Revoke this invite?')) return;
    try {
      await api.revokeInvite(id);
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Members"
        subtitle="Workspace owner / admin / user roles + pending invites."
        actions={<Button onClick={() => setShowInvite(true)}>+ Invite</Button>}
      />
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {newInviteToken && (
        <Card>
          <CardHeader title="Invite link (copy now — shown once)" />
          <CardBody>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-raised p-3 text-xs font-mono">
              {newInviteToken}
            </pre>
            <div className="mt-2">
              <Button onClick={() => setNewInviteToken(null)}>Done</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {showInvite && (
        <Card>
          <CardHeader title="Invite member" />
          <CardBody>
            <input
              className="h-8 w-full rounded border border-border px-2.5 text-sm"
              placeholder="Email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
            />
            <select
              className="mt-2 w-full rounded border border-border px-3 py-2 text-sm"
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as 'admin' | 'user')}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
            <input
              className="mt-2 w-full rounded border border-border px-3 py-2 text-sm font-mono"
              placeholder="Inviter user_id (UUID — yours)"
              value={invitedBy}
              onChange={e => setInvitedBy(e.target.value)}
            />
            <div className="mt-2 flex gap-2">
              <Button onClick={mintInvite}>Send invite</Button>
              <Button variant="secondary" onClick={() => setShowInvite(false)}>
                Cancel
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title={`Active members (${members.length})`} />
        <CardBody>
          {loading ? (
            <div className="py-8 text-center text-sm text-fg-subtle">
              Loading…
            </div>
          ) : members.length === 0 ? (
            <EmptyState title="No members" hint="Invite teammates to start." />
          ) : (
            <DataTable
              columns={[
                { key: 'uid', label: 'User' },
                { key: 'role', label: 'Role' },
                { key: 'added', label: 'Added' },
                { key: 'actions', label: '' },
              ]}
              rows={members.map(m => ({
                key: m.user_id,
                uid: (
                  <span className="font-mono text-xs">{m.user_id}</span>
                ),
                role: (
                  <Badge tone={m.role === 'owner' ? 'ok' : 'neutral'}>
                    {m.role}
                  </Badge>
                ),
                added: formatRelative(m.added_at),
                actions:
                  m.role !== 'owner' ? (
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() =>
                          setRole(m.user_id, m.role === 'admin' ? 'user' : 'admin')
                        }
                      >
                        {m.role === 'admin' ? '→ user' : '→ admin'}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => removeMember(m.user_id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null,
              }))}
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={`Invites (${invites.length})`} />
        <CardBody>
          {invites.length === 0 ? (
            <EmptyState
              title="No invites"
              hint="Pending and historical invites land here."
            />
          ) : (
            <DataTable
              columns={[
                { key: 'email', label: 'Email' },
                { key: 'role', label: 'Role' },
                { key: 'created', label: 'Sent' },
                { key: 'status', label: 'Status' },
                { key: 'actions', label: '' },
              ]}
              rows={invites.map(i => ({
                key: i.id,
                email: i.email,
                role: <Badge>{i.role}</Badge>,
                created: formatRelative(i.created_at),
                status: i.accepted_at ? (
                  <Badge tone="ok">accepted</Badge>
                ) : new Date(i.expires_at) < new Date() ? (
                  <Badge tone="neutral">expired</Badge>
                ) : (
                  <Badge tone="neutral">pending</Badge>
                ),
                actions:
                  !i.accepted_at && new Date(i.expires_at) > new Date() ? (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => revokeInvite(i.id)}
                    >
                      Revoke
                    </Button>
                  ) : null,
              }))}
            />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

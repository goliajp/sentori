import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import { type OrgRole, orgsApi, type UsageRow } from '@/api/client'
import { useAuth } from '@/auth/state'
import { useOrg } from '@/auth/orgContext'

const ROLES: readonly OrgRole[] = ['admin', 'member']

export function OrgSettingsView() {
  const { currentOrg } = useOrg()
  const { user } = useAuth()
  const slug = currentOrg.slug
  const canManage = currentOrg.role === 'owner' || currentOrg.role === 'admin'
  const isOwner = currentOrg.role === 'owner'
  const queryClient = useQueryClient()

  const membersQuery = useQuery({
    queryFn: () => orgsApi.listMembers(slug),
    queryKey: ['members', slug],
  })
  const invitesQuery = useQuery({
    enabled: canManage,
    queryFn: () => orgsApi.listInvites(slug),
    queryKey: ['invites', slug],
  })

  const [name, setName] = useState(currentOrg.name)
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState<null | string>(null)

  const renameMutation = useMutation({
    mutationFn: () => orgsApi.patchOrg(slug, { name }),
    onError: () => setNameMsg('Save failed'),
    onSuccess: () => {
      setNameMsg('Saved')
      void queryClient.invalidateQueries({ queryKey: ['orgs'] })
    },
  })

  const onSaveName = async (e: FormEvent) => {
    e.preventDefault()
    setNameMsg(null)
    setSavingName(true)
    try {
      await renameMutation.mutateAsync()
    } finally {
      setSavingName(false)
    }
  }

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrgRole>('member')
  const [inviteMsg, setInviteMsg] = useState<null | string>(null)
  const inviteMutation = useMutation({
    mutationFn: () => orgsApi.createInvite(slug, inviteEmail.trim(), inviteRole),
    onError: (err: { body?: { error?: string } }) => {
      setInviteMsg(err.body?.error ?? 'Invite failed')
    },
    onSuccess: () => {
      setInviteEmail('')
      setInviteRole('member')
      setInviteMsg('Invite sent')
      void queryClient.invalidateQueries({ queryKey: ['invites', slug] })
    },
  })

  const onInvite = (e: FormEvent) => {
    e.preventDefault()
    setInviteMsg(null)
    inviteMutation.mutate()
  }

  const revokeInvite = useMutation({
    mutationFn: (token: string) => orgsApi.deleteInvite(slug, token),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['invites', slug] }),
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) => orgsApi.deleteMember(slug, userId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['members', slug] }),
  })

  const changeRole = useMutation({
    mutationFn: (vars: { role: OrgRole; userId: string }) =>
      orgsApi.patchMember(slug, vars.userId, vars.role),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['members', slug] }),
  })

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-6 py-8 text-[13px]">
      <header>
        <h1 className="text-fg text-lg font-semibold">Settings — {currentOrg.name}</h1>
        <p className="text-fg-muted mt-1 text-sm">
          Your role: <span className="text-fg font-mono uppercase">{currentOrg.role}</span>
        </p>
      </header>

      <UsageSection slug={slug} />

      <section className="space-y-3">
        <h2 className="text-fg-muted text-[11px] tracking-wider uppercase">Org details</h2>
        <form className="flex items-center gap-2" onSubmit={onSaveName}>
          <input
            className="border-border bg-bg-tertiary text-fg focus:ring-accent rounded-md border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
            disabled={!canManage}
            onChange={(e) => setName(e.target.value)}
            value={name}
          />
          {canManage && (
            <button
              className="bg-accent text-bg rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={savingName || name === currentOrg.name || !name.trim()}
              type="submit"
            >
              {savingName ? 'Saving…' : 'Save'}
            </button>
          )}
          {nameMsg && <span className="text-fg-muted text-xs">{nameMsg}</span>}
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="text-fg-muted text-[11px] tracking-wider uppercase">Members</h2>
        {membersQuery.isLoading && <p className="text-fg-muted">Loading…</p>}
        {membersQuery.data && (
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-fg-muted border-border h-7 border-b text-left text-[11px] tracking-wider uppercase">
                <th className="px-2 font-medium">Email</th>
                <th className="w-32 px-2 font-medium">Role</th>
                <th className="w-32 px-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {membersQuery.data.map((m) => {
                const isSelf = user?.id === m.userId
                return (
                  <tr className="border-border/40 h-9 border-b" key={m.userId}>
                    <td className="text-fg px-2 font-mono">{m.email}</td>
                    <td className="px-2">
                      {isOwner && !isSelf ? (
                        <select
                          className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-0.5 text-xs"
                          onChange={(e) =>
                            changeRole.mutate({
                              role: e.target.value as OrgRole,
                              userId: m.userId,
                            })
                          }
                          value={m.role}
                        >
                          <option value="owner">owner</option>
                          <option value="admin">admin</option>
                          <option value="member">member</option>
                        </select>
                      ) : (
                        <span className="text-fg-muted font-mono uppercase">{m.role}</span>
                      )}
                    </td>
                    <td className="px-2 text-right">
                      {(canManage || isSelf) && m.role !== 'owner' && (
                        <button
                          className="text-fg-muted hover:text-fg text-xs"
                          onClick={() => {
                            if (confirm(isSelf ? 'Leave this org?' : `Remove ${m.email}?`)) {
                              removeMember.mutate(m.userId)
                            }
                          }}
                          type="button"
                        >
                          {isSelf ? 'Leave' : 'Remove'}
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>

      {canManage && (
        <section className="space-y-3">
          <h2 className="text-fg-muted text-[11px] tracking-wider uppercase">Invite a member</h2>
          <form className="flex items-center gap-2" onSubmit={onInvite}>
            <input
              className="border-border bg-bg-tertiary text-fg focus:ring-accent flex-1 rounded-md border px-3 py-1.5 text-sm focus:ring-1 focus:outline-none"
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email@example.com"
              required
              type="email"
              value={inviteEmail}
            />
            <select
              className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1.5 text-sm"
              onChange={(e) => setInviteRole(e.target.value as OrgRole)}
              value={inviteRole}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              className="bg-accent text-bg rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={inviteMutation.isPending || !inviteEmail.trim()}
              type="submit"
            >
              {inviteMutation.isPending ? 'Sending…' : 'Invite'}
            </button>
          </form>
          {inviteMsg && <p className="text-fg-muted text-xs">{inviteMsg}</p>}

          {invitesQuery.data && invitesQuery.data.length > 0 && (
            <table className="mt-4 w-full border-collapse">
              <thead>
                <tr className="text-fg-muted border-border h-7 border-b text-left text-[11px] tracking-wider uppercase">
                  <th className="px-2 font-medium">Pending invite</th>
                  <th className="w-24 px-2 font-medium">Role</th>
                  <th className="w-24 px-2 font-medium">Expires</th>
                  <th className="w-20 px-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {invitesQuery.data.map((inv) => (
                  <tr className="border-border/40 h-9 border-b" key={inv.token}>
                    <td className="text-fg px-2 font-mono">{inv.email}</td>
                    <td className="text-fg-muted px-2 font-mono uppercase">{inv.role}</td>
                    <td className="text-fg-muted px-2 font-mono text-[11px] tabular-nums">
                      {new Date(inv.expiresAt).toISOString().slice(0, 10)}
                    </td>
                    <td className="px-2 text-right">
                      <button
                        className="text-fg-muted hover:text-fg text-xs"
                        onClick={() => revokeInvite.mutate(inv.token)}
                        type="button"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}

function UsageSection({ slug }: { slug: string }) {
  const { data, isLoading } = useQuery({
    queryFn: () => orgsApi.usage(slug),
    queryKey: ['usage', slug],
    refetchInterval: 60_000,
  })

  return (
    <section className="space-y-3">
      <h2 className="text-fg-muted text-[11px] tracking-wider uppercase">Usage this month</h2>
      {isLoading && <p className="text-fg-muted">Loading…</p>}
      {data && <UsageWidget usage={data} />}
    </section>
  )
}

function UsageWidget({ usage }: { usage: UsageRow }) {
  const pct = Math.min(100, usage.percentUsed)
  const tone =
    usage.percentUsed >= 100 ? 'bg-red-500' : usage.percentUsed >= 80 ? 'bg-amber-500' : 'bg-accent'
  const reset = new Date(usage.resetAt).toISOString().slice(0, 10)
  return (
    <div className="space-y-2">
      <div className="text-fg-muted flex items-baseline justify-between text-[12px]">
        <span>
          <span className="text-fg font-mono">{usage.eventCount.toLocaleString()}</span> /{' '}
          {usage.eventLimitMonthly.toLocaleString()} events
        </span>
        <span className="font-mono">
          {usage.plan} · resets {reset}
        </span>
      </div>
      <div className="border-border bg-bg-tertiary h-2 overflow-hidden rounded-full border">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {usage.droppedCount > 0 && (
        <p className="text-fg-muted text-[11px]">
          {usage.droppedCount.toLocaleString()} events dropped this period.
        </p>
      )}
    </div>
  )
}

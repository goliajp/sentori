import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { type FormEvent, useState } from 'react'

import {
  type OrgRole,
  orgsApi,
  teamsApi,
  type TeamRow,
  transfersApi,
  type UsageRow,
} from '@/api/client'
import { useAuth } from '@/auth/state'
import { useOrg } from '@/auth/orgContext'
import { useHasPermission } from '@/auth/useHasPermission'
import { RoleBadge } from '@/components/RoleBadge'
import { densityClasses, useDensity } from '@/lib/density'

const ROLES: readonly OrgRole[] = ['admin', 'member', 'viewer']

export function OrgSettingsView() {
  const { currentOrg } = useOrg()
  const dCls = densityClasses(useDensity().density)
  const { user } = useAuth()
  const slug = currentOrg.slug
  const canManage = useHasPermission('org.manage')
  const isOwner = currentOrg.role === 'owner'
  const queryClient = useQueryClient()

  const membersQuery = useQuery({
    queryFn: () => orgsApi.listMembers(slug),
    queryKey: ['members', slug],
  })
  const teamsQuery = useQuery({
    queryFn: () => teamsApi.list(slug),
    queryKey: ['teams', slug],
  })

  // Build a userId → teams map by fetching each team's members in parallel.
  // O(N teams) requests; fine for the 1–10 teams the dashboard typically
  // sees. Move to a server-side join if N grows past ~50.
  const teamMembersQueries = useQueries({
    queries: (teamsQuery.data ?? []).map((t) => ({
      queryFn: () => teamsApi.listMembers(slug, t.slug),
      queryKey: ['team-members', slug, t.slug] as const,
    })),
  })
  const userTeams = new Map<string, TeamRow[]>()
  ;(teamsQuery.data ?? []).forEach((t, i) => {
    const members = teamMembersQueries[i]?.data
    if (!members) return
    for (const m of members) {
      const list = userTeams.get(m.userId) ?? []
      list.push(t)
      userTeams.set(m.userId, list)
    }
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
  const [inviteTeamSlug, setInviteTeamSlug] = useState<string>('')
  const [inviteMsg, setInviteMsg] = useState<null | string>(null)
  const inviteMutation = useMutation({
    mutationFn: () =>
      orgsApi.createInvite(slug, inviteEmail.trim(), inviteRole, inviteTeamSlug || null),
    onError: (err: { body?: { error?: string } }) => {
      setInviteMsg(err.body?.error ?? 'Invite failed')
    },
    onSuccess: () => {
      setInviteEmail('')
      setInviteRole('member')
      setInviteTeamSlug('')
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
    <div className="space-y-10 px-6 py-8 text-[13px]">
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
                const teamsForUser = userTeams.get(m.userId) ?? []
                return (
                  <tr className={`border-border/40 border-b ${dCls.rowClass}`} key={m.userId}>
                    <td className="text-fg px-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{m.email}</span>
                        {teamsForUser.map((t) => (
                          <span
                            className="border-border bg-bg-tertiary text-fg-muted rounded border px-1.5 py-0.5 text-[10px] font-medium"
                            key={t.id}
                            title={t.name}
                          >
                            {t.slug}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-2">
                      {isOwner && !isSelf && m.role !== 'owner' ? (
                        <select
                          className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-0.5 text-xs"
                          onChange={(e) => {
                            const next = e.target.value as OrgRole
                            if (next === m.role) return
                            // Owner is reachable only via the ownership-
                            // transfer flow; anything else is an inline
                            // confirm because the action is reversible
                            // and reversing it just means another swap.
                            const ok = confirm(`Change ${m.email} from ${m.role} to ${next}?`)
                            if (!ok) {
                              // React doesn't let us actually undo the
                              // <select> selection, but the mutation is
                              // skipped — re-rendering on the next role
                              // refetch will snap it back.
                              return
                            }
                            changeRole.mutate({ role: next, userId: m.userId })
                          }}
                          value={m.role}
                        >
                          <option value="admin">admin</option>
                          <option value="member">member</option>
                          <option value="viewer">viewer</option>
                        </select>
                      ) : (
                        <RoleBadge role={m.role} />
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
            {teamsQuery.data && teamsQuery.data.length > 0 && (
              <select
                className="border-border bg-bg-tertiary text-fg rounded-md border px-2 py-1.5 text-sm"
                onChange={(e) => setInviteTeamSlug(e.target.value)}
                title="Add to team on accept (optional)"
                value={inviteTeamSlug}
              >
                <option value="">No team</option>
                {teamsQuery.data.map((t) => (
                  <option key={t.id} value={t.slug}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className="bg-accent text-bg rounded-md px-3 py-1.5 text-sm disabled:opacity-50"
              disabled={inviteMutation.isPending || !inviteEmail.trim()}
              type="submit"
            >
              {inviteMutation.isPending ? 'Sending…' : 'Invite'}
            </button>
          </form>
          {inviteMsg && <p className="text-fg-muted text-xs">{inviteMsg}</p>}

          {invitesQuery.data && invitesQuery.data.length > 0 ? (
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
                  <tr className={`border-border/40 border-b ${dCls.rowClass}`} key={inv.token}>
                    <td className="text-fg px-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono">{inv.email}</span>
                        {inv.teamSlug && (
                          <span
                            className="border-border bg-bg-tertiary text-fg-muted rounded border px-1.5 py-0.5 text-[10px] font-medium"
                            title={`Will join team ${inv.teamSlug}`}
                          >
                            {inv.teamSlug}
                          </span>
                        )}
                      </div>
                    </td>
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
          ) : null}
        </section>
      )}

      {isOwner && <TransferOwnershipSection />}
    </div>
  )
}

function TransferOwnershipSection() {
  const { currentOrg } = useOrg()
  const { user } = useAuth()
  const slug = currentOrg.slug
  const queryClient = useQueryClient()

  const membersQuery = useQuery({
    queryFn: () => orgsApi.listMembers(slug),
    queryKey: ['members', slug],
  })

  const eligible = (membersQuery.data ?? []).filter(
    (m) => m.userId !== user?.id && (m.role === 'admin' || m.role === 'owner')
  )

  const [target, setTarget] = useState('')
  const [confirmSlug, setConfirmSlug] = useState('')
  const [msg, setMsg] = useState<null | string>(null)

  const transfer = useMutation({
    mutationFn: () => transfersApi.create(slug, target),
    onError: (err: { body?: { error?: string } }) => {
      setMsg(err.body?.error ?? 'Transfer failed')
    },
    onSuccess: () => {
      setTarget('')
      setConfirmSlug('')
      setMsg('Transfer initiated — recipient will receive an email.')
      void queryClient.invalidateQueries({ queryKey: ['audit', slug] })
    },
  })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    setMsg(null)
    transfer.mutate()
  }

  const ready = !!target && confirmSlug.trim() === slug

  return (
    <section className="border-danger/30 space-y-3 rounded-lg border border-dashed p-4">
      <header>
        <h2 className="text-fg-muted text-[11px] tracking-wider uppercase">Transfer ownership</h2>
        <p className="text-fg-muted mt-1 text-xs">
          Hand this org over to another admin. Your role drops to admin; the recipient must confirm
          via the email link before anything changes.
        </p>
      </header>
      {eligible.length === 0 ? (
        <p className="text-fg-muted text-xs">
          Promote a member to admin first — only admins are eligible to receive ownership.
        </p>
      ) : (
        <form className="space-y-3" onSubmit={onSubmit}>
          <select
            className="border-border bg-bg-tertiary text-fg w-full rounded-md border px-3 py-1.5 text-sm"
            onChange={(e) => setTarget(e.target.value)}
            required
            value={target}
          >
            <option value="">Pick the new owner…</option>
            {eligible.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.email} ({m.role})
              </option>
            ))}
          </select>
          <input
            autoComplete="off"
            className="border-border bg-bg-tertiary text-fg w-full rounded-md border px-3 py-1.5 text-sm"
            onChange={(e) => setConfirmSlug(e.target.value)}
            placeholder={`Type "${slug}" to confirm`}
            value={confirmSlug}
          />
          <div className="flex items-center gap-3">
            <button
              className="bg-danger/90 text-bg rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              disabled={!ready || transfer.isPending}
              type="submit"
            >
              {transfer.isPending ? 'Sending…' : 'Initiate transfer'}
            </button>
            {msg && <span className="text-fg-muted text-xs">{msg}</span>}
          </div>
        </form>
      )}
    </section>
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

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { type FederationRow, orgsApi } from '@/api/client'
import { ModuleEmpty } from '@/components/Hint'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'

/**
 * Posture > Federation explorer — v1.1 chunk S4 design surface.
 *
 * Operator types `(provider, subject)`; the view fetches every
 * project in the current org that linked that pair. Same Google
 * `sub` signed into 3 apps surfaces as 3 rows here. Drives:
 *   - "is this account anywhere else in our suite?"
 *   - "did this user just create a duplicate identity?"
 *   - cross-project trust-score correlation (operator follow-up)
 *
 * Privacy posture: the subject we display is the opaque OAuth
 * `sub` value the SDK shipped — never the email or display name
 * (`linkFederatedIdentity` enforces this).
 */
export function FederationView() {
  const { currentOrg } = useOrg()
  const [provider, setProvider] = useState('google')
  const [subjectDraft, setSubjectDraft] = useState('')
  const [submitted, setSubmitted] = useState<null | { provider: string; subject: string }>(null)

  if (!currentOrg) {
    return <ModuleEmpty eyebrow="federation">Pick an org first.</ModuleEmpty>
  }

  return (
    <div className="space-y-6">
      <form
        className="border-border flex flex-wrap items-baseline gap-3 border-b pb-4"
        onSubmit={(e) => {
          e.preventDefault()
          const subject = subjectDraft.trim()
          const p = provider.trim()
          if (!subject || !p) return
          setSubmitted({ provider: p, subject })
        }}
      >
        <label className="text-accent font-mono text-[11px] tracking-[0.18em] uppercase">
          provider
        </label>
        <input
          className="border-border text-fg focus:border-accent basis-[18ch] border-b bg-transparent py-1 font-mono text-[13px] focus:outline-none"
          list="federation-providers"
          onChange={(e) => setProvider(e.target.value)}
          placeholder="google"
          value={provider}
        />
        <datalist id="federation-providers">
          <option value="google" />
          <option value="apple" />
          <option value="github" />
          <option value="microsoft" />
        </datalist>

        <label className="text-accent font-mono text-[11px] tracking-[0.18em] uppercase">
          subject
        </label>
        <input
          className="border-border text-fg focus:border-accent min-w-0 flex-1 border-b bg-transparent py-1 font-mono text-[13px] focus:outline-none"
          onChange={(e) => setSubjectDraft(e.target.value)}
          placeholder="opaque OAuth sub (NOT email)"
          value={subjectDraft}
        />
        <button
          className="border-border text-fg hover:border-accent hover:text-accent border px-3 py-1 font-mono text-[11px] tracking-[0.18em] uppercase"
          type="submit"
        >
          Lookup
        </button>
      </form>

      {submitted ? (
        <ResultsTable
          orgSlug={currentOrg.slug}
          provider={submitted.provider}
          subject={submitted.subject}
        />
      ) : (
        <ModuleEmpty eyebrow="federation">
          Enter a provider + subject to see which projects in this org linked the same federated
          identity.
        </ModuleEmpty>
      )}
    </div>
  )
}

function ResultsTable({
  orgSlug,
  provider,
  subject,
}: {
  orgSlug: string
  provider: string
  subject: string
}) {
  const { data, error, isLoading } = useQuery({
    queryFn: () => orgsApi.federation(orgSlug, provider, subject),
    queryKey: qk.orgs.federation(orgSlug, provider, subject),
    refetchInterval: 60_000,
    staleTime: 55_000,
  })

  if (isLoading && !data) return <ModuleEmpty eyebrow="federation">Loading…</ModuleEmpty>
  if (error)
    return <ModuleEmpty eyebrow="federation">Lookup failed (check permissions).</ModuleEmpty>
  const rows = data ?? []
  if (rows.length === 0) {
    return (
      <ModuleEmpty eyebrow="federation">{`No project in ${orgSlug} has a link for (${provider}, ${subject}). Either the SDK hasn't called sentori.linkFederatedIdentity, or you mistyped the subject.`}</ModuleEmpty>
    )
  }

  return (
    <section>
      <header className="sec-head">
        <span className="sec-head-title">
          {rows.length} project{rows.length === 1 ? '' : 's'} linked
        </span>
        <span className="sec-head-sub font-mono">
          {provider} · {subject}
        </span>
      </header>
      <ul className="pt-3">
        {rows.map((r) => (
          <FedRow key={r.projectId} row={r} />
        ))}
      </ul>
    </section>
  )
}

function FedRow({ row }: { row: FederationRow }) {
  return (
    <li className="border-border-muted grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-baseline gap-3 border-b py-2 last:border-b-0">
      <span className="text-fg min-w-0 truncate font-mono text-[12px]">
        {row.projectName ?? row.projectId}
      </span>
      <span className="text-fg-secondary min-w-0 truncate font-mono text-[11px]">
        {row.userId ? (
          <>user&nbsp;{row.userId}</>
        ) : (
          <span className="text-fg-muted">no userId</span>
        )}
      </span>
      <span className="text-fg-secondary min-w-0 truncate font-mono text-[11px]">
        {row.installId ? (
          <>install&nbsp;{row.installId.slice(0, 12)}…</>
        ) : (
          <span className="text-fg-muted">no installId</span>
        )}
      </span>
      <span className="text-fg-muted font-mono text-[11px] tabular-nums">
        {new Date(row.createdAt).toLocaleString()}
      </span>
    </li>
  )
}

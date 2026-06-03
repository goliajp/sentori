import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'

import { type IdentityEraseResp, orgsApi } from '@/api/client'
import { useOrg } from '@/auth/orgContext'
import { hashIdentity, type IdentityKeyType } from '@/lib/identity-hash'

/**
 * v2.3 — GDPR-aligned DSR erase form.
 *
 * Privacy contract mirrors the lookup form: the operator types a raw
 * identity value (email / phone / oauth sub / username) into the
 * input; the browser hashes it via `crypto.subtle.digest` and only
 * the hash is sent. Raw value is wiped from React state the instant
 * the hash is computed.
 *
 * UX flow:
 *
 *   1. Operator picks `keyType` + types raw value.
 *   2. Form submits a **dryRun: true** call → server returns count
 *      + sample event ids. UI renders the preview.
 *   3. Operator types the literal word `erase` into the confirmation
 *      input. The "Erase N events" button stays disabled until the
 *      gate matches.
 *   4. Clicking the button submits **dryRun: false**. The server
 *      pseudonymises `payload.user` across every matching event and
 *      drops the identity_fingerprints rows. Audit log entry per
 *      call (both dry + live).
 *
 * Why two-step (preview + confirm) instead of a single submit:
 * erase is destructive and irreversible; surfacing the count and
 * sample lets the operator notice "wait, this is hitting more
 * events than I expected, did I pick the wrong keyType?" before
 * pulling the trigger.
 */

const KEY_TYPES: { description: string; label: string; value: IdentityKeyType }[] = [
  { description: 'Most common user identifier.', label: 'Email', value: 'email' },
  {
    description: 'E.164 normalised internally; passes any format.',
    label: 'Phone',
    value: 'phone',
  },
  {
    description: 'Google OAuth `sub` claim — opaque and stable.',
    label: 'Google Sub',
    value: 'googleSub',
  },
  {
    description: 'Apple sign-in `sub` claim.',
    label: 'Apple Sub',
    value: 'appleSub',
  },
  { description: 'App username, lowercase-normalised.', label: 'Username', value: 'username' },
]

const CONFIRM_PHRASE = 'erase'

export function UsersErase() {
  const { currentOrg } = useOrg()
  const [keyType, setKeyType] = useState<IdentityKeyType>('email')
  const [rawInput, setRawInput] = useState('')
  const [confirmPhrase, setConfirmPhrase] = useState('')
  const [submitError, setSubmitError] = useState<null | string>(null)
  // The hash for the most-recent preview. We hold it so the live
  // erase doesn't need to re-prompt for the raw value. Wiped after
  // a successful erase + when the operator changes the keyType.
  const [previewHash, setPreviewHash] = useState<null | string>(null)

  const previewM = useMutation<IdentityEraseResp, Error, { clientHash: string; keyType: string }>({
    mutationFn: ({ clientHash, keyType }) =>
      orgsApi.usersErase(currentOrg.slug, { clientHash, dryRun: true, keyType }),
  })

  const eraseM = useMutation<IdentityEraseResp, Error, { clientHash: string; keyType: string }>({
    mutationFn: ({ clientHash, keyType }) =>
      orgsApi.usersErase(currentOrg.slug, { clientHash, dryRun: false, keyType }),
    onSuccess: () => {
      // Erase done — clear the preview so the form returns to its
      // empty state. The operator can run another erasure without
      // having to navigate away.
      setPreviewHash(null)
      setConfirmPhrase('')
    },
  })

  const onPreview = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitError(null)
    const raw = rawInput.trim()
    if (raw === '') {
      setSubmitError('Enter an identity value to preview.')
      return
    }
    try {
      const clientHash = await hashIdentity(keyType, raw)
      setRawInput('') // privacy: wipe raw IMMEDIATELY after hash.
      setPreviewHash(clientHash)
      setConfirmPhrase('')
      previewM.mutate({ clientHash, keyType })
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Hashing failed; your browser may not support SubtleCrypto.'
      )
    }
  }

  const onConfirmErase = () => {
    if (!previewHash) return
    if (confirmPhrase !== CONFIRM_PHRASE) return
    eraseM.mutate({ clientHash: previewHash, keyType })
  }

  const onChangeKeyType = (v: IdentityKeyType) => {
    setKeyType(v)
    // Switching keyType invalidates the preview — different hash
    // input domain.
    setPreviewHash(null)
    setConfirmPhrase('')
    previewM.reset()
    eraseM.reset()
  }

  const preview = previewM.data
  const liveResult = eraseM.data
  const canErase =
    !!previewHash &&
    !!preview &&
    preview.affectedCount > 0 &&
    confirmPhrase === CONFIRM_PHRASE &&
    !eraseM.isPending

  return (
    <div>
      <form className="border-y border-[color:var(--rule)] py-4" onSubmit={onPreview}>
        <div className="grid grid-cols-[160px_1fr_auto] items-end gap-3">
          <label className="block">
            <span className="mb-1 block font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
              identity type
            </span>
            <select
              className="h-8 w-full border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[12px] text-[color:var(--ink)] focus:border-[color:var(--accent)] focus:outline-none"
              onChange={(e) => onChangeKeyType(e.target.value as IdentityKeyType)}
              value={keyType}
            >
              {KEY_TYPES.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
              value to erase (hashed before send)
            </span>
            <input
              autoComplete="off"
              className="h-8 w-full border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[12px] text-[color:var(--ink)] focus:border-[color:var(--accent)] focus:outline-none"
              onBlur={() => setRawInput('')}
              onChange={(e) => setRawInput(e.target.value)}
              placeholder={KEY_TYPES.find((k) => k.value === keyType)?.description ?? 'value'}
              type="text"
              value={rawInput}
            />
          </label>

          <button
            className="h-8 cursor-pointer border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-4 font-mono text-[10px] tracking-[0.18em] uppercase hover:bg-[color:var(--paper)] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={previewM.isPending || rawInput.trim() === ''}
            type="submit"
          >
            {previewM.isPending ? 'previewing…' : 'preview impact'}
          </button>
        </div>
        {submitError && (
          <div className="mt-2 font-mono text-[11px] text-[color:var(--danger)]">{submitError}</div>
        )}
        {previewM.error && (
          <div className="mt-2 font-mono text-[11px] text-[color:var(--danger)]">
            Preview failed: {previewM.error.message}
          </div>
        )}
      </form>

      {/* Preview result + confirmation gate. */}
      {preview && !liveResult && (
        <div className="border-b border-[color:var(--rule)] py-4">
          {preview.affectedCount === 0 ? (
            <div className="font-mono text-[12px] text-[color:var(--ink-soft)]">
              No events match this fingerprint in the org's default identity scope. Nothing to
              erase.
            </div>
          ) : (
            <>
              <div className="mb-2 font-mono text-[12px] text-[color:var(--ink)]">
                Would erase{' '}
                <span className="font-bold text-[color:var(--danger)] tabular-nums">
                  {preview.affectedCount.toLocaleString()}
                </span>{' '}
                event{preview.affectedCount === 1 ? '' : 's'} from scope{' '}
                <span className="font-mono text-[11px] text-[color:var(--ink-muted)]">
                  {preview.scopeId.slice(0, 8)}…
                </span>{' '}
                · fingerprint{' '}
                <span className="font-mono text-[11px] text-[color:var(--ink-muted)]">
                  {preview.fingerprintPrefix}…
                </span>
              </div>
              <div className="mb-3 font-mono text-[10px] tracking-[0.12em] text-[color:var(--ink-muted)] uppercase">
                sample event ids (first 10)
              </div>
              <ul className="mb-4 space-y-0.5 font-mono text-[11px] text-[color:var(--ink-soft)]">
                {preview.sampleEventIds.map((id) => (
                  <li key={id} className="tabular-nums">
                    {id}
                  </li>
                ))}
              </ul>
              <div className="border-t border-[color:var(--rule)] pt-3">
                <div className="mb-2 font-mono text-[11px] text-[color:var(--ink-soft)]">
                  Erasure is irreversible. Per-event `payload.user` is overwritten with an empty
                  object; identity_fingerprints rows for this subject are dropped. Aggregate stats
                  (event count, issue grouping) survive.
                </div>
                <div className="flex items-center gap-3">
                  <label className="block flex-1">
                    <span className="mb-1 block font-mono text-[10px] tracking-[0.18em] text-[color:var(--ink-muted)] uppercase">
                      type "{CONFIRM_PHRASE}" to confirm
                    </span>
                    <input
                      autoComplete="off"
                      className="h-8 w-full border border-[color:var(--rule)] bg-[color:var(--paper-2)] px-2 font-mono text-[12px] text-[color:var(--ink)] focus:border-[color:var(--accent)] focus:outline-none"
                      onChange={(e) => setConfirmPhrase(e.target.value)}
                      type="text"
                      value={confirmPhrase}
                    />
                  </label>
                  <button
                    className="h-8 cursor-pointer border border-[color:var(--danger)] bg-[color:var(--danger)] px-4 font-mono text-[10px] tracking-[0.18em] text-white uppercase hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!canErase}
                    onClick={onConfirmErase}
                    type="button"
                  >
                    {eraseM.isPending
                      ? 'erasing…'
                      : `erase ${preview.affectedCount.toLocaleString()} event${preview.affectedCount === 1 ? '' : 's'}`}
                  </button>
                </div>
                {eraseM.error && (
                  <div className="mt-2 font-mono text-[11px] text-[color:var(--danger)]">
                    Erase failed: {eraseM.error.message}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {liveResult && (
        <div className="border-b border-[color:var(--rule)] py-4">
          <div className="font-mono text-[12px] text-[color:var(--ink)]">
            Erased{' '}
            <span className="font-bold tabular-nums">
              {liveResult.affectedCount.toLocaleString()}
            </span>{' '}
            event{liveResult.affectedCount === 1 ? '' : 's'}. An audit log entry has been written
            (action `identity.erased`). The subject's events stay in aggregates but their
            `payload.user` fields are now empty and no further lookups can surface them.
          </div>
        </div>
      )}
    </div>
  )
}

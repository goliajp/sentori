// v2.1.3 — endpoint-check form view (covers both `new` and `edit`).
//
// Route shape:
//   /main/org/<slug>/health/new           → create mode (no :checkId)
//   /main/org/<slug>/health/:checkId/edit → edit mode (load + PUT)
//
// On success both modes navigate to the detail page so the operator
// sees the new state without a second click.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import { type EndpointCheck, type NewEndpointCheck, adminApi } from '@/api/client'
import { qk } from '@/api/query-keys'
import { useOrg } from '@/auth/orgContext'

import { FieldLabel } from './_shared'

type Mode = 'edit' | 'new'

type FormInitial = {
  name: string
  targetUrl: string
  method: 'GET' | 'HEAD' | 'POST'
  intervalSec: number
  statusCodesText: string
  maxLatencyMs: string
  bodySubstring: string
}

const BLANK_INITIAL: FormInitial = {
  bodySubstring: '',
  intervalSec: 60,
  maxLatencyMs: '',
  method: 'GET',
  name: '',
  statusCodesText: '200',
  targetUrl: 'https://',
}

function existingToInitial(c: EndpointCheck): FormInitial {
  return {
    bodySubstring: c.assertionBodySubstring ?? '',
    intervalSec: c.intervalSec,
    maxLatencyMs: c.assertionMaxLatencyMs?.toString() ?? '',
    method: (c.method as 'GET' | 'HEAD' | 'POST') ?? 'GET',
    name: c.name,
    statusCodesText: c.assertionStatusCodes.join(', '),
    targetUrl: c.targetUrl,
  }
}

/** Outer wrapper: resolves mode, loads the existing check in edit
 *  mode, and only mounts the form once initial values are known.
 *  Splitting like this keeps every `useState` seeded via its
 *  initializer (no setState-in-effect lint hit) and means edit mode
 *  can't render with stale fields between data arrivals. */
export function HealthFormView() {
  const { checkId } = useParams<{ checkId?: string }>()
  const mode: Mode = checkId ? 'edit' : 'new'
  const { currentOrg, currentProject } = useOrg()
  const projectId = currentProject?.id ?? null
  const orgSlug = currentOrg.slug

  const existingQ = useQuery({
    enabled: mode === 'edit' && !!projectId,
    queryFn: () => adminApi.getEndpointCheck(projectId!, checkId!),
    queryKey: qk.endpointChecks.detail(projectId, checkId ?? null),
  })

  if (!projectId) return null
  if (mode === 'edit' && existingQ.isLoading) {
    return (
      <div className="sentori-page-in text-fg-muted py-8 text-center text-[12px]">Loading…</div>
    )
  }
  if (mode === 'edit' && (existingQ.error || !existingQ.data)) {
    return (
      <div className="sentori-page-in text-danger py-8 text-center text-[12px]">
        Check not found.
      </div>
    )
  }

  const initial =
    mode === 'edit' && existingQ.data ? existingToInitial(existingQ.data) : BLANK_INITIAL

  return (
    <FormBody
      checkId={checkId ?? null}
      headerTitle={mode === 'edit' ? (existingQ.data?.name ?? 'Check') : 'New endpoint check'}
      initial={initial}
      mode={mode}
      orgSlug={orgSlug}
      projectId={projectId}
    />
  )
}

type FormBodyProps = {
  checkId: null | string
  headerTitle: string
  initial: FormInitial
  mode: Mode
  orgSlug: string
  projectId: string
}

function FormBody({ checkId, headerTitle, initial, mode, orgSlug, projectId }: FormBodyProps) {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [name, setName] = useState(initial.name)
  const [targetUrl, setTargetUrl] = useState(initial.targetUrl)
  const [method, setMethod] = useState<'GET' | 'HEAD' | 'POST'>(initial.method)
  const [intervalSec, setIntervalSec] = useState(initial.intervalSec)
  const [statusCodesText, setStatusCodesText] = useState(initial.statusCodesText)
  const [maxLatencyMs, setMaxLatencyMs] = useState(initial.maxLatencyMs)
  const [bodySubstring, setBodySubstring] = useState(initial.bodySubstring)

  const buildPayload = (): NewEndpointCheck => ({
    assertionBodySubstring: bodySubstring || undefined,
    assertionMaxLatencyMs: maxLatencyMs ? parseInt(maxLatencyMs, 10) : undefined,
    assertionStatusCodes: parseStatusCodes(statusCodesText),
    intervalSec,
    method,
    name,
    targetUrl,
  })

  const create = useMutation({
    mutationFn: () => adminApi.createEndpointCheck(projectId, buildPayload()),
    onSuccess: (resp) => {
      void qc.invalidateQueries({ queryKey: qk.endpointChecks.list(projectId) })
      navigate(`/main/org/${orgSlug}/health/${resp.id}`)
    },
  })

  const update = useMutation({
    mutationFn: () => adminApi.updateEndpointCheck(projectId, checkId!, buildPayload()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.endpointChecks.list(projectId) })
      void qc.invalidateQueries({
        queryKey: qk.endpointChecks.detail(projectId, checkId),
      })
      navigate(`/main/org/${orgSlug}/health/${checkId}`)
    },
  })

  const pending = create.isPending || update.isPending
  const error = create.error ?? update.error
  const backTo =
    mode === 'edit' ? `/main/org/${orgSlug}/health/${checkId}` : `/main/org/${orgSlug}/health`

  return (
    <div className="sentori-page-in max-w-2xl space-y-6">
      <header>
        <div className="text-fg-muted font-mono text-[11px] tracking-[0.18em] uppercase">
          endpoint health · {mode === 'edit' ? 'edit' : 'new check'}
        </div>
        <h1
          className="text-fg mt-1"
          style={{
            fontSize: '22px',
            fontVariationSettings: "'wdth' 95, 'opsz' 32, 'wght' 580",
            letterSpacing: '-0.012em',
          }}
        >
          {headerTitle}
        </h1>
        <div className="text-fg-muted mt-1 text-[12px]">
          Probes run every 60 s minimum. Two consecutive failures open an issue; recovery resolves
          it.
        </div>
      </header>

      <form
        className="border-border bg-bg-secondary space-y-4 rounded border p-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!name || !targetUrl) return
          if (mode === 'edit') update.mutate()
          else create.mutate()
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <FieldLabel label="Name">
            <input
              className="border-border bg-bg w-full rounded border px-2 py-1 text-[12px]"
              onChange={(e) => setName(e.target.value)}
              placeholder="checkout API liveness"
              required
              value={name}
            />
          </FieldLabel>
          <FieldLabel label="Method">
            <select
              className="border-border bg-bg w-full rounded border px-2 py-1 text-[12px]"
              onChange={(e) => setMethod(e.target.value as 'GET' | 'HEAD' | 'POST')}
              value={method}
            >
              <option value="GET">GET</option>
              <option value="HEAD">HEAD</option>
              <option value="POST">POST</option>
            </select>
          </FieldLabel>
          <FieldLabel label="Target URL">
            <input
              className="border-border bg-bg w-full rounded border px-2 py-1 font-mono text-[12px]"
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder="https://api.example.com/healthz"
              required
              type="url"
              value={targetUrl}
            />
          </FieldLabel>
          <FieldLabel label="Interval (sec, min 60)">
            <input
              className="border-border bg-bg w-full rounded border px-2 py-1 text-[12px]"
              min={60}
              onChange={(e) => setIntervalSec(parseInt(e.target.value, 10) || 60)}
              type="number"
              value={intervalSec}
            />
          </FieldLabel>
          <FieldLabel label="Status codes (comma)">
            <input
              className="border-border bg-bg w-full rounded border px-2 py-1 font-mono text-[12px]"
              onChange={(e) => setStatusCodesText(e.target.value)}
              placeholder="200, 204"
              value={statusCodesText}
            />
          </FieldLabel>
          <FieldLabel label="Max latency (ms, optional)">
            <input
              className="border-border bg-bg w-full rounded border px-2 py-1 text-[12px]"
              onChange={(e) => setMaxLatencyMs(e.target.value)}
              placeholder="2000"
              type="number"
              value={maxLatencyMs}
            />
          </FieldLabel>
          <FieldLabel label="Body must contain (optional)">
            <input
              className="border-border bg-bg w-full rounded border px-2 py-1 font-mono text-[12px]"
              onChange={(e) => setBodySubstring(e.target.value)}
              placeholder={'"status":"ok"'}
              value={bodySubstring}
            />
          </FieldLabel>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="border-accent bg-accent rounded border px-3 py-1.5 text-[12px] text-white disabled:opacity-50"
            disabled={pending}
            type="submit"
          >
            {pending ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create check'}
          </button>
          <Link
            className="border-border text-fg-muted rounded border px-3 py-1.5 text-[12px]"
            to={backTo}
          >
            Cancel
          </Link>
          {error && <span className="text-danger text-[11px]">{(error as Error).message}</span>}
        </div>
      </form>
    </div>
  )
}

/** Parse "200, 204, 304" → [200, 204, 304]. Tolerates whitespace
 *  and trailing commas; drops anything that doesn't parse as a
 *  positive int. Empty input falls back to [200] — the server
 *  uses the same default. */
function parseStatusCodes(s: string): number[] {
  const out: number[] = []
  for (const tok of s.split(',')) {
    const trimmed = tok.trim()
    if (!trimmed) continue
    const n = parseInt(trimmed, 10)
    if (Number.isInteger(n) && n > 0) out.push(n)
  }
  return out.length > 0 ? out : [200]
}

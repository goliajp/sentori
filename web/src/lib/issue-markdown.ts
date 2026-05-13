import type { Breadcrumb, EventRow, Frame, IssueRow, SentoriError } from '@/api/client'

/**
 * Phase 42 sub-H.02 — render an issue + its currently-selected event
 * as Markdown that's pasteable into a chat, ticket, or AI prompt.
 *
 * Output skeleton:
 *
 *     ## TypeError: Cannot read property 'foo' of undefined
 *
 *     **Release:** myapp@1.2.3+456
 *     **Environment:** prod
 *     **Device:** ios 17.0 / iPhone 15
 *     **Issue:** https://app.sentori.golia.jp/org/x/issues/<id>
 *
 *     ### Stack (top 5 in-app frames)
 *
 *     #### `Login.handleSubmit` — `src/screens/Login.tsx:42:18`
 *
 *     ```tsx
 *     40   async function handleSubmit() {
 *     41     try {
 *     42 →   await api.post('/login', { user })
 *     43     } catch (e) {
 *     44       setError(e.message)
 *     ```
 *
 *     #### caused by `RangeError: ...`
 *     ...
 *
 *     ### Breadcrumbs (last 5)
 *
 *     - 12:34:56 net POST /login 500 (123ms)
 *     - 12:34:55 nav Login → home
 *     - 12:34:50 user tap LoginButton
 *
 * Stops at the first 5 in-app frames per cause to keep the output
 * pasteable into chat (4k char budget is the loose target).
 */

const MAX_INAPP_FRAMES = 5
const MAX_BREADCRUMBS = 8
const FENCE = '```'

export function renderIssueMarkdown(opts: {
  event: EventRow
  issue: IssueRow
  /** Origin to build the issue URL link (e.g. window.location.origin). */
  origin: string
  /** Org slug for the URL. */
  orgSlug: string
}): string {
  const { event, issue, origin, orgSlug } = opts
  const payload = event.payload
  const err = payload.error
  const lines: string[] = []

  lines.push(`## ${err.type}: ${err.message}`)
  lines.push('')
  lines.push(`**Release:** ${event.release}`)
  lines.push(`**Environment:** ${event.environment}`)
  if (payload.device) {
    lines.push(`**Device:** ${payload.device.os} ${payload.device.osVersion}`)
  }
  if (payload.app) {
    lines.push(`**App:** ${payload.app.version}${payload.app.build ? '+' + payload.app.build : ''}`)
  }
  lines.push(`**Issue:** ${origin}/org/${orgSlug}/issues/${issue.id}`)
  if (event.id) {
    lines.push(`**Event:** \`${event.id.slice(0, 8)}\``)
  }
  lines.push('')

  renderErrorChain(err, lines, /*depth=*/ 0)

  const crumbs = payload.breadcrumbs ?? []
  if (crumbs.length > 0) {
    lines.push(`### Breadcrumbs (last ${Math.min(crumbs.length, MAX_BREADCRUMBS)})`)
    lines.push('')
    const tail = crumbs.slice(-MAX_BREADCRUMBS)
    for (const c of tail) {
      lines.push(`- ${renderBreadcrumb(c)}`)
    }
  }

  return lines.join('\n')
}

function renderErrorChain(err: SentoriError, out: string[], depth: number) {
  out.push(
    depth === 0
      ? `### Stack (top ${MAX_INAPP_FRAMES} in-app frames)`
      : `#### caused by \`${err.type}: ${err.message}\``
  )
  out.push('')

  // Pick the first N in-app frames, fallback to first N frames if no
  // inApp present (still useful for native stacks that haven't been
  // classified).
  const inApp = err.stack.filter((f) => f.inApp).slice(0, MAX_INAPP_FRAMES)
  const frames = inApp.length > 0 ? inApp : err.stack.slice(0, MAX_INAPP_FRAMES)

  for (const f of frames) {
    renderFrame(f, out)
  }
  if (err.cause) {
    out.push('')
    renderErrorChain(err.cause, out, depth + 1)
  }
}

function renderFrame(f: Frame, out: string[]) {
  const where = `${f.file}:${f.line}${f.column !== undefined ? `:${f.column}` : ''}`
  out.push(`##### \`${f.function ?? '<anonymous>'}\` — \`${where}\``)
  out.push('')
  if (f.contextLine !== undefined) {
    const lang = languageFor(f.file)
    const pre = f.preContext ?? []
    const post = f.postContext ?? []
    const firstNo = f.line - pre.length
    const numW = String(f.line + post.length).length
    out.push(FENCE + (lang ? lang : ''))
    pre.forEach((line, i) => {
      const n = firstNo + i
      out.push(`${String(n).padStart(numW, ' ')}   ${line}`)
    })
    out.push(`${String(f.line).padStart(numW, ' ')} → ${f.contextLine}`)
    post.forEach((line, i) => {
      const n = f.line + 1 + i
      out.push(`${String(n).padStart(numW, ' ')}   ${line}`)
    })
    out.push(FENCE)
    out.push('')
  }
}

function languageFor(file: null | string | undefined): null | string {
  if (!file) return null
  const ext = file.split('.').pop()?.split(/[?#]/)[0]?.toLowerCase()
  switch (ext) {
    case 'ts':
      return 'ts'
    case 'tsx':
      return 'tsx'
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'js'
    case 'jsx':
      return 'jsx'
    case 'swift':
      return 'swift'
    case 'kt':
    case 'kts':
      return 'kotlin'
    case 'java':
      return 'java'
    case 'm':
    case 'mm':
    case 'h':
      return 'objc'
    default:
      return null
  }
}

function renderBreadcrumb(c: Breadcrumb): string {
  const t = c.timestamp.slice(11, 19) // HH:MM:SS
  const data = c.data as Record<string, unknown>
  switch (c.type) {
    case 'net': {
      const method = (data.method as string) ?? 'GET'
      const status = (data.status as number) ?? 0
      const ms = (data.durationMs as number) ?? 0
      const url = (data.url as string) ?? '?'
      return `${t} net ${method} ${url} ${status} (${ms}ms)`
    }
    case 'nav': {
      const from = (data.from as string) ?? '?'
      const to = (data.to as string) ?? '?'
      return `${t} nav ${from} → ${to}`
    }
    case 'user': {
      const action = (data.action as string) ?? '?'
      const target = (data.target as string) ?? ''
      return `${t} user ${action}${target ? ' ' + target : ''}`
    }
    case 'log': {
      const level = (data.level as string) ?? 'log'
      const message = (data.message as string) ?? '?'
      return `${t} log [${level}] ${message}`
    }
    case 'custom':
    default: {
      return `${t} ${c.type} ${JSON.stringify(data)}`
    }
  }
}

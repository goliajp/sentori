#!/usr/bin/env node
import { parseArgs } from 'node:util'

import { formatIssueLine, issueList, issuePatch } from './issue.js'
import { reactNativeUpload } from './react-native.js'
import { uploadSourcemaps } from './upload.js'

const HELP = `sentori-cli — Sentori command-line interface

Source-map upload:
  sentori-cli upload sourcemap [options] <path...>
      Upload one or more files or directories. A directory is scanned
      (one level) for *.map / *.js / *.jsbundle / *.bundle / *.hbc;
      a file given explicitly is uploaded as-is. Use this for web
      bundlers (point at the build dir) or for already-composed RN maps.

  sentori-cli react-native upload [options]
      Compose a Metro packager map + a Hermes map into one source map
      and upload it (plus the bundle). Use this for a Hermes release
      build. Requires --metro-map and --hermes-map.

CI triage:
  sentori-cli issue list --project <uuid> [--status active|silenced|resolved|closed] [--limit N] [--error-type <t>]
  sentori-cli issue resolve <issue-uuid> --project <uuid> [--in-release <r>]
  sentori-cli issue silence <issue-uuid> --project <uuid>

Options (upload commands):
  --release <r>     release identifier — MUST equal the value the SDK
                    reports via init({ release }). Required.
  --token <t>       Sentori token (or set $SENTORI_TOKEN).
  --api-url <url>   Sentori API base (default https://api.sentori.golia.jp,
                    or $SENTORI_API_URL). For a self-hosted instance, your
                    host. (Accepts --ingest-url as an alias.)
  --dry-run         describe what would be uploaded; don't upload.
  -h, --help        show this help.

Options (react-native upload):
  --metro-map <p>   the *.packager.map Metro emits (--sourcemap-output).
  --hermes-map <p>  the *.hbc.map the Hermes compiler emits.
  --bundle <p>      optional: also upload the bundle (.jsbundle / .bundle).

Options (issue commands):
  --project <uuid>  project id (or set $SENTORI_PROJECT_ID).
  --token <t>       admin token, sk_… prefix (or $SENTORI_ADMIN_TOKEN /
                    $SENTORI_TOKEN). The ingest st_pk_ token may also work
                    on a self-hosted instance.
  --api-url <url>   Sentori API base (same as above).
  --in-release <r>  (resolve only) mark this release as where the fix
                    landed; the regression detector flips the issue back
                    to "regressed" if a matching event lands later.

Hermes release build, by hand:
  npx react-native bundle --platform ios --dev false --entry-file index.js \\
    --bundle-output main.jsbundle --sourcemap-output main.jsbundle.packager.map
  # (the iOS/Android build compiles to Hermes and writes main.jsbundle.hbc.map)
  npx @goliapkg/sentori-cli react-native upload \\
    --release "<app>@<version>+<build>" --token "$SENTORI_TOKEN" \\
    --metro-map main.jsbundle.packager.map --hermes-map main.jsbundle.hbc.map \\
    --bundle main.jsbundle
`

type Common = { apiUrl: string; dryRun: boolean; release: string; token: string }

/** Parse the shared options, or print an error + return null. */
function parseCommon(values: Record<string, unknown>): Common | null {
  const release = typeof values.release === 'string' ? values.release : undefined
  if (!release) {
    console.error('error: --release is required (must match the SDK’s init({ release }))')
    return null
  }
  const dryRun = values['dry-run'] === true
  const token =
    (typeof values.token === 'string' ? values.token : undefined) ?? process.env.SENTORI_TOKEN
  if (!token && !dryRun) {
    console.error('error: --token (or $SENTORI_TOKEN) is required')
    return null
  }
  const apiUrl =
    (typeof values['api-url'] === 'string' ? values['api-url'] : undefined) ??
    (typeof values['ingest-url'] === 'string' ? values['ingest-url'] : undefined) ??
    process.env.SENTORI_API_URL ??
    'https://api.sentori.golia.jp'
  return { apiUrl, dryRun, release, token: token ?? '' }
}

async function cmdUploadSourcemap(argv: string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      args: argv,
      options: {
        'api-url': { type: 'string' },
        'dry-run': { type: 'boolean' },
        help: { short: 'h', type: 'boolean' },
        'ingest-url': { type: 'string' },
        release: { type: 'string' },
        token: { type: 'string' },
      },
    })
  } catch (e) {
    console.error(`error: ${(e as Error).message}\n`)
    console.error(HELP)
    return 2
  }
  if (parsed.values.help) {
    console.log(HELP)
    return 0
  }
  const c = parseCommon(parsed.values)
  if (!c) return 2
  if (parsed.positionals.length === 0) {
    console.error('error: at least one path (file or directory) is required')
    return 2
  }
  try {
    const result = await uploadSourcemaps({
      apiUrl: c.apiUrl,
      dryRun: c.dryRun,
      paths: parsed.positionals,
      release: c.release,
      token: c.token,
    })
    reportUpload(result, c)
    return 0
  } catch (e) {
    console.error(`upload failed: ${(e as Error).message}`)
    return 1
  }
}

async function cmdReactNativeUpload(argv: string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        'api-url': { type: 'string' },
        bundle: { type: 'string' },
        'dry-run': { type: 'boolean' },
        help: { short: 'h', type: 'boolean' },
        'hermes-map': { type: 'string' },
        'ingest-url': { type: 'string' },
        'metro-map': { type: 'string' },
        release: { type: 'string' },
        token: { type: 'string' },
      },
    })
  } catch (e) {
    console.error(`error: ${(e as Error).message}\n`)
    console.error(HELP)
    return 2
  }
  if (parsed.values.help) {
    console.log(HELP)
    return 0
  }
  const c = parseCommon(parsed.values)
  if (!c) return 2
  const metroMap = parsed.values['metro-map']
  const hermesMap = parsed.values['hermes-map']
  if (typeof metroMap !== 'string' || typeof hermesMap !== 'string') {
    console.error('error: --metro-map and --hermes-map are both required')
    return 2
  }
  try {
    const result = await reactNativeUpload({
      apiUrl: c.apiUrl,
      bundle: typeof parsed.values.bundle === 'string' ? parsed.values.bundle : undefined,
      dryRun: c.dryRun,
      hermesMap,
      metroMap,
      release: c.release,
      token: c.token,
    })
    reportUpload(result, c)
    return 0
  } catch (e) {
    console.error(`react-native upload failed: ${(e as Error).message}`)
    return 1
  }
}

function reportUpload(
  result: { files: string[]; uploaded?: number },
  c: Common,
): void {
  if (c.dryRun) {
    console.log(
      `would upload ${result.files.length} file(s) to ${c.apiUrl.replace(/\/+$/, '')}/admin/api/releases/${encodeURIComponent(c.release)}/sourcemaps:`,
    )
    for (const f of result.files) console.log(`  ${f}`)
  } else {
    console.log(
      `uploaded ${result.uploaded ?? result.files.length} file(s) for release "${c.release}" — minified stacks on this release will now resolve to source.`,
    )
  }
}

// ── issue commands ────────────────────────────────────────────────

type AdminCfg = { apiUrl: string; projectId: string; token: string }

function parseAdminCfg(values: Record<string, unknown>): AdminCfg | null {
  const projectId =
    (typeof values.project === 'string' ? values.project : undefined) ??
    process.env.SENTORI_PROJECT_ID
  if (!projectId) {
    console.error('error: --project <uuid> (or $SENTORI_PROJECT_ID) is required')
    return null
  }
  const token =
    (typeof values.token === 'string' ? values.token : undefined) ??
    process.env.SENTORI_ADMIN_TOKEN ??
    process.env.SENTORI_TOKEN
  if (!token) {
    console.error(
      'error: --token (or $SENTORI_ADMIN_TOKEN / $SENTORI_TOKEN) is required for issue commands',
    )
    return null
  }
  const apiUrl =
    (typeof values['api-url'] === 'string' ? values['api-url'] : undefined) ??
    (typeof values['ingest-url'] === 'string' ? values['ingest-url'] : undefined) ??
    process.env.SENTORI_API_URL ??
    'https://api.sentori.golia.jp'
  return { apiUrl, projectId, token }
}

async function cmdIssueList(argv: string[]): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        'api-url': { type: 'string' },
        'error-type': { type: 'string' },
        help: { short: 'h', type: 'boolean' },
        'ingest-url': { type: 'string' },
        limit: { type: 'string' },
        project: { type: 'string' },
        status: { type: 'string' },
        token: { type: 'string' },
      },
    })
  } catch (e) {
    console.error(`error: ${(e as Error).message}\n${HELP}`)
    return 2
  }
  if (parsed.values.help) {
    console.log(HELP)
    return 0
  }
  const cfg = parseAdminCfg(parsed.values)
  if (!cfg) return 2
  const status = parsed.values.status
  if (status && !['active', 'closed', 'resolved', 'silenced'].includes(status)) {
    console.error(`error: --status must be one of: active, silenced, resolved, closed`)
    return 2
  }
  const limitStr = parsed.values.limit
  const limit = limitStr ? Number.parseInt(limitStr, 10) : undefined
  try {
    const rows = await issueList({
      config: cfg,
      errorType: parsed.values['error-type'],
      limit,
      status: status as 'active' | 'closed' | 'resolved' | 'silenced' | undefined,
    })
    if (rows.length === 0) {
      console.log('(no matching issues)')
      return 0
    }
    for (const r of rows) console.log(formatIssueLine(r))
    return 0
  } catch (e) {
    console.error(`issue list failed: ${(e as Error).message}`)
    return 1
  }
}

async function cmdIssuePatch(
  argv: string[],
  body: { resolvedInRelease?: string; status: 'active' | 'closed' | 'resolved' | 'silenced' },
  verb: 'closed' | 'resolved' | 'silenced',
): Promise<number> {
  let parsed
  try {
    parsed = parseArgs({
      allowPositionals: true,
      args: argv,
      options: {
        'api-url': { type: 'string' },
        help: { short: 'h', type: 'boolean' },
        'in-release': { type: 'string' },
        'ingest-url': { type: 'string' },
        project: { type: 'string' },
        token: { type: 'string' },
      },
    })
  } catch (e) {
    console.error(`error: ${(e as Error).message}\n${HELP}`)
    return 2
  }
  if (parsed.values.help) {
    console.log(HELP)
    return 0
  }
  const cfg = parseAdminCfg(parsed.values)
  if (!cfg) return 2
  const issueId = parsed.positionals[0]
  if (!issueId) {
    console.error('error: <issue-uuid> is required')
    return 2
  }
  if (verb === 'resolved' && typeof parsed.values['in-release'] === 'string') {
    body.resolvedInRelease = parsed.values['in-release']
  }
  try {
    const updated = await issuePatch(cfg, issueId, body)
    console.log(
      `${issueId} → ${verb}${body.resolvedInRelease ? ` (in ${body.resolvedInRelease})` : ''}: ${updated.errorType}`,
    )
    return 0
  } catch (e) {
    console.error(`issue ${verb} failed: ${(e as Error).message}`)
    return 1
  }
}

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    console.log(HELP)
    return 0
  }
  const [a, b, ...rest] = argv
  if (a === 'upload' && b === 'sourcemap') return cmdUploadSourcemap(rest)
  if (a === 'react-native' && b === 'upload') return cmdReactNativeUpload(rest)
  if (a === 'issue' && b === 'list') return cmdIssueList(rest)
  if (a === 'issue' && b === 'resolve') return cmdIssuePatch(rest, { status: 'resolved' }, 'resolved')
  if (a === 'issue' && b === 'silence') return cmdIssuePatch(rest, { status: 'silenced' }, 'silenced')
  if (a === 'issue' && b === 'close') return cmdIssuePatch(rest, { status: 'closed' }, 'closed')
  console.error(`unknown command: ${[a, b].filter(Boolean).join(' ') || '(none)'}\n`)
  console.error(HELP)
  return 2
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    console.error(`fatal: ${(e as Error).message}`)
    process.exit(1)
  },
)

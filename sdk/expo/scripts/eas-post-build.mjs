#!/usr/bin/env node
/**
 * EAS post-build hook for Sentori source map upload.
 *
 * Wire it from app.json / eas.json:
 *
 *   {
 *     "build": {
 *       "production": {
 *         "ios": { "buildArtifactPaths": ["ios/build/**\/*.dSYM"] },
 *         "hooks": {
 *           "postPublish": [
 *             {
 *               "config": "@goliapkg/sentori-expo/eas-post-build",
 *               "options": { "release": "myapp@1.2.3+42" }
 *             }
 *           ]
 *         }
 *       }
 *     }
 *   }
 *
 * Or call this script directly from a custom build hook:
 *
 *   #!/bin/sh
 *   node ./node_modules/@goliapkg/sentori-expo/scripts/eas-post-build.mjs \
 *     --token $SENTORI_ADMIN_TOKEN --release "$EAS_BUILD_RELEASE"
 *
 * The script shells out to `sentori-cli` for the actual upload (Phase 22
 * sub-A introduces `sentori-cli upload dsym`). Until that lands this is
 * a stub that logs what it would have done — adopt sub-D in your
 * pipeline now and the CLI integration arrives transparently.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

const args = parseArgs(process.argv.slice(2))

const token = args.token ?? process.env.SENTORI_ADMIN_TOKEN
const release = args.release ?? process.env.EAS_BUILD_RELEASE
const ingestUrl = args.ingest ?? process.env.SENTORI_INGEST_URL

if (!token || !release) {
  console.error(
    '[sentori-expo:eas-post-build] missing --token or --release ' +
      '(env: SENTORI_ADMIN_TOKEN, EAS_BUILD_RELEASE)',
  )
  process.exit(1)
}

const cli = resolveCli()
if (!cli) {
  console.warn(
    '[sentori-expo:eas-post-build] sentori-cli not found on PATH or in node_modules. ' +
      'Skipping upload — install @goliapkg/sentori-cli to enable. ' +
      'Phase 22 sub-A will land the proper upload subcommand.',
  )
  process.exit(0)
}

const cmd = [
  'upload',
  'sourcemap',
  '--token',
  token,
  '--release',
  release,
  ...(ingestUrl ? ['--ingest', ingestUrl] : []),
  // Default Expo build output for the JS bundle + sourcemap.
  './dist',
]

console.log(`[sentori-expo:eas-post-build] running: ${cli} ${cmd.join(' ')}`)
const r = spawnSync(cli, cmd, { stdio: 'inherit' })
process.exit(r.status ?? 0)

function parseArgs(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1]
      i++
    }
  }
  return out
}

function resolveCli() {
  // Prefer node_modules/.bin so the locked @goliapkg/sentori-cli wins
  // over a globally-installed older copy.
  for (const p of [
    './node_modules/.bin/sentori-cli',
    './node_modules/@goliapkg/sentori-cli/bin/sentori-cli.js',
  ]) {
    if (existsSync(p)) return p
  }
  // PATH lookup as last resort.
  const which = spawnSync('which', ['sentori-cli'])
  const found = which.stdout?.toString().trim()
  return found || null
}

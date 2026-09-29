// A gate that cannot fail is not a gate.
//
// Every checker here was green the day it was written, and green ever
// since. That is also what a checker looks like after the code it reads
// moves out from under it: `check-wire-case` reported "all camelCase"
// for the life of `/v1/releases/{release}/artifacts`, which answered
// content_hash and size_bytes, because it read one directory and the
// route lived one level up.
//
// So each entry below reintroduces the defect its checker exists for and
// requires the checker to say so. The mutation is applied to a copy of
// the tracked tree, never to the working tree.
//
// Injections happen where the rule is, not near it. Three of the first
// attempts at this table passed against a live gate: a snake_case key in
// the admin API, which `check-wire-case` excludes on purpose; a removed
// `use` line rather than the guard call itself; and an error body in a
// handler that carries its own status, which is what the rule asks for.
// An entry that does not go red means the probe is wrong at least as
// often as the gate.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const PROBES = [
  {
    gate: 'check-wire-case.mjs',
    file: 'self-hosted/server/src/handlers/sdk/events.rs',
    find: 'json!({',
    replace: 'json!({\n        "injected_snake_key": 1,',
    why: 'a snake_case key on the /v1 wire',
  },
  {
    gate: 'check-text-ordering.mjs',
    file: 'self-hosted/server/src/handlers/notify_admin.rs',
    find: 'ORDER BY p.name COLLATE \\"C\\"',
    replace: 'ORDER BY p.name',
    why: 'an order the operator\'s image decides',
  },
  {
    gate: 'check-metric-names.mjs',
    file: 'ops/prometheus-alerts.yml',
    find: 'groups:',
    replace:
      'groups:\n  - name: injected\n    rules:\n      - alert: Injected\n' +
      '        expr: sentori_does_not_exist > 0',
    why: 'an alert on a metric nothing emits',
  },
  {
    gate: 'check-sql-tables-exist.mjs',
    file: 'self-hosted/server/src/resymbolicate.rs',
    find: 'FROM releases ORDER BY created_at DESC',
    replace: 'FROM releases_nonexistent ORDER BY created_at DESC',
    why: 'a query naming a table the migrations never create',
  },
  {
    gate: 'check-attachment-scoping.mjs',
    file: 'self-hosted/server/src/handlers/attachments.rs',
    find: '"SELECT project_id, media_type, blob_hash FROM event_attachments',
    replace: '"SELECT media_type, blob_hash FROM event_attachments',
    why: 'a read of another project\'s attachment',
  },
  {
    gate: 'check-admin-authorisation.mjs',
    file: 'self-hosted/server/src/handlers/admin/releases.rs',
    find: '    ensure_project_access(&state, &ctx, project_id).await?;',
    replace: '    // guard removed by the probe',
    why: 'a project-scoped admin endpoint that authorises nobody',
  },
  {
    gate: 'check-timezone-pinned.mjs',
    file: 'self-hosted/cli/src/db.rs',
    find: 'const TIME_ZONE: &str = "UTC";',
    replace: 'const TIME_ZONE: &str = "Asia/Tokyo";',
    why: 'two binaries meaning different things by now()',
  },
  {
    gate: 'check-wire-contracts.mjs',
    file: 'self-hosted/server/src/handlers/sdk/events.rs',
    find: '"javascript", "ios", "android", "web", "weapp"',
    replace: '"javascript", "ios", "android", "weapp"',
    why: 'a runtime the SDK names and the server files under unknown',
  },
  {
    gate: 'check-ios-packaging.mjs',
    file: 'sdk/native/ios/Sources/Sentori/PrivacyInfo.xcprivacy',
    find: 'NSPrivacyAccessedAPICategoryUserDefaults',
    replace: 'NSPrivacyAccessedAPICategoryUserDefaultsTypo',
    why: 'a required-reason API the manifest does not declare',
  },
  {
    gate: 'check-doc-versions.mjs',
    file: 'docs/sdk-kotlin.md',
    find: 'jp.golia.sentori:sentori:',
    replace: 'jp.golia.sentori:sentori:0.0.1-',
    why: 'an install line that installs a version we do not ship',
  },
  {
    gate: 'check-error-status.mjs',
    file: 'self-hosted/server/src/handlers/notify_admin.rs',
    find: 'pub async fn smtp_status(State(state): State<Arc<AppState>>) -> Json<Value> {',
    replace:
      'pub async fn smtp_status(State(state): State<Arc<AppState>>) -> Json<Value> {\n' +
      '    if false { return Json(json!({ "error": "injected_probe" })); }',
    why: 'a 200 carrying an error',
  },
];

// The tracked files only: the mirror of what a clean checkout holds, and
// small enough to copy in under two seconds.
const copy = mkdtempSync(join(tmpdir(), 'sentori-gates-'));
try {
  execFileSync('sh', ['-c', `git ls-files -z | rsync -0 --files-from=- ./ ${copy}/`], {
    cwd: ROOT,
    stdio: 'pipe',
  });

  const failures = [];
  for (const p of PROBES) {
    const path = join(copy, p.file);
    const before = readFileSync(path, 'utf8');
    if (!before.includes(p.find)) {
      failures.push(
        `${p.gate}: the probe's anchor is gone from ${p.file}. The code moved; ` +
        `re-aim it at where the rule is now, or this gate is untested.`,
      );
      continue;
    }
    writeFileSync(path, before.replace(p.find, p.replace));
    const r = spawnSync('node', [join(copy, 'scripts', p.gate)], {
      cwd: copy,
      encoding: 'utf8',
    });
    writeFileSync(path, before);
    if (r.status === 0) {
      failures.push(
        `${p.gate}: stayed green with ${p.why} in ${p.file}. Either the rule ` +
        `no longer reaches that code, or the probe injects something the rule ` +
        `excludes on purpose.`,
      );
    }
  }

  if (failures.length) {
    console.error(`✗ ${failures.length} of ${PROBES.length} gate(s) did not fail on their own defect:`);
    for (const f of failures) console.error(`    ${f}`);
    process.exit(1);
  }
  console.log(`✓ ${PROBES.length} gates each went red on the defect they exist for`);
} finally {
  rmSync(copy, { recursive: true, force: true });
}

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
    gate: 'gen-replay-vectors.mjs --check',
    // The compiled module, not the source: the generator imports
    // `lib/`, so a mutation of the `.ts` would leave the checker
    // reading the same bytes and passing.
    file: 'sdk/core/lib/replay-ring.js',
    find: 'const DELTA_TO_KEYFRAME_RATIO = 0.4',
    replace: 'const DELTA_TO_KEYFRAME_RATIO = 0.9',
    why: 'a replay rule the native ports are no longer asserting',
  },
  {
    gate: 'check-doc-commands.mjs',
    file: 'docs/sdk-swift.md',
    find: '--token "$SENTORI_TOKEN"',
    replace: '--token "$SENTORI_API_TOKEN"',
    why: 'a documented token variable the CLI does not read',
  },
  {
    gate: 'check-orphan-ts.mjs',
    file: 'sdk/react-native/src/index.ts',
    // `mask` until 2026-09-30, when this stopped orphaning anything:
    // `replay.ts` and `replay-screens.ts` both import it now, so
    // dropping the re-export left the module perfectly reachable and
    // the gate rightly said nothing. The probe had been passing on a
    // non-zero exit for an unrelated reason; the baseline check added
    // to this file is what exposed it.
    //
    // `error-boundary` is reachable from the index and nowhere else,
    // which is what an orphan probe needs.
    find: "export { ErrorBoundary } from './error-boundary';",
    replace: '',
    why: 'a TypeScript module that ships in no bundle',
  },
  {
    // The rigs that crash a real app are the gates nobody can retest
    // by hand, so a trigger list that forgets one is the quietest way
    // to lose them.
    gate: 'check-workflow-script-paths.mjs',
    file: '.github/workflows/mobile-e2e.yml',
    find: "      - 'scripts/ios-crash-loop.sh'",
    replace: '',
    why: 'a gate script no workflow is triggered by',
  },
  {
    // A second launcher is a second set of flags nobody compares
    // until one of them is flaky on a machine nobody can log into.
    gate: 'check-single-chrome-launcher.mjs',
    file: 'scripts/lib/headless-chrome.mjs',
    find: "      '--no-first-run',",
    replace: '',
    why: 'a launcher missing a flag that is there for a real failure',
  },
  {
    // The fixture is generated from the kernel, so a kernel rule that
    // Swift and Kotlin have not been told about shows up here rather
    // than as two platforms counting losses differently in
    // production.
    gate: 'gen-transport-vectors.mjs --check',
    // The built lib, not the source: the generator drives the compiled
    // kernel, so that is what a stale fixture would disagree with.
    file: 'sdk/core/lib/transport.js',
    find: 'const MAX_QUEUED = 500',
    replace: 'const MAX_QUEUED = 400',
    why: 'a kernel rule the native transports have not followed',
  },
  {
    // Adds a dead option rather than removing a read. Every switch in
    // `detect` is read in two places — once to resolve the config and
    // once where it acts — so deleting one line leaves the other, and
    // a probe that cannot make the gate red proves nothing about
    // either.
    gate: 'check-dead-options.mjs',
    file: 'sdk/core/src/types.ts',
    find: '    uiThreadHang?: boolean',
    replace: '    uiThreadHang?: boolean\n    neverReadByAnything?: boolean',
    why: 'a public option nothing reads',
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

  // The copy has to be a git repository, because several gates ask git
  // questions: `check-ios-packaging` reads `git ls-files` to learn what
  // a consumer receives, and `check-doc-versions` reads `git tag` to
  // learn which versions are published.
  //
  // Without this they failed here with "not a git repository" — a
  // non-zero exit, which the loop below read as "the gate went red".
  // Both were reported as verified for as long as they have been in
  // this list, having never once run. The baseline check added below
  // is what surfaced it; before that, a gate that could not run and a
  // gate that caught the defect were the same observation.
  const git = (...args) =>
    execFileSync('git', args, { cwd: copy, stdio: 'pipe', encoding: 'utf8' });
  git('init', '-q');
  git('-c', 'user.email=gates@example.com', '-c', 'user.name=gates', 'add', '-A');
  git(
    '-c', 'user.email=gates@example.com', '-c', 'user.name=gates',
    'commit', '-q', '-m', 'sandbox',
  );
  // Tag names only: `check-doc-versions` reads which versions exist,
  // not what they point at.
  for (const tag of execFileSync('git', ['tag', '--list', 'swift/*'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean)) {
    git('tag', tag);
  }

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
    // Split, because a gate can take a flag. Passing the whole string
    // as one filename made `node scripts/'gen-replay-vectors.mjs
    // --check'` throw MODULE_NOT_FOUND — a non-zero exit, which this
    // file then read as "the gate went red". That entry had never run
    // the gate at all, and was reported as verified for as long as it
    // has existed. Found by adding a second entry of the same shape.
    const [script, ...args] = p.gate.split(' ');
    const run = () =>
      spawnSync('node', [join(copy, 'scripts', script), ...args], {
        cwd: copy,
        encoding: 'utf8',
      });

    // Green before the probe, or a non-zero exit afterwards says
    // nothing: a gate that cannot run in this sandbox fails either
    // way, and looks exactly like one that caught the defect.
    const baseline = run();
    if (baseline.status !== 0) {
      failures.push(
        `${p.gate}: already fails on an unmodified tree, so its red below means ` +
        `nothing. It cannot run here:\n${(baseline.stderr || baseline.stdout || '').trim().slice(0, 400)}`,
      );
      continue;
    }

    writeFileSync(path, before.replace(p.find, p.replace));
    const r = run();
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

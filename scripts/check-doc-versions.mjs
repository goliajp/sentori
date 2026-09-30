// The install line in the docs installs the version this repo ships.
//
//   node scripts/check-doc-versions.mjs
//
// `docs/sdk-swift.md` said `from: "1.5.0"` and `docs/sdk-kotlin.md`
// said `sentori:1.5.0` while the tree was on 2.1.0 — three minors of
// crash delivery, push and symbolication that a reader following the
// page would not have got, with nothing anywhere saying so. A version
// in prose is a fact about the build, and it rots exactly as quietly
// as any other fact nothing checks.
//
// Only the dependency lines. A version inside an *example* release
// string (`com.example.app@1.5.0+220`) is the reader's app, not ours,
// and pinning it to our number would teach the wrong thing.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// What a reader can actually install, which is not what the tree is
// about to release.
//
// The first version of this file compared the docs to
// `sdk/native/VERSION`. That is the version being *prepared*, and
// `check-native-version-tag.mjs` requires it to be untagged — so the
// two gates together guaranteed the docs named a version nobody could
// install. They both passed while `from: "2.1.0"` resolved to nothing
// on SwiftPM and Maven Central, whose newest was 2.0.2.
//
// Published means tagged here: `swift/<version>` is written by the
// release that pushes the mirror and the Maven artifact.
const published = execFileSync('git', ['tag', '--list', 'swift/*'], { encoding: 'utf8' })
  .split('\n')
  .map((t) => t.replace('swift/', '').trim())
  .filter((t) => /^\d+\.\d+\.\d+$/.test(t))
  .sort((a, b) => {
    const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
if (published.length === 0) {
  console.error('✗ no swift/<version> tags — this check cannot tell what is installable');
  process.exit(1);
}
const native = published[published.length - 1];
const nativeMajor = native.split('.')[0];
const rn = JSON.parse(readFileSync('sdk/react-native/package.json', 'utf8')).version;

/**
 * The newest `jp.golia.sentori:sentori` Maven Central will actually
 * serve.
 *
 * Asked of Central rather than inferred from a tag. `swift/2.1.0` was
 * tagged and pushed, this check said the Gradle line could name 2.1.0,
 * and `repo1.maven.org/.../sentori/2.1.0/` answered 404 — the Android
 * publish is a separate manual workflow. A version in a docs snippet
 * is a promise that `gradle build` resolves it, and only the registry
 * can keep that promise.
 *
 * Fails rather than skips when the network is unavailable. A check that
 * goes green because it could not look is the shape of defect this file
 * exists to catch. `SENTORI_SKIP_CENTRAL_CHECK=1` opts out explicitly,
 * for working offline; CI never sets it.
 */
async function newestOnMavenCentral() {
  if (process.env.SENTORI_SKIP_CENTRAL_CHECK === '1') {
    console.warn('! SENTORI_SKIP_CENTRAL_CHECK=1 — the Gradle line is checked against the newest tag instead');
    return native;
  }
  const url =
    'https://repo1.maven.org/maven2/jp/golia/sentori/sentori/maven-metadata.xml';
  let xml;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (e) {
    console.error(`\u2717 could not ask Maven Central what is published (${e.message}).`);
    console.error('  The Gradle line in the docs is a promise that `gradle build` resolves');
    console.error('  it, and a tag in this repo does not make that true — the Android');
    console.error('  publish is its own manual workflow. Set SENTORI_SKIP_CENTRAL_CHECK=1');
    console.error('  to check against the newest tag instead, offline and knowingly.');
    process.exit(1);
  }
  const versions = [...xml.matchAll(/<version>([\d.]+)<\/version>/g)]
    .map((m) => m[1])
    .filter((v) => /^\d+\.\d+\.\d+$/.test(v))
    .sort((a, b) => {
      const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
  if (versions.length === 0) {
    console.error('\u2717 Maven Central listed no versions of jp.golia.sentori:sentori');
    process.exit(1);
  }
  return versions[versions.length - 1];
}

const CASES = [
  {
    file: 'docs/sdk-swift.md',
    pattern: /sentori-swift",\s*from:\s*"(\d+)\.\d+\.\d+"/,
    want: nativeMajor,
    what: 'the Swift Package Manager line',
    source: 'the newest tag',
    note:
      '`from:` is a floor that resolves to the newest release in that major, ' +
      'so it names the major rather than a version that would go stale on every release',
  },
  {
    file: 'docs/sdk-kotlin.md',
    pattern: /jp\.golia\.sentori:sentori:([\d.]+)/,
    // Not `native`. A tag here means the Swift mirror went out; the
    // Android artifact is a separate, manual publish to Maven Central,
    // and for a while it was over the org's monthly quota. So the tag
    // and the Gradle coordinate are different facts, and this is the
    // one case where only the registry knows the answer.
    want: await newestOnMavenCentral(),
    what: 'the Gradle line',
    source: 'Maven Central',
  },
];

const problems = [];
for (const { file, pattern, want, what, source } of CASES) {
  const found = pattern.exec(readFileSync(file, 'utf8'));
  if (!found) {
    problems.push(`${file}: could not find ${what} — it moved, and this check now reads nothing`);
    continue;
  }
  if (found[1] !== want) {
    problems.push(
      `${file}: ${what} names ${found[1]}, and ${source ?? 'this repo'} has ${want} — ` +
        'a reader following the page cannot resolve it',
    );
  }
}

// The React Native package advertises itself in its own README, which
// npm renders on the package page.
{
  const readme = readFileSync('sdk/react-native/README.md', 'utf8');
  const stale = [...readme.matchAll(/@goliapkg\/sentori-react-native@([\d.]+)/g)]
    .map((m) => m[1])
    .filter((v) => v !== rn);
  for (const v of stale) {
    problems.push(`sdk/react-native/README.md names ${v}; the package is ${rn}`);
  }
}

if (problems.length === 0) {
  console.log(
    `✓ every advertised version is one a reader can install ` +
      `(swift ${native}, maven ${CASES[1].want}, rn ${rn})`,
  );
  process.exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
process.exit(1);

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

const native = readFileSync('sdk/native/VERSION', 'utf8').trim();
const rn = JSON.parse(readFileSync('sdk/react-native/package.json', 'utf8')).version;

const CASES = [
  {
    file: 'docs/sdk-swift.md',
    pattern: /sentori-swift",\s*from:\s*"([\d.]+)"/,
    want: native,
    what: 'the Swift Package Manager line',
  },
  {
    file: 'docs/sdk-swift.md',
    // `~> 2.1` is the whole 2.1.x line, which is what a pod should
    // pin; it must name the minor we are on.
    pattern: /pod 'Sentori',\s*'~>\s*([\d.]+)'/,
    want: native.split('.').slice(0, 2).join('.'),
    what: 'the CocoaPods line',
  },
  {
    file: 'docs/sdk-kotlin.md',
    pattern: /jp\.golia\.sentori:sentori:([\d.]+)/,
    want: native,
    what: 'the Gradle line',
  },
];

const problems = [];
for (const { file, pattern, want, what } of CASES) {
  const found = pattern.exec(readFileSync(file, 'utf8'));
  if (!found) {
    problems.push(`${file}: could not find ${what} — it moved, and this check now reads nothing`);
    continue;
  }
  if (found[1] !== want) {
    problems.push(
      `${file}: ${what} installs ${found[1]}, this repo ships ${want} — a reader ` +
        'following the page gets a version we are not testing',
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
  console.log(`✓ every advertised version matches the tree (native ${native}, rn ${rn})`);
  process.exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
process.exit(1);

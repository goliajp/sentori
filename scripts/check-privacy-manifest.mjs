// The iOS privacy manifest declares every required-reason API the
// sources reach, and both distribution channels ship it.
//
//   node scripts/check-privacy-manifest.mjs
//
// Apple rejects a submission that calls one of these APIs without a
// declared reason, and the rejection lands on the host app's release,
// not on ours — the one failure mode the client zero-cost rule exists
// to prevent, arriving weeks after the integration and looking like
// the host's own problem.
//
// Two directions. A call with no declaration is the rejection. A
// declaration with no call is a claim about what the SDK does that
// nothing in the SDK does, which is the kind of thing that stops
// being true quietly and stays in the file for years.
//
// Neither the Swift package nor the pod picks the file up implicitly:
// SwiftPM needs it in `resources`, CocoaPods needs it in
// `resource_bundles`, and a pod cannot read the package's copy, so
// there are two files and both are checked.

import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SOURCES = 'sdk/native/ios/Sources/Sentori';
const MANIFEST = `${SOURCES}/PrivacyInfo.xcprivacy`;
const POD_MANIFEST = 'sdk/react-native/ios/core/PrivacyInfo.xcprivacy';
const PACKAGE = 'sdk/native/ios/Package.swift';
const PODSPEC = 'sdk/react-native/SentoriReactNative.podspec';

// Symbol → the category Apple files it under. Only the categories
// this SDK could plausibly reach; a new one is added the day a call
// to it is, which is what the "declared but never called" half below
// makes impossible to forget.
const REQUIRED_REASON = [
  ['NSPrivacyAccessedAPICategoryUserDefaults', /\bUserDefaults\b|NSUserDefaults/],
  ['NSPrivacyAccessedAPICategorySystemBootTime', /\bsystemUptime\b|\bmach_absolute_time\b|\bmach_continuous_time\b/],
  [
    'NSPrivacyAccessedAPICategoryFileTimestamp',
    /\bcreationDate\b|\bmodificationDate\b|\battributesOfItem\b|contentModificationDateKey|creationDateKey|\bNSFileCreationDate\b|\bNSFileModificationDate\b|\bgetattrlist\b|\bfstat\b|\blstat\b/,
  ],
  [
    'NSPrivacyAccessedAPICategoryDiskSpace',
    /volumeAvailableCapacity|\bstatfs\b|\bfstatfs\b|NSFileSystemFreeSize|systemFreeSize/,
  ],
  ['NSPrivacyAccessedAPICategoryActiveKeyboards', /activeInputModes|UITextInputMode/],
];

const problems = [];

for (const path of [MANIFEST, POD_MANIFEST]) {
  if (!existsSync(path)) {
    problems.push(`${path} is missing — a binary that reaches a required-reason API without one is rejected`);
  }
}
if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}

const manifest = readFileSync(MANIFEST, 'utf8');

// Structure before content. `plutil -lint` would be the natural tool
// and is not on the Linux runner this gate has to pass on, so the
// shape is checked here: tags balanced, and the two top-level arrays
// present. A manifest that does not parse is not a manifest, and
// Xcode says so a great deal later than this does.
{
  const tags = [...manifest.matchAll(/<(\/?)(dict|array|plist)\b[^>]*?(\/?)>/g)];
  const stack = [];
  for (const [, closing, tag, selfClosing] of tags) {
    if (selfClosing) continue;
    if (closing) {
      if (stack.pop() !== tag) {
        problems.push(`${MANIFEST}: <${tag}> closes something else — the plist does not parse`);
        break;
      }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length > 0) {
    problems.push(`${MANIFEST}: ${stack.length} unclosed tag(s) — the plist does not parse`);
  }
  for (const key of ['NSPrivacyTracking', 'NSPrivacyCollectedDataTypes', 'NSPrivacyAccessedAPITypes']) {
    if (!manifest.includes(`<key>${key}</key>`)) {
      problems.push(`${MANIFEST} has no ${key} key — Apple treats an absent key as an unanswered question`);
    }
  }
}
if (readFileSync(POD_MANIFEST, 'utf8') !== manifest) {
  problems.push(
    `${POD_MANIFEST} differs from ${MANIFEST} — the pod and the package would ` +
      'declare different things, and only one of them would be wrong in public',
  );
}

// Production sources only: a test target is not shipped, and a
// `UserDefaults` in a test would otherwise force a declaration about
// the product that the product does not earn.
const files = execFileSync('git', ['ls-files', `${SOURCES}/*.swift`], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
if (files.length === 0) {
  console.error(`✗ no tracked Swift sources under ${SOURCES} — this checker would pass on nothing`);
  process.exit(1);
}
const code = files.map((f) => readFileSync(f, 'utf8')).join('\n');

for (const [category, pattern] of REQUIRED_REASON) {
  const used = pattern.test(code);
  const declared = manifest.includes(`<string>${category}</string>`);
  if (used && !declared) {
    const where = files.find((f) => pattern.test(readFileSync(f, 'utf8')));
    problems.push(
      `${where} reaches ${category.replace('NSPrivacyAccessedAPICategory', '')} and ` +
        `${MANIFEST} does not declare it — App Review rejects the host app for this`,
    );
  }
  if (!used && declared) {
    problems.push(
      `${MANIFEST} declares ${category} and nothing under ${SOURCES} calls it — ` +
        'either the call was removed and the claim outlived it, or the pattern here is wrong',
    );
  }
}

// A declared category with an empty reason array is the same as no
// declaration to Apple's checker, and looks like a declaration here.
for (const [category] of REQUIRED_REASON) {
  if (!manifest.includes(`<string>${category}</string>`)) continue;
  const after = manifest.slice(manifest.indexOf(`<string>${category}</string>`));
  const reasons = after.slice(0, after.indexOf('</dict>'));
  if (!/<string>[A-Z0-9]{4}\.\d+<\/string>/.test(reasons)) {
    problems.push(`${category} is declared with no reason code — Apple treats that as undeclared`);
  }
}

// The declaration only ships if the packaging says so.
if (!readFileSync(PACKAGE, 'utf8').includes('PrivacyInfo.xcprivacy')) {
  problems.push(`${PACKAGE} does not put the manifest in the target's resources — SwiftPM would leave it out of the build`);
}
if (!readFileSync(PODSPEC, 'utf8').includes('PrivacyInfo.xcprivacy')) {
  problems.push(`${PODSPEC} does not ship the manifest — CocoaPods does not pick it up from source_files`);
}

if (problems.length === 0) {
  const declared = REQUIRED_REASON.filter(([c]) => manifest.includes(`<string>${c}</string>`)).length;
  console.log(`✓ privacy manifest declares ${declared} required-reason categor${declared === 1 ? 'y' : 'ies'}, and both channels ship it`);
  process.exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
process.exit(1);

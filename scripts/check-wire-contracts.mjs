// The unions the SDK writes and the server reads, checked against
// each other.
//
// These pairs are maintained by hand across a language boundary, and
// nothing compiles them together. A kind added on one side and
// forgotten on the other is not a type error anywhere — it is an
// event rejected at ingest, from a device, into a log.
//
//   node scripts/check-wire-contracts.mjs

import { readFileSync } from 'node:fs';

const TYPES = 'sdk/core/src/types.ts';
const PIPELINE = 'self-hosted/server/src/pipeline.rs';
const ATTACHMENTS = 'self-hosted/server/src/handlers/sdk/events_attachments.rs';

const problems = [];

/** `export type X = 'a' | 'b'` or the multi-line `| 'a'` form. */
function tsUnion(src, name) {
  const m = new RegExp(`export type ${name} =([^;]*?)\\n\\n`, 's').exec(`${src}\n\n`);
  if (!m) return null;
  const values = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return values.length > 0 ? values.sort() : null;
}

/** `pub enum Kind { Error, Warn, ... }` → lowercased variants. */
function rustEnum(src, name) {
  const m = new RegExp(`pub enum ${name} \\{([^}]*)\\}`, 's').exec(src);
  if (!m) return null;
  const values = [...m[1].matchAll(/^\s*([A-Z]\w*)\s*,/gm)].map((x) =>
    x[1].toLowerCase(),
  );
  return values.length > 0 ? values.sort() : null;
}

/** `const KINDS: [&str; N] = ["a", "b"];` */
function rustStrArray(src, name) {
  const m = new RegExp(`const ${name}: \\[&str; \\d+\\] = \\[([^\\]]*)\\]`, 's').exec(src);
  if (!m) return null;
  const values = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  return values.length > 0 ? values.sort() : null;
}

const types = readFileSync(TYPES, 'utf8');
const pipeline = readFileSync(PIPELINE, 'utf8');
const attachments = readFileSync(ATTACHMENTS, 'utf8');

// ── the five kinds: both directions matter ────────────────────────
// An event kind the server does not know is rejected at ingest; one
// the SDK cannot name is a feature with no way to reach it.
const eventKinds = tsUnion(types, 'EventKind');
const serverKinds = rustEnum(pipeline, 'Kind');
if (!eventKinds || !serverKinds) {
  problems.push(
    `could not read EventKind (${TYPES}) or enum Kind (${PIPELINE}) — ` +
      'one of them moved or changed shape. A checker that parses nothing must not pass.',
  );
} else {
  for (const k of eventKinds) {
    if (!serverKinds.includes(k)) {
      problems.push(`EventKind has '${k}'; ${PIPELINE} enum Kind does not — ingest would reject it`);
    }
  }
  for (const k of serverKinds) {
    if (!eventKinds.includes(k)) {
      problems.push(`enum Kind has '${k}'; ${TYPES} EventKind does not — no SDK can send it`);
    }
  }
}

// ── attachment kinds: subset, not equality ────────────────────────
// The server's list mirrors a database CHECK constraint and may
// outlive a kind the SDK has retired (`sessionTrail` did). What must
// never happen is the other direction: an SDK that can name a kind
// the database will refuse.
const attachmentKinds = tsUnion(types, 'AttachmentKind');
const serverAttachmentKinds = rustStrArray(attachments, 'KINDS');
if (!attachmentKinds || !serverAttachmentKinds) {
  problems.push(
    `could not read AttachmentKind (${TYPES}) or KINDS (${ATTACHMENTS}) — ` +
      'one of them moved or changed shape.',
  );
} else {
  for (const k of attachmentKinds) {
    if (!serverAttachmentKinds.includes(k)) {
      problems.push(
        `AttachmentKind has '${k}'; ${ATTACHMENTS} KINDS does not — the upload ` +
          'is refused, and the CHECK constraint behind it would refuse the row too',
      );
    }
  }
}

// ── attachment sources ────────────────────────────────────────────
const sources = tsUnion(types, 'AttachmentSource');
const serverSources = rustStrArray(attachments, 'SOURCES');
if (sources && serverSources) {
  for (const s of sources) {
    if (!serverSources.includes(s)) {
      problems.push(`AttachmentSource has '${s}'; ${ATTACHMENTS} SOURCES does not`);
    }
  }
}

if (problems.length === 0) {
  console.log(
    `✓ wire contracts agree: ${eventKinds.length} event kinds, ` +
      `${attachmentKinds.length} attachment kinds`,
  );
  process.exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
console.error(
  '\nThese unions are maintained by hand across a language boundary and\n' +
    'nothing compiles them together. A mismatch is not a type error — it\n' +
    'is an event rejected at ingest, on a device, into a log.',
);
process.exit(1);

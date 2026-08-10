// Every `INSERT … (cols) VALUES (…)` must balance.
//
// Two of them did not, and both were load-bearing:
//
//   device_tokens — 5 columns, 6 placeholders. Every device
//   registration any SDK ever attempted returned 500.
//   push_sends    — 9 columns, 10 values (`\'queued\'` shifted the
//   rest). Every send returned 500.
//
// Postgres refuses such a statement at prepare time, so the failure
// is total and silent from the outside: an endpoint that always
// 500s looks exactly like a feature nobody uses. The whole push
// subsystem read as "shipped but unadopted" for a year on the
// strength of two miscounted parentheses.
//
// Nothing else looks. `sqlx::query` takes a string; rustc never
// counts it, and a test only catches it if something calls that
// exact endpoint.
//
//   node scripts/check-sql-inserts.mjs

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['self-hosted/server/src', 'core/crates'];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === 'target') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.rs')) out.push(p);
  }
  return out;
}

/** Split on commas that are not inside brackets or quotes. */
function fields(s) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter((x) => x.length > 0);
}

const files = ROOTS.flatMap((r) => walk(r));
if (files.length === 0) {
  console.error(`✗ no .rs under ${ROOTS.join(', ')} — this checker read nothing.`);
  process.exit(1);
}

/** The text inside the parenthesis group starting at `i`, and the
 *  index just past it. Counting brackets rather than scanning to the
 *  first `)` — `gen_random_uuid()` inside a VALUES list is common,
 *  and a naive scan reports every such statement as unbalanced. A
 *  checker that cries wolf gets switched off. */
function group(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j += 1) {
    if (s[j] === '(') depth += 1;
    else if (s[j] === ')') {
      depth -= 1;
      if (depth === 0) return [s.slice(i + 1, j), j + 1];
    }
  }
  return [null, s.length];
}

const problems = [];
let checked = 0;

for (const f of files) {
  // Rust string continuations (`\` at EOL) are not part of the SQL.
  const sql = readFileSync(f, 'utf8').replace(/\\\s*\n\s*/g, ' ');
  for (const m of sql.matchAll(/INSERT INTO (\w+)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const [cols, afterCols] = group(sql, open);
    if (cols === null) continue;
    const rest = sql.slice(afterCols, afterCols + 600);
    const vm = /VALUES\s*\(/.exec(rest);
    // `INSERT … SELECT` has no VALUES list and nothing to balance.
    if (!vm) continue;
    const [vals] = group(rest, vm.index + vm[0].length - 1);
    if (vals === null) continue;
    checked += 1;
    const nc = fields(cols).length;
    const nv = fields(vals).length;
    if (nc !== nv) {
      problems.push(`${f}: INSERT INTO ${m[1]} — ${nc} columns, ${nv} values`);
    }
  }
}

if (problems.length === 0) {
  console.log(`✓ ${checked} INSERT statements, columns and values balance`);
  process.exit(0);
}
for (const p of problems) console.error(`✗ ${p}`);
console.error(
  '\nPostgres refuses an unbalanced INSERT at prepare time, so the endpoint\n' +
    'always 500s — which from the outside is indistinguishable from a\n' +
    'feature nobody uses.',
);
process.exit(1);

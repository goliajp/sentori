// English prose sitting in the UI without going through `t()`.
//
// `check-i18n` answers a different question: are the three catalogues
// the same size, and is every key referenced. Both can be perfectly
// true while a screen renders a sentence nobody translated — which is
// how the billing page shipped three of them, visible to every zh and
// ja user, past a gate that reported "3 locales, all referenced".
//
// Deliberately narrow. It looks for string literals that read like
// sentences — three or more words, mostly letters — and ignores the
// places a sentence is legitimately not UI copy. A checker that cried
// wolf on className strings would be turned off within a week, and a
// gate that is off is worse than no gate, because the green still
// looks like an answer.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/pages', 'src/components'];

/** Props whose value is machinery, not something a person reads. */
const CODE_PROPS =
  /(?:className|class|href|src|to|id|key|type|role|name|htmlFor|rel|target|charSet|viewBox|d|fill|stroke|xmlns|data-[\w-]+|aria-controls|aria-labelledby)\s*=\s*$/;

/** A sentence: three-plus words, letters and ordinary punctuation. */
const PROSE = /^[A-Z][\w'’-]*(?: [\w'’“”"(),.:;!?/&%+-]+){2,}$/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const findings = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, 'utf8');
    const lines = src.split('\n');

    // Match single- and double-quoted literals. Template literals are
    // skipped: they are nearly always interpolation, and the ones that
    // are not get caught the next time someone reads the screen.
    const re = /(['"])((?:(?!\1)[^\\\n]|\\.)*)\1/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const text = m[2].replace(/\\(.)/g, '$1').trim();
      if (!PROSE.test(text)) continue;

      const before = src.slice(0, m.index);
      const line = before.split('\n').length;
      const lineText = lines[line - 1] ?? '';

      // Inside t('…') — the whole point is that it is a key.
      if (/\bt\(\s*$/.test(before.slice(-40))) continue;
      // A key being *defined*, not rendered.
      if (/^\s*['"][\w.]+['"]\s*:/.test(lineText)) continue;
      if (CODE_PROPS.test(before.slice(-60))) continue;
      if (/^\s*(import|export)\b/.test(lineText)) continue;
      if (/\/\/|https?:\/\//.test(lineText)) continue;
      // A comment block explaining something.
      if (/^\s*\*/.test(lineText)) continue;

      findings.push({ file, line, text });
    }
  }
}

if (findings.length === 0) {
  console.log('✓ no hard-coded UI prose');
  process.exit(0);
}

console.error(`✗ ${findings.length} string(s) render without t():\n`);
for (const f of findings) {
  console.error(`  ${f.file}:${f.line}`);
  console.error(`    ${f.text}\n`);
}
console.error(
  'Each of these shows English to every zh and ja user. Move it into\n' +
    'the three catalogues and read it back through t().',
);
process.exit(1);

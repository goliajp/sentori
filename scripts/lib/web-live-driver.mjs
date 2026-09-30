// Drive the browser SDK in a real Chrome, over CDP.
//
//   node scripts/lib/web-live-driver.mjs <pageUrl> <outFile>
//
// Everything the web SDK does that matters happens against APIs Bun
// does not have: `addEventListener('error')`, `PerformanceObserver`,
// `localStorage` in a private window, `visibilitychange`. Unit tests
// of those would be tests of whatever stand-in was written for them.
//
// So: a real page, a real uncaught error, a real click, a real
// rejection — and the long-task budget measured in the same run,
// because a reporter that costs the page a frame is one the host
// removes.

import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [pageUrl, outFile] = process.argv.slice(2);
if (!pageUrl || !outFile) {
  console.error('usage: web-live-driver.mjs <pageUrl> <outFile>');
  process.exit(1);
}

const CHROME =
  process.env.CHROME_PATH ??
  [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ].find((p) => existsSync(p)) ??
  'google-chrome';

const profile = mkdtempSync(join(tmpdir(), 'sentori-web-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
]);

let said = '';
chrome.stderr.on('data', (d) => (said += d));
chrome.on('error', (e) => (said += `spawn failed: ${e.message}\n`));

const wsUrl = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error(`Chrome never printed a debugger URL. It said:\n${said}`)),
    20000,
  );
  const tick = setInterval(() => {
    const m = /ws:\/\/[^\s]+/.exec(said);
    if (m) {
      clearInterval(tick);
      clearTimeout(timer);
      resolve(m[0]);
    }
  }, 100);
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let nextId = 1;
const waiting = new Map();
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    const { resolve, reject } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    waiting.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
const call = (method, params) => send(method, params, sessionId);
await call('Page.enable');
await call('Runtime.enable');

const evaluate = async (expression, awaitPromise = false) => {
  const r = await call('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(`page threw: ${r.exceptionDetails.text} ${JSON.stringify(r.result?.value ?? '')}`);
  }
  return r.result.value;
};

const fail = async (m) => {
  console.error(`✗ ${m}`);
  chrome.kill();
  process.exit(1);
};

await call('Page.navigate', { url: pageUrl });
// The module has to load and `init` has to run.
for (let i = 0; i < 100; i += 1) {
  if (await evaluate('!!window.__ready')) break;
  await new Promise((r) => setTimeout(r, 100));
}
if (!(await evaluate('!!window.__ready'))) {
  await fail('the harness page never initialised the SDK');
}

// ── first what the person did, then what broke ───────────────────
// In that order, because the ring is snapshotted when the event is
// built: an error thrown before the click would carry a ring without
// it, and asserting on that would be asserting the wrong thing. It is
// also the real sequence — someone clicks, and then it breaks.
await evaluate(`
  document.getElementById('pay').click();
  history.pushState({}, '', '/checkout');
  true;
`);
await new Promise((r) => setTimeout(r, 100));

await evaluate(`
  window.__hostSawIt = false;
  window.addEventListener('error', () => { window.__hostSawIt = true; });
  setTimeout(() => { throw new TypeError('uncaught from the page'); }, 0);
  true;
`);
await new Promise((r) => setTimeout(r, 200));

// The host's own listener must still fire. Installing ours by
// assigning window.onerror would have replaced theirs, and the
// symptom is "our error reporting stopped when we added Sentori".
if (!(await evaluate('window.__hostSawIt'))) {
  await fail("the page's own error listener stopped firing — we replaced it instead of joining it");
}

// ── an unhandled rejection ────────────────────────────────────────
await evaluate(`Promise.reject(new RangeError('nobody caught this')); true;`);
await new Promise((r) => setTimeout(r, 200));

// ── the long-task budget, measured on this page ───────────────────
// Not a claim about a fast machine: the assertion is that the SDK's
// own work never occupies the main thread for a frame's worth of
// time. `PerformanceObserver` on `longtask` is the browser's own
// definition of that.
const longTasks = await evaluate(`
  new Promise((resolve) => {
    const seen = [];
    try {
      const o = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) seen.push(Math.round(e.duration));
      });
      o.observe({ type: 'longtask', buffered: true });
    } catch { resolve([]); return; }
    // Work the SDK is asked to do, at a rate no real page reaches.
    for (let i = 0; i < 500; i += 1) window.__sentori.trace('tick', { i });
    for (let i = 0; i < 50; i += 1) window.__sentori.error(new Error('load ' + i));
    setTimeout(() => resolve(seen), 300);
  });
`, true);

await evaluate('window.__sentori.flush()', true);
// The batch is fire-and-forget inside the transport; give it a beat.
await new Promise((r) => setTimeout(r, 800));
await evaluate('window.__sentori.flush()', true);
await new Promise((r) => setTimeout(r, 800));

writeFileSync(outFile, JSON.stringify({ longTasks }));
console.log(`  a real page: uncaught error, rejection, click, navigation`);
console.log(`  long tasks over 550 SDK calls: ${longTasks.length === 0 ? 'none' : longTasks.join(', ') + ' ms'}`);

chrome.kill();
